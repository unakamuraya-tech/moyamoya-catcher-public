// ── Quality Audit & Improve Routes ──
const express = require('express');
const router = express.Router();

// Mock audit scores (realistic: includes △ to demonstrate improvement)
const MOCK_AUDIT = {
  profile: {
    scores: { action: '◎', motivation: '◎', barrier: '○', urgency: '◎' },
    comments: {
      action: '「まず印刷」の指示が明確',
      motivation: '活動の存在意義が見える化されている',
      barrier: '印刷環境がない場合の代替が未記載',
      urgency: '期限付きで行動を促している'
    }
  },
  plan: {
    scores: { action: '◎', motivation: '○', barrier: '◎', urgency: '△' },
    comments: {
      action: '「まず今日やること」が冒頭にある',
      motivation: 'KPIはあるが、達成後のイメージが薄い',
      barrier: 'テンプレ参照で手間を最小化している',
      urgency: '「Week 1-2」は曖昧。具体的な日付が望ましい'
    }
  },
  funding: {
    scores: { action: '◎', motivation: '◎', barrier: '○', urgency: '△' },
    comments: {
      action: 'Baseシナリオが明確',
      motivation: 'リスク可視化で危機感を持たせている',
      barrier: '具体的な申請先URLがあるとさらに良い',
      urgency: '「月1-2」は曖昧。「今月中に電話」の方が動ける'
    }
  },
  messages: {
    scores: { action: '◎', motivation: '◎', barrier: '◎', urgency: '○' },
    comments: {
      action: 'コピペで送信できる',
      motivation: '「効く理由」解説で自信が持てる',
      barrier: '添付テンプレへのリンクで障壁排除',
      urgency: '「今年度中」はあるが、季節感がもう少し欲しい'
    }
  }
};

// Axis labels for display
const AXIS_LABELS = {
  action: '次のアクション明確度',
  motivation: '動機づけ（Why）',
  barrier: '障壁排除',
  urgency: '緊急度・時限'
};

const AXIS_IMPROVE_INSTRUCTIONS = {
  action: '読んだ直後に何をすべきかを、冒頭に「📌まず今日やること」として1つだけ明示してください',
  motivation: 'なぜ今これをやる価値があるのか、読み手にとっての具体的なメリットを追加してください',
  barrier: 'すぐ実行するための障壁（不明点・手間）を特定し、解消する情報（URL・連絡先・手順）を追加してください',
  urgency: '「いつまでに」を具体的な日付や時期で明記し、なぜ今やるべきかの理由を追加してください'
};

const MOCK_EXPERT_REVIEW = {
  reviews: [
    {
      persona: '市の担当者',
      avatar: '👩‍💼',
      role: '行政予算の視点',
      roleColor: '#5BA4A4',
      comments: [
        '実績の数字にもう少し具体性がほしい（延べ人数・前年度比など）',
        '予算額の根拠を示すと社内で決定しやすい'
      ]
    },
    {
      persona: '地元企業の社長',
      avatar: '🏢',
      role: '企業経営の視点',
      roleColor: '#D4A853',
      comments: [
        '社内報・HP掲載のメリットをもう少し具体的に（掲載事例など）',
        '月額より年額表示の方が社内検討しやすい'
      ]
    },
    {
      persona: '地域の協力者',
      avatar: '🙋',
      role: '手伝う側の視点',
      roleColor: '#7B9E6B',
      comments: [
        '「月1回でいい」と書いてあると参加のハードルが下がって助かる',
        '具体的に何をするかがもう少しわかるといいかも（見守り？遊び相手？）'
      ]
    }
  ],
  suggestions: [
    {
      id: 's1',
      tab: 'profile',
      reviewerIndex: 0,
      reason: '実績の具体性向上',
      before: '年間延べ約400名が利用する見込み',
      after: '年間延べ432名が利用（出席簿ベース）。前年度比120%の増加'
    },
    {
      id: 's2',
      tab: 'plan',
      reviewerIndex: 0,
      reason: '時限の明確化',
      before: '市の担当課に電話して面談の日取りを決める',
      after: '市の担当課に電話して面談の日取りを決める（今週中に。3月の予算編成に間に合わせるため）'
    },
    {
      id: 's3',
      tab: 'funding',
      reviewerIndex: 1,
      reason: '予算根拠の追加',
      before: '来年度も補助を受けるため、面談＋実績報告を行います',
      after: '来年度も補助を受けるため、面談＋実績報告を行います。申請書類の提出期限は例年1月末です'
    },
    {
      id: 's4',
      tab: 'messages',
      reviewerIndex: 1,
      reason: '企業メリットの具体化',
      before: '社内報や会社HPで「地域の子ども支援」として紹介可能',
      after: '社内報に掲載可能（実績：年間432名の子どもを支援）。会社HPの「地域貢献」特集にも素材をお渡しします'
    },
    {
      id: 's5',
      tab: 'plan',
      reviewerIndex: 2,
      reason: 'ボランティアの役割明確化',
      before: '手伝ってくれる人を2人みつける',
      after: '手伝ってくれる人を2人みつける（見守り・宿題サポートなど、できることからでOK）'
    }
  ]
};

// ── POST /api/expert-review ──
router.post('/expert-review', async (req, res) => {
  try {
    const { outputs } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ success: true, degraded: false, source: 'mock', ...MOCK_EXPERT_REVIEW });
    }

    // Try real Gemini expert review
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const reviewPrompt = `あなたは文書レビューの専門家です。以下の4つの出力を「受け取り手」の視点でレビューしてください。

## レビュアー3名
1. 市の担当者（行政予算の視点）：この書類で予算を通せるか？実績は具体的か？
2. 地元企業の社長（企業経営の視点）：この協賛提案で社内で決められるか？メリットは明確か？
3. 地域の協力者（手伝う側の視点）：ボランティアとして参加したくなるか？何をするか明確か？

## 出力するJSON形式
{
  "reviews": [
    {
      "persona": "市の担当者",
      "avatar": "👩‍💼",
      "role": "行政予算の視点",
      "roleColor": "#5BA4A4",
      "comments": ["指摘1", "指摘2"]
    },
    {
      "persona": "地元企業の社長",
      "avatar": "🏢",
      "role": "企業経営の視点",
      "roleColor": "#D4A853",
      "comments": ["指摘1", "指摘2"]
    },
    {
      "persona": "地域の協力者",
      "avatar": "🙋",
      "role": "手伝う側の視点",
      "roleColor": "#7B9E6B",
      "comments": ["指摘1", "指摘2"]
    }
  ],
  "suggestions": [
    {
      "id": "s1",
      "tab": "profile|plan|funding|messages",
      "reviewerIndex": 0,
      "reason": "改善理由（短く）",
      "before": "元のテキスト（完全一致で）",
      "after": "改善後のテキスト"
    }
  ]
}

注意:
- suggestionsは4〜6件
- beforeは元テキストから正確にコピーすること
- afterは具体的な改善案を書くこと
- tabは profile, plan, funding, messages のいずれか

【活動紹介】
${(outputs.profile || '').substring(0, 800)}

【90日プラン】
${(outputs.plan || '').substring(0, 800)}

【資金計画】
${(outputs.funding || '').substring(0, 800)}

【文章パック】
${(outputs.messages || '').substring(0, 800)}

JSONのみ出力してください。`;

      const result = await model.generateContent(reviewPrompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json({ success: true, degraded: false, source: 'gemini', ...parsed });
      }
    } catch (e) {
      console.error('Gemini expert review failed, using mock:', e.message);
    }

    res.json({ success: true, degraded: true, source: 'mock-fallback', error_code: 'UPSTREAM_ERROR', error_message: 'Gemini expert review unavailable', ...MOCK_EXPERT_REVIEW });
  } catch (err) {
    console.error('Expert review error:', err);
    res.status(500).json({ success: false, error_code: 'INTERNAL_ERROR', error_message: err.message || 'Expert review failed' });
  }
});

// ── POST /api/audit ──
router.post('/audit', async (req, res) => {
  try {
    const { outputs } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ success: true, degraded: false, source: 'mock', audit: MOCK_AUDIT });
    }

    // Try real Gemini audit
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const auditPrompt = `以下の4つの出力に対して、それぞれ4軸で品質を◎○△で採点してください。

軸の定義：
- action: 読んだ直後に何をすべきかが明確か
- motivation: なぜやるべきかの価値が伝わるか
- barrier: すぐ実行できる状態か
- urgency: いつまでにやるかが明確か

採点基準：◎=完璧 ○=概ね良い △=改善必要

JSON形式で返してください（コメント付き）：
{"profile":{"scores":{"action":"◎","motivation":"○","barrier":"◎","urgency":"△"},"comments":{"action":"理由","motivation":"理由","barrier":"理由","urgency":"理由"}},"plan":{...},"funding":{...},"messages":{...}}

【活動紹介】${(outputs.profile || '').substring(0, 600)}
【90日プラン】${(outputs.plan || '').substring(0, 600)}
【資金計画】${(outputs.funding || '').substring(0, 600)}
【文章パック】${(outputs.messages || '').substring(0, 600)}`;

      const result = await model.generateContent(auditPrompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const audit = JSON.parse(jsonMatch[0]);
        return res.json({ success: true, degraded: false, source: 'gemini', audit });
      }
    } catch (e) {
      console.error('Gemini audit failed, using mock:', e.message);
    }

    res.json({ success: true, degraded: true, source: 'mock-fallback', error_code: 'UPSTREAM_ERROR', error_message: 'Gemini audit unavailable', audit: MOCK_AUDIT });
  } catch (err) {
    console.error('Audit error:', err);
    res.status(500).json({ success: false, error_code: 'INTERNAL_ERROR', error_message: err.message || 'Audit failed' });
  }
});

// ── POST /api/improve ──
router.post('/improve', async (req, res) => {
  try {
    const { tabName, content, weakAxis, comment } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      // Mock: add a "improved" banner to the content
      const label = AXIS_LABELS[weakAxis] || weakAxis;
      const improved = content.replace(
        /^(## .+)$/m,
        `$1\n\n> 🔄 **自動改善済み**：「${label}」を強化しました`
      );
      return res.json({ success: true, degraded: false, source: 'mock', improved });
    }

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const improvePrompt = `以下のテキストを改善してください。

改善指示: ${AXIS_IMPROVE_INSTRUCTIONS[weakAxis] || '品質を向上させてください'}
審査コメント: ${comment || ''}

元のテキスト:
${content}

改善後のテキストのみを出力してください。Markdownフォーマットは維持してください。`;

      const result = await model.generateContent(improvePrompt);
      const improved = result.response.text();
      return res.json({ success: true, degraded: false, source: 'gemini', improved });
    } catch (e) {
      console.error('Gemini improve failed:', e.message);
    }

    res.json({ success: false, error: 'Improvement failed' });
  } catch (err) {
    console.error('Improve error:', err);
    res.json({ success: false, error: 'Improvement failed' });
  }
});

module.exports = router;
