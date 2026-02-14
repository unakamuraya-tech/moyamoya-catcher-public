if (process.env.NODE_ENV !== 'test') require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const KPI_EVENT_LIST = [
  'session_started', 'step_answered', 'generation_started',
  'generation_succeeded', 'generation_failed', 'results_reopened',
  'expert_review_started', 'expert_review_failed', 'expert_review_completed',
  'pdf_exported', 'shared_url'
];

// ── Firestore setup (graceful fallback) ──
let db = null;
try {
  if (process.env.NODE_ENV !== 'test') {
    const admin = require('firebase-admin');
    admin.initializeApp({
      projectId: process.env.GCP_PROJECT_ID || 'moyamoya-catcher'
    });
    db = admin.firestore();
    console.log('🔥 Firestore connected (project: moyamoya-catcher)');
  }
} catch (e) {
  console.warn('⚠️  Firestore init failed, events will use memory buffer only:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : null;
if (isProduction && (!allowedOrigins || allowedOrigins.length === 0)) {
  throw new Error('ALLOWED_ORIGINS is required in production');
}
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/analytics-config.js', (req, res) => {
  const measurementId = process.env.GA_MEASUREMENT_ID || '';
  res.type('application/javascript').send(
    `window.GA_MEASUREMENT_ID = ${JSON.stringify(measurementId)};`
  );
});

// Rate limiting — separated by API weight
try {
  const rateLimit = require('express-rate-limit');
  // Heavy APIs (generation, summarization, chat): strict limit
  const heavyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error_code: 'RATE_LIMIT', error_message: 'Too many requests, please try again later' }
  });
  ['/api/generate', '/api/chat', '/api/summarize-url', '/api/summarize-text',
   '/api/update-summary', '/api/expert-review', '/api/audit', '/api/improve'
  ].forEach(path => app.use(path, heavyLimiter));

  // Light APIs (events): relaxed limit for burst
  const lightLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use('/api/events', lightLimiter);
  // /api/health: no rate limit (monitoring must always work)
} catch (_) {
  console.warn('⚠️  express-rate-limit not installed, skipping rate limiting');
}

// ── Gemini setup ──
let genAI = null;
let model = null;

function getModel() {
  if (!model && process.env.GEMINI_API_KEY) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  }
  return model;
}

// ── Helper: read prompt template (D3: cached at startup) ──
const fs = require('fs');
const promptCache = {};

function getPrompt(name) {
  if (!promptCache[name]) {
    const p = path.join(__dirname, 'prompts', `${name}.txt`);
    promptCache[name] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  return promptCache[name];
}

// Pre-cache prompts on startup
['plan-generator', 'funding-generator', 'message-generator', 'profile-generator'].forEach(getPrompt);

// ── Mock data for demo ──
const MOCK = {
  summary: {
    activity: '「よりみちベース」— 子どもの放課後の居場所',
    location: '福井県越前市',
    schedule: '週2回、公民館で開催',
    participants: '来ている子は5〜8人',
    operator: 'ほぼ1人で運営',
    started: '2024年開始、2年目',
    funding: '今年度は市の単年度支援で収支はトントン'
  },

  plan: `## あなたの90日プラン

最初の90日で「活動がきちんと続く仕組み」をつくります。
全部いっぺんにやる必要はありません。**今月やること、来月やること、再来月やること**の3ステップです。

📌 **まず今日やること：** 下の「今月」のリストを読んで、一番上のタスクだけ取りかかってください。

---

### 🟢 今月やること（Week 1〜4）

いまある情報を整理して、最初の一歩を踏み出します。

- **活動実績を1枚にまとめる** — [活動紹介タブ]の内容をもとに、A4一枚の実績シートを作成。行政にも企業にも使い回せます
- **子どもや保護者の声を2〜3人分メモする** — 匿名でOK。「ここに来ると安心する」のような一言が最強の説得材料です
- **市の担当課に電話して面談の日取りを決める** — 来年度の予算に間に合わせるには、早いほど有利です

> 💡 行政への面談は、年度切り替えの2ヶ月前がベスト。予算編成に間に合います。

---

### 🟡 来月やること（Week 5〜8）

外への働きかけを始めます。

- **地元企業数社にメールを送る** — [文章パックタブ]の企業メールをそのままコピペ。少額の協賛を提案します
- **寄付受付ページをつくる** — STORES などのネット寄付サービスで30分あれば作れます。ページの原稿は[資金計画タブ]を参考に
- **SNSに投稿する** — [文章パックタブ]のSNS投稿文をそのまま使えます

---

### 🔵 再来月やること（Week 9〜13）

持続する仕組みを固めます。

- **手伝ってくれる人を2人みつける** — 保護者や地域の人に「月1回でいいので」と声をかける
- **来年度の予算案をつくる** — [資金計画タブ]の数字をベースに
- **行政に次年度の申請書類を提出する** — 実績シート＋予算案をセットで

---

### 90日後のイメージ

- 資金源：1つ（行政のみ）→ **3つ以上**（行政 + 協賛 + 寄付）
- 運営協力者：0人 → **2人**
- 寄付の入口：なし → **ページ公開済み**

---

*※ この計画はAIが生成した提案のたたき台です。実際のペースに合わせて調整してください。*`,

  funding: `## お金のはなし

いま行政の支援1本だけに頼っている状態は、一番リスクが高いです。
**「もう1本」増やすだけで、1つが途切れても活動は止まりません。**

📌 **まず知ってほしいこと：** お金の出どころを分散するだけで、活動の安定感がぐっと増します。

---

### いまの状況

- 現在の収入源：行政の単年度支援が中心
- 支出は会場費・教材費・保険料など（仮置き）
- 来年度の支援が続くかは未定。「もしなくなったら」を今から準備します

> ⚠️ 金額の詳細は活動ごとに異なります。次のステップで一緒に整理していきましょう。

---

### 3つの柱でお金をつくる方針

**① 行政支援の継続**

来年度も支援を受けるため、面談＋実績報告を行います。過去の実績があるので、継続は十分に可能です。

**② 地元企業からの協賛**

少額協賛を数社から。社内報や会社HPでの紹介がお返しになります。企業への依頼メールは[文章パックタブ]にあります。

**③ 個人からの継続寄付**

少額寄付をSNSで募ります。ジュース1本分から。投稿文は[文章パックタブ]にすでに用意してあります。

> 💡 3つの柱を組み合わせれば、年間の運営費をカバーできる見通しが立ちます（金額は仮置き）。

---

### この1年の流れ

1. **今すぐ** — 行政に面談を申し込む
2. **1〜2か月後** — 企業数社にメールを送る
3. **3か月後** — 寄付ページを公開、SNSで告知
4. **半年後** — 中間報告を行政・企業に送付
5. **年度末** — 次年度の継続交渉（「実績あり」で格段に楽になる）

---

### 大事なこと

最初から完璧な計画は要りません。**「行政支援＋もう1本」** ができた時点で、活動は格段に安定します。

---

*※ この計画はAIが生成した提案のたたき台です。金額は仮置きです。*`,

  messages: `## 文章パック（関係者別）

各メッセージはそのまま**コピペして送信**できます。送信前に⚠️の部分だけ確認してください。

---

### 📄 自治体向け：継続提案メール

> **件名：「よりみちベース」次年度継続支援のご相談（ご面談のお願い）**
>
> いつもお世話になっております。
>
> 現在、市のご支援をいただき「よりみちベース」を運営しております。
> おかげさまで週2回の開催を継続し、毎回5〜8名の子どもたちが利用しています。
>
> 来年度の継続に向けて、活動実績と今後の計画をまとめましたので、
> **15〜20分ほどお時間をいただき、ご報告かたがたご相談できれば**と存じます。
>
> ⚠️ ご都合のよい日時の候補をいくつかいただけますと幸いです。
> 当方は平日午前中であれば調整可能です。
>
> 添付：活動紹介（[活動紹介タブ]の内容をPDFにしてお送りします）
>
> 何卒よろしくお願いいたします。

**💡 この文章のポイント：**
- 「ご相談」ではなく「ご報告＋ご相談」で、担当者の負担感を下げている
- 具体的な時間（15〜20分）を提示して、相手が判断しやすくしている
- 添付資料があるので、相手は内容を事前に確認できる

---

### 🏢 企業向け：協賛依頼メール

> **件名：子どもの居場所づくりへのご協賛のお願い（月3,000円〜）**
>
> 突然のご連絡失礼いたします。
>
> 越前市で子どもの放課後の居場所「よりみちベース」を運営しております。
> 週2回、公民館をお借りして、毎回5〜8名の子どもたちが安心して過ごせる場を提供しています。
>
> 活動の継続に向けて、地元企業様にご協賛をお願いしております。
>
> **ご協賛のメリット：**
> - 月額3,000円〜と少額のため社内でも決めやすい
> - 社内報や会社HPで「地域の子ども支援」として紹介可能
> - 活動報告書（写真付き）を定期的にお届け
>
> 活動紹介と資金計画の概要を添付いたしますので、ご覧いただけますと幸いです。
>
> ⚠️ 今年度中にご返信いただけますと、来年度からの掲載・報告に反映できます。
>
> 添付：活動紹介＋資金計画（各タブの内容をPDFにしてお送りします）

**💡 この文章のポイント：**
- 件名に金額を入れて「高いのでは？」という不安を先に潰している
- 企業にとってのメリット（社内報・会社HP掲載）を具体的に提示
- 「今年度中」という時限で後回しにさせない

---

### 📱 地域向け：寄付・協力募集（SNS投稿案）

> 🏠 越前市で「よりみちベース」という
> 子どもの放課後の居場所を運営しています。
>
> 週2回、公民館で子どもたちと過ごしています。
> 来てくれる子は毎回5〜8人。
>
> 先日、ある子が言ってくれました。
> **「ここに来ると安心する」**
>
> この場所を来年度も続けるために、
> 少しだけお力を貸してください 🙏
>
> ✅ 月500円〜の継続寄付（ジュース1本分）
> ✅ ボランティア（月1回・2時間〜OK）
> ✅ この投稿のシェアだけでも嬉しいです
>
> 👇 寄付・詳細はこちら
> ⚠️ [ここに寄付ページのURLを入れる]
>
> #よりみちベース #越前市 #子どもの居場所 #寄付 #ボランティア

**💡 この文章のポイント：**
- 「安心する」という子どもの声で感情を動かしている
- 「ジュース1本分」で金額の心理的ハードルを下げている
- シェアも立派な貢献であることを明示して、行動の選択肢を広げている`,

  profile: `## よりみちベースについて

### 私たちがやっていること

○○市の公民館で、週2回、子どもたちの放課後の居場所を開いています。学校帰りにふらっと立ち寄れる、もうひとつの「ただいま」がある場所です。

宿題をする子もいれば、マンガを読む子もいる。ボードゲームで盛り上がる日もあれば、ただ静かに過ごす日もある。毎回5〜8人の子どもたちが、自分のペースで過ごしています。

### なぜこの活動が必要なのか

共働き世帯の増加、地域のつながりの希薄化、習い事に通えない家庭の存在。全国で約15万人の子どもが放課後を一人で過ごしていると言われるなか、この地域も例外ではありません。

保護者からは「学童に入れなかった」「高学年の受け皿がない」という声がありました。子どもからは「ここに来ると安心する」という言葉が出ました。

安心できる大人がいて、安心できる場所がある。それだけで子どもの日常は変わります。

### これまでの歩み

- **2024年：** 代表が個人で活動開始。週1回からスタート
- **2024年後半：** 市の単年度補助を取得。週2回に拡大
- **2025年：** 定期利用が安定。保護者・学校との連携が始まる
- **現在：** 年間延べ約400名が利用する見込み。持続可能性が課題に

### いま直面していること

活動は軌道に乗ってきました。でも正直に言えば、2つの壁があります。

**1. 来年度の資金が未確定**
今年度は市の単年度支援で収支トントン。来年度の継続は未定です。支援がなくなった場合、活動費をどう確保するかが課題です。

**2. 運営体制が一人**
代表がほぼ一人で回しています。この構造を変えないと、活動が「個人の頑張り」に依存し続けてしまいます。

でも、辞めるつもりはありません。この場所は、必要とされています。

### 応援してくださる方へ

**寄付で応援**
- 月1,000円〜の継続寄付：おやつ代1回分から。安定した運営の土台になります
- 単発寄付：金額は自由です。備品購入やイベント費用に充てます

**時間で応援**
- 見守りボランティア：月1回、2時間から。子どもたちと一緒に過ごすだけでOKです
- 特技を活かす：料理、工作、スポーツなど。特別な日のゲストとして

**広めて応援**
- SNSでシェア：この活動を知ってもらうだけで、巻き込める人が増えます
- 知人に紹介：「こんな活動があるよ」の一言が、次の協力者につながります

### 運営者より

始めたとき、こんなに続くと思っていませんでした。でも子どもたちが「明日も来ていい？」と聞いてくるたびに、続ける理由ができました。

一人では限界があります。でも、一人じゃなければ続けられます。あなたの力を貸してください。

---

*※ この文章はAIが生成した提案のたたき台です。実際の活動内容に合わせて編集してお使いください。*`
};

// ── Audit & Improve Routes ──
const auditRoutes = require('./audit-routes');
app.use('/api', auditRoutes);

// ── API: Update summary with user corrections ──
app.post('/api/update-summary', async (req, res) => {
  try {
    const { currentSummary, correction } = req.body;
    if (!correction) return res.status(400).json({ error: 'correction is required' });

    if (!process.env.GEMINI_API_KEY) {
      // Mock: just return current summary as-is
      return res.json({ success: true, summary: currentSummary, source: 'mock' });
    }

    const m = getModel();
    if (!m) {
      return res.json({ success: true, summary: currentSummary, source: 'mock' });
    }

    const prompt = `以下はある地域活動の要約データと、ユーザーからの修正指示です。
修正指示を反映して、要約データを更新してください。

--- 現在の要約 ---
${JSON.stringify(currentSummary, null, 2)}
--- ここまで ---

--- ユーザーの修正指示 ---
${correction.slice(0, 2000)}
--- ここまで ---

修正を反映した上で、以下のJSON形式で返してください:
{
  "activity": "活動名 — 一言説明",
  "location": "活動場所",
  "schedule": "活動頻度・スケジュール",
  "participants": "参加者の規模",
  "operator": "運営体制",
  "started": "開始時期",
  "funding": "現在の資金状況"
}

ルール:
- ユーザーの修正指示に該当する項目だけを更新し、それ以外はそのまま維持
- すべて日本語で回答
JSON以外のテキストは出力しないでください。`;

    const result = await m.generateContent(prompt);
    const responseText = result.response.text().trim();
    const jsonStr = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const summary = JSON.parse(jsonStr);

    res.json({ success: true, degraded: false, summary, source: 'gemini' });
  } catch (err) {
    console.error('Update summary error:', err);
    res.status(502).json({ success: false, error_code: 'UPSTREAM_ERROR', error_message: err.message || 'Summary update failed' });
  }
});

// ── API: URL Summarize ──
app.post('/api/summarize-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // If no API key, return mock
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ success: true, summary: MOCK.summary, source: 'mock' });
    }

    const m = getModel();
    if (!m) {
      return res.json({ success: true, summary: MOCK.summary, source: 'mock' });
    }

    // Step 1: Fetch actual page content
    let pageText = '';
    try {
      const targetUrl = url.startsWith('http') ? url : `https://${url}`;
      const response = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoyamoyaCatcher/1.0)' },
        signal: AbortSignal.timeout(10000)
      });
      const html = await response.text();
      // Extract text from HTML (strip tags, scripts, styles)
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000); // Limit to 5000 chars to stay within token limits
    } catch (fetchErr) {
      console.error('URL fetch error:', fetchErr.message);
      pageText = `（URLの取得に失敗しました: ${url}）`;
    }

    // Step 2: Ask Gemini to summarize the actual content
    const prompt = `以下はWebサイト（${url}）から取得した実際のテキスト内容です。
この内容をもとに、この団体・活動について要約してください。

--- ページ内容 ---
${pageText}
--- ここまで ---

以下のJSON形式で返してください（値はすべて日本語の短い文）:
{
  "activity": "活動名 — 一言説明",
  "location": "活動場所",
  "schedule": "活動頻度・スケジュール",
  "participants": "参加者の規模",
  "operator": "運営体制",
  "started": "開始時期",
  "funding": "現在の資金状況"
}

重要なルール:
- ページ内容から明確に読み取れる情報はそのまま記載
- ページに書かれていないが、活動内容から合理的に推測できる情報は補完し、値の末尾に「（推測）」と付けてください
- 例: "schedule": "週1〜2回（推測）"
- 「不明」「unknown」とは絶対に書かないでください。必ず推測で埋めてください
- すべて日本語で回答してください。英語は使わないでください
JSON以外のテキストは出力しないでください。`;

    const result = await m.generateContent(prompt);
    const text = result.response.text().trim();

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const summary = JSON.parse(jsonStr);

    res.json({ success: true, degraded: false, summary, source: 'gemini' });
  } catch (err) {
    console.error('Summarize error:', err);
    res.status(502).json({ success: false, error_code: 'UPSTREAM_ERROR', error_message: err.message || 'URL summarization failed' });
  }
});

// ── API: Summarize pasted text (SNS profile etc.) ──
app.post('/api/summarize-text', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    // If no API key, return mock
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ success: true, summary: MOCK.summary, source: 'mock' });
    }

    const m = getModel();
    if (!m) {
      return res.json({ success: true, summary: MOCK.summary, source: 'mock' });
    }

    const prompt = `以下はSNSのプロフィール文や活動紹介のテキストです。
この内容をもとに、この団体・活動について要約してください。

--- テキスト ---
${text.slice(0, 5000)}
--- ここまで ---

以下のJSON形式で返してください（値はすべて日本語の短い文）:
{
  "activity": "活動名 — 一言説明",
  "location": "活動場所",
  "schedule": "活動頻度・スケジュール",
  "participants": "参加者の規模",
  "operator": "運営体制",
  "started": "開始時期",
  "funding": "現在の資金状況"
}

重要なルール:
- テキストから明確に読み取れる情報はそのまま記載
- テキストに書かれていないが、活動内容から合理的に推測できる情報は補完し、値の末尾に「（推測）」と付けてください
- 「不明」「unknown」とは絶対に書かないでください。必ず推測で埋めてください
- すべて日本語で回答してください
JSON以外のテキストは出力しないでください。`;

    const result = await m.generateContent(prompt);
    const responseText = result.response.text().trim();

    const jsonStr = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const summary = JSON.parse(jsonStr);

    res.json({ success: true, degraded: false, summary, source: 'gemini' });
  } catch (err) {
    console.error('Summarize text error:', err);
    res.status(502).json({ success: false, error_code: 'UPSTREAM_ERROR', error_message: err.message || 'Text summarization failed' });
  }
});

// ── API: Generate outputs ──
app.post('/api/generate', async (req, res) => {
  try {
    const { slots, useMock } = req.body;

    // If mock mode or no API key, return mock data
    if (useMock || !process.env.GEMINI_API_KEY) {
      return res.json({
        success: true,
        degraded: false,
        source: 'mock',
        outputs: {
          plan: MOCK.plan,
          funding: MOCK.funding,
          messages: MOCK.messages,
          profile: MOCK.profile
        }
      });
    }

    // Real Gemini generation
    const m = getModel();
    if (!m) {
      return res.json({
        success: true,
        degraded: false,
        source: 'mock',
        outputs: {
          plan: MOCK.plan,
          funding: MOCK.funding,
          messages: MOCK.messages,
          profile: MOCK.profile
        }
      });
    }

    const slotsJson = JSON.stringify(slots, null, 2);

    // Generate all four outputs in parallel
    const [planResult, fundingResult, messagesResult, profileResult] = await Promise.all([
      m.generateContent(getPrompt('plan-generator').replace('{{SLOTS}}', slotsJson)),
      m.generateContent(getPrompt('funding-generator').replace('{{SLOTS}}', slotsJson)),
      m.generateContent(getPrompt('message-generator').replace('{{SLOTS}}', slotsJson)),
      m.generateContent(getPrompt('profile-generator').replace('{{SLOTS}}', slotsJson))
    ]);

    res.json({
      success: true,
      degraded: false,
      source: 'gemini',
      outputs: {
        plan: planResult.response.text(),
        funding: fundingResult.response.text(),
        messages: messagesResult.response.text(),
        profile: profileResult.response.text() || '（活動紹介の生成に失敗しました。再度お試しください）'
      }
    });
  } catch (err) {
    console.error('Generate error:', err);
    // Fallback to mock on error (UX priority: still return usable data)
    res.json({
      success: true,
      degraded: true,
      source: 'mock-fallback',
      error_code: 'UPSTREAM_ERROR',
      error_message: err.message || 'Gemini generation failed',
      outputs: {
        plan: MOCK.plan,
        funding: MOCK.funding,
        messages: MOCK.messages,
        profile: MOCK.profile
      }
    });
  }
});

// ── API: Free Chat ──
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context, outputs } = req.body;

    // Mock response if no API key
    if (!process.env.GEMINI_API_KEY) {
      const mockReplies = [
        `いい質問ですね！\n\n「${message}」について、いくつかポイントをお伝えします：\n\n1. **助成金情報の探し方** — CANPAN（https://fields.canpan.info/grant/）や自治体のHP「補助金・助成金」ページが定番です\n2. **似た事例** — 全国の子ども食堂ネットワーク（むすびえ）に類似事例が多数あります\n3. **専門家への相談** — 地域のNPOセンターや社会福祉協議会で無料相談ができます\n\n他にも気になることがあれば聞いてください 💬`,
        `なるほど、「${message}」ですね。\n\n地方で活動される方によくある悩みです。\n\nおすすめのアクション：\n- **まずは地域のNPO支援センター**に相談（無料）\n- **むすびえ**（子ども食堂ネットワーク）のサイトで事例検索\n- **自治体の市民活動支援課**に問い合わせ\n\n具体的に深掘りしたい点があれば教えてください！`
      ];
      return res.json({
        success: true,
        source: 'mock',
        reply: mockReplies[Math.floor(Math.random() * mockReplies.length)]
      });
    }

    // Real Gemini chat
    const m = getModel();
    if (!m) {
      return res.json({ success: false, error: 'Model not available' });
    }

    const systemPrompt = `あなたは地方の小さな団体を支援するアドバイザーです。
ユーザーは以下の活動をしています：
${JSON.stringify(context, null, 2)}

すでに90日プランや資金計画を作成済みです。
ユーザーの質問に対して、具体的で実行可能なアドバイスを日本語で答えてください。

重要なルール：
- 回答は200〜400文字以内に収めてください
- 箇条書き3〜5項目程度で簡潔に
- 長い説明文は不要。すぐ行動に移せる情報だけ
- 生成済みのプランや文章を繰り返し出力しないでください
- 質問に直接関係のある情報だけ答えてください`;

    const result = await m.generateContent(systemPrompt + '\n\nユーザーの質問: ' + message);
    const reply = result.response.text();

    res.json({ success: true, source: 'gemini', reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.json({ success: false, error: 'Chat generation failed' });
  }
});

// ── KPI Event Collection (L4: privacy-first + Firestore) ──
const KPI_MAX = 5000;
const kpiBuffer = [];
const ALLOWED_EVENTS = new Set(KPI_EVENT_LIST);
// Allowed payload keys — no PII, no free text
const ALLOWED_KEYS = new Set([
  'event', 'ts', 'session_id', 'stepId', 'source', 'reason',
  'accordionIndex', 'error_code', 'method'
]);
// 'value' is allowed ONLY for enumerated chip selections (max 50 chars, no PII)
// Keyed by stepId to prevent cross-step/cross-product value leakage
const ALLOWED_VALUES_BY_STEP = {
  source_mode:      ['url', 'sns', 'none'],
  summary_confirm:  ['confirmed', 'edit'],
  activity_type:    ['kodomo', 'ibasho', 'event', 'welfare', 'other_local'],
  activity_place:   ['kominkan', 'school', 'online', 'mixed', 'other_place'],
  activity_frequency: ['weekly', 'biweekly', 'monthly', 'irregular', 'starting'],
  activity_confirm: ['ok'],
  topic:            ['money', 'people', 'vague'],
  risk_type:        ['next_year_uncertain', 'cut_risk', 'self_funded'],
  deadline_window:  ['2-3w', '1-2m', '3m+', 'まだ決まっていない'],
  gap_range:        ['3万', '5万', '10万', '15万+', 'まだ分からない'],
  allies:           ['none', 'small_support', 'want_help', 'other'],
  intent:           ['continue', 'continue_light', 'handover', 'other'],
  desired_output:   ['A', 'B', 'C', 'D']
};
// Flat set for fallback when stepId is missing or unknown
const ALL_ALLOWED_VALUES = new Set(
  Object.values(ALLOWED_VALUES_BY_STEP).flat()
);

function getJstDayRange(dateStr) {
  let day;
  if (dateStr !== undefined && dateStr !== null && dateStr !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error('INVALID_DATE');
    }
    const parsed = new Date(`${dateStr}T00:00:00+09:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('INVALID_DATE');
    }
    day = dateStr;
  } else {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(yesterday);
  }
  const start = new Date(`${day}T00:00:00+09:00`).getTime();
  const end = new Date(`${day}T23:59:59.999+09:00`).getTime();
  return { day, start, end };
}

function computeKpisFromCounts(counts) {
  const pageView = counts.page_view || 0;
  const sessionStarted = counts.session_started || 0;
  const generationStarted = counts.generation_started || 0;
  const generationSucceeded = counts.generation_succeeded || 0;
  const generationFailed = counts.generation_failed || 0;
  const resultsReopened = counts.results_reopened || 0;
  const pdfExported = counts.pdf_exported || 0;
  const sharedUrl = counts.shared_url || 0;

  const safeRatio = (num, den) => (den > 0 ? num / den : 0);
  return {
    start_rate: safeRatio(sessionStarted, pageView),
    completion_rate: safeRatio(generationSucceeded, sessionStarted),
    retry_rate: safeRatio(generationFailed, generationStarted),
    reopen_rate: safeRatio(resultsReopened, generationSucceeded),
    action_rate: safeRatio(pdfExported + sharedUrl, generationSucceeded)
  };
}

function aggregateEvents(events) {
  const counts = {};
  for (const e of events) {
    const name = e && e.event;
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  const kpis = computeKpisFromCounts(counts);
  return { counts, kpis };
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function fetchDailyEvents(range) {
  if (!db) {
    const local = kpiBuffer.filter(e => e.received >= range.start && e.received <= range.end);
    return { events: local, source: 'memory' };
  }
  try {
    const snap = await db.collection('kpi_events')
      .where('received', '>=', range.start)
      .where('received', '<=', range.end)
      .get();
    const rows = snap.docs.map(d => d.data());
    return { events: rows, source: 'firestore' };
  } catch (e) {
    console.error('KPI query failed:', e.message);
    const local = kpiBuffer.filter(ev => ev.received >= range.start && ev.received <= range.end);
    return { events: local, source: 'memory-fallback' };
  }
}

function buildDailyReport(range, events, source) {
  const { counts, kpis } = aggregateEvents(events);
  return {
    day: range.day,
    source,
    total: events.length,
    counts,
    kpis
  };
}

async function sendReportEmail(report) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.KPI_REPORT_TO;
  const from = process.env.KPI_REPORT_FROM;
  if (!apiKey || !to || !from) {
    const missing = ['RESEND_API_KEY', 'KPI_REPORT_TO', 'KPI_REPORT_FROM']
      .filter(k => !process.env[k]);
    throw new Error(`Missing email config: ${missing.join(', ')}`);
  }

  const subject = `[Moyamoya KPI] ${report.day} Daily Report`;
  const text = [
    `Date: ${report.day} (JST)`,
    `Source: ${report.source}`,
    `Total events: ${report.total}`,
    '',
    `start_rate: ${formatPct(report.kpis.start_rate)}`,
    `completion_rate: ${formatPct(report.kpis.completion_rate)}`,
    `retry_rate: ${formatPct(report.kpis.retry_rate)}`,
    `reopen_rate: ${formatPct(report.kpis.reopen_rate)}`,
    `action_rate: ${formatPct(report.kpis.action_rate)}`,
    '',
    `Counts: ${JSON.stringify(report.counts)}`
  ].join('\n');

  const html = `
  <h2>Moyamoya KPI Daily Report</h2>
  <p><b>Date:</b> ${report.day} (JST)</p>
  <p><b>Source:</b> ${report.source}</p>
  <p><b>Total events:</b> ${report.total}</p>
  <ul>
    <li>start_rate: <b>${formatPct(report.kpis.start_rate)}</b></li>
    <li>completion_rate: <b>${formatPct(report.kpis.completion_rate)}</b></li>
    <li>retry_rate: <b>${formatPct(report.kpis.retry_rate)}</b></li>
    <li>reopen_rate: <b>${formatPct(report.kpis.reopen_rate)}</b></li>
    <li>action_rate: <b>${formatPct(report.kpis.action_rate)}</b></li>
  </ul>
  <pre>${JSON.stringify(report.counts, null, 2)}</pre>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend API failed: ${resp.status} ${err}`);
  }
  return resp.json();
}

async function sendReportSlack(report) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    throw new Error('Missing Slack config: SLACK_WEBHOOK_URL');
  }
  const lines = [
    `*Moyamoya KPI Daily Report* (${report.day} JST)`,
    `source: ${report.source} / total events: ${report.total}`,
    `start_rate: *${formatPct(report.kpis.start_rate)}*`,
    `completion_rate: *${formatPct(report.kpis.completion_rate)}*`,
    `retry_rate: *${formatPct(report.kpis.retry_rate)}*`,
    `reopen_rate: *${formatPct(report.kpis.reopen_rate)}*`,
    `action_rate: *${formatPct(report.kpis.action_rate)}*`,
    `counts: \`${JSON.stringify(report.counts)}\``
  ];

  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Slack webhook failed: ${resp.status} ${err}`);
  }
  return { ok: true };
}

async function sendDailyNotification(report) {
  const provider = (process.env.KPI_NOTIFY_PROVIDER || 'slack').toLowerCase();
  if (provider === 'slack') return { provider: 'slack', result: await sendReportSlack(report) };
  if (provider === 'email') return { provider: 'email', result: await sendReportEmail(report) };

  // auto fallback: Slack -> Email
  if (process.env.SLACK_WEBHOOK_URL) {
    return { provider: 'slack', result: await sendReportSlack(report) };
  }
  return { provider: 'email', result: await sendReportEmail(report) };
}

function authorizeCron(req, res) {
  const secret = process.env.KPI_CRON_SECRET;
  if (!secret) {
    if (isProduction) {
      res.status(503).json({
        success: false,
        error_code: 'KPI_CRON_SECRET_REQUIRED',
        error_message: 'KPI_CRON_SECRET is required in production'
      });
      return false;
    }
    return true; // local/dev fallback
  }
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${secret}`) return true;
  res.status(401).json({ success: false, error_code: 'UNAUTHORIZED' });
  return false;
}

app.post('/api/events', express.text({ type: '*/*', limit: '1kb' }), (req, res) => {
  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!raw.event || !ALLOWED_EVENTS.has(raw.event)) {
      return res.status(400).json({ success: false, error_code: 'INVALID_EVENT' });
    }
    // Strip unknown keys (PII protection)
    const entry = {};
    for (const k of ALLOWED_KEYS) {
      if (raw[k] !== undefined) entry[k] = raw[k];
    }
    // Value: only allow enumerated values (reject free text)
    if (raw.value && typeof raw.value === 'string' && raw.value.length <= 50) {
      const stepAllowed = raw.stepId && ALLOWED_VALUES_BY_STEP[raw.stepId];
      const isAllowed = stepAllowed
        ? stepAllowed.includes(raw.value)
        : ALL_ALLOWED_VALUES.has(raw.value);
      if (isAllowed) {
        entry.value = raw.value;
      }
      // else: silently drop free-text values
    }
    // Validate session_id format (random hex, 8-32 chars)
    if (entry.session_id && !/^[a-f0-9]{8,32}$/.test(entry.session_id)) {
      delete entry.session_id;
    }
    entry.received = Date.now();

    // Memory buffer (always)
    kpiBuffer.push(entry);
    while (kpiBuffer.length > KPI_MAX) kpiBuffer.shift();

    // Firestore persistence (async, fire-and-forget)
    if (db) {
      db.collection('kpi_events').add(entry).catch(e => {
        console.error('Firestore write failed:', e.message);
      });
    }

    res.status(204).end();
  } catch (_) {
    res.status(400).json({ success: false, error_code: 'PARSE_ERROR' });
  }
});

app.get('/api/events/summary', (req, res) => {
  const counts = {};
  for (const e of kpiBuffer) {
    counts[e.event] = (counts[e.event] || 0) + 1;
  }
  res.json({
    total: kpiBuffer.length,
    max: KPI_MAX,
    firestore: db ? 'connected' : 'unavailable',
    counts,
    note: 'Memory buffer resets on restart. Firestore persists if connected.'
  });
});

app.get('/api/kpi/daily-report', async (req, res) => {
  try {
    const range = getJstDayRange(req.query.date);
    const { events, source } = await fetchDailyEvents(range);
    const report = buildDailyReport(range, events, source);
    res.json({ success: true, report });
  } catch (e) {
    if (e.message === 'INVALID_DATE') {
      return res.status(400).json({ success: false, error_code: 'INVALID_DATE', error_message: 'date must be YYYY-MM-DD (JST)' });
    }
    res.status(500).json({ success: false, error_code: 'KPI_REPORT_FAILED', error_message: e.message });
  }
});

async function handleDailyKpiNotify(req, res) {
  if (!authorizeCron(req, res)) return;
  try {
    const targetDate = req.body && req.body.date ? req.body.date : null;
    const range = getJstDayRange(targetDate);
    const { events, source } = await fetchDailyEvents(range);
    const report = buildDailyReport(range, events, source);
    const notify = await sendDailyNotification(report);
    res.json({ success: true, report, notify });
  } catch (e) {
    if (e.message === 'INVALID_DATE') {
      return res.status(400).json({ success: false, error_code: 'INVALID_DATE', error_message: 'date must be YYYY-MM-DD (JST)' });
    }
    console.error('Daily KPI notify failed:', e.message);
    res.status(500).json({ success: false, error_code: 'KPI_NOTIFY_FAILED', error_message: e.message });
  }
}

app.post('/api/kpi/notify-daily', handleDailyKpiNotify);
app.post('/api/kpi/email-daily', handleDailyKpiNotify); // backward compatibility

// ── Test-only: inspect recent events (disabled in production) ──
if (process.env.NODE_ENV === 'test') {
  app.get('/api/events/latest', (req, res) => {
    const n = Math.min(parseInt(req.query.n || '1', 10), 50);
    const latest = kpiBuffer.slice(-n);
    res.json({ events: latest });
  });
}

// ── Health check (L4: reflects dependency status) ──
app.get('/api/health', (req, res) => {
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  const modelReady = !!model;
  const healthy = geminiConfigured;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: {
      gemini_key_configured: geminiConfigured,
      gemini_model_ready: modelReady
    },
    timestamp: new Date().toISOString()
  });
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only listen when run directly (not when imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎯 Moyamoya Catcher running on http://localhost:${PORT}`);
    console.log(`   Gemini API: ${process.env.GEMINI_API_KEY ? '✅ configured' : '⚠️  using mock data'}`);
  });
}

module.exports = app;
