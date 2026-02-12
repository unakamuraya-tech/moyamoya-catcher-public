/* ═══════════════════════════════════════════
   Moyamoya Catcher — Conversation Engine
   v1.1 — 3-perspective review fixes applied
   ═══════════════════════════════════════════ */

// ── State ──
const state = {
  currentStep: -1,
  slots: {
    source_mode: null,
    activity_summary: null,
    activity_type: null,
    activity_place: null,
    activity_frequency: null,
    topic: null,
    risk_type: null,
    deadline_window: null,
    gap_range: null,
    allies: null,
    intent: null,
    desired_output: null
  },
  outputs: null,
  freeInputHandler: null, // D4: moved from window global
  freeInputMeta: null
};

// ── Handlers (D1: extracted from STEPS) ──

async function handleSourceModeSelect(value) {
  if (value === 'url') {
    showFreeInput('URLを入力してください', handleUrlInput);
    return false;
  }
  if (value === 'sns') {
    showFreeInput('プロフィール文をペーストしてください', handleSnsInput);
    return false;
  }
  state.slots.activity_summary = null;
  return true;
}

async function handleSummaryConfirmSelect(value) {
  if (value === 'edit') {
    showFreeInput('修正点を教えてください', async (text) => {
      addUserMessage(text);
      hideFreeInput();

      const loadingMsgId = addAiMessage('修正を反映しています… ✏️');

      try {
        const res = await fetch('/api/update-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentSummary: state.slots.activity_summary,
            correction: text
          })
        });
        const data = await res.json();

        // Remove loading message
        const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
        if (loadingEl) loadingEl.remove();

        if (data.success && data.summary) {
          state.slots.activity_summary = data.summary;
          // Show updated summary
          const updatedMsg = buildSummaryConfirmMessage();
          addAiMessage('修正しました！こちらで合っていますか？\n\n' + updatedMsg, { rawHtml: true });
          showChips([
            { label: '✅  だいたい合っている', value: 'confirmed', letter: 'A' },
            { label: '✏️  もう一度修正する', value: 'edit', letter: 'B' }
          ]);
        } else {
          addAiMessage('ありがとうございます、反映しました！次に進みますね。');
          advanceStep();
        }
      } catch (err) {
        const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
        if (loadingEl) loadingEl.remove();
        addAiMessage('ありがとうございます、反映しました！次に進みますね。');
        advanceStep();
      }
    });
    return false;
  }
  return true;
}

function buildSummaryConfirmMessage() {
  const s = state.slots.activity_summary;
  if (!s) return '';
  return renderSummaryCard([
    `<strong>📌 活動：</strong>${s.activity}`,
    `<strong>📍 場所：</strong>${s.location}`,
    `<strong>📅 ペース：</strong>${s.schedule}`,
    `<strong>👥 規模：</strong>${s.participants}`,
    `<strong>🏠 運営：</strong>${s.operator}`,
    `<strong>🕐 開始：</strong>${s.started}`,
    `<strong>💰 お金：</strong>${s.funding}`
  ], 'サイトを読みました。こういう理解で合っていますか？');
}

// U3: topic-aware risk_type message
function buildRiskTypeMessage() {
  const topic = state.slots.topic;
  const messages = {
    money: 'お金の不安、具体的に聞かせてください。\n今の状況に一番近いのはどれですか？',
    people: '人手の課題、大変ですよね。\nお金まわりの状況も聞かせてください。',
    vague: '「漠然と不安」って、一番相談しにくいやつですよね。\n今の状況に一番近いのはどれですか？'
  };
  return messages[topic] || '現在の状況に一番近いのはどれですか？';
}

function buildSummaryGenerateMessage() {
  const s = state.slots;
  const topicLabel = {
    money: 'お金のこと',
    people: '人手のこと',
    vague: '漠然とした不安',
  }[s.topic] || s.topic;
  const riskLabel = {
    next_year_uncertain: '来年度が未確定',
    cut_risk: '減額・打ち切りリスク',
    self_funded: '自費で運営',
  }[s.risk_type] || s.risk_type;

  return renderSummaryCard([
    `<strong>課題：</strong>${escapeAttr(topicLabel)}（${escapeAttr(riskLabel)}）`,
    `<strong>スケジュール：</strong>${escapeAttr({'2-3w': '1か月以内', '1-2m': '1か月以内', '3m+': '1〜3か月', 'まだ決まっていない': 'まだ決まっていない / それ以上先'}[s.deadline_window] || s.deadline_window || '未定')}`,
    `<strong>余裕資金の目安：</strong>${escapeAttr({'3万': '月5万円くらいまで', '5万': '月5万円くらいまで', '10万': '月10万円以上', '15万+': '月10万円以上', 'まだ分からない': 'まだ分からない'}[s.gap_range] || s.gap_range || '未定')}`,
    `<strong>味方：</strong>${escapeAttr(getAlliesLabel(s.allies))}`,
    `<strong>方向性：</strong>継続提案・資金複線化・体制づくり`
  ], 'ここまでの整理です 📋');
}

function buildManualActivitySummaryCard() {
  const typeMap = {
    kodomo: '子ども・教育（居場所/学習支援）',
    ibasho: '福祉・暮らし（高齢者/生活支援）',
    event: '地域活動（イベント/交流/その他）',
    welfare: '福祉/生活支援',
    other_local: 'その他の地域活動'
  };
  const placeMap = {
    kominkan: '対面（公民館・教育施設など）',
    school: '対面（公民館・教育施設など）',
    online: 'オンライン中心',
    mixed: '両方（オンライン＋対面）',
    other_place: 'その他の場所'
  };
  const freqMap = {
    weekly: '週1回以上',
    biweekly: '月1〜3回',
    monthly: '月1〜3回',
    irregular: '不定期・これから始める',
    starting: '不定期・これから始める'
  };

  return renderSummaryCard([
    `<strong>📌 活動タイプ：</strong>${escapeAttr(typeMap[state.slots.activity_type] || state.slots.activity_type || '未定')}`,
    `<strong>📍 主な場所：</strong>${escapeAttr(placeMap[state.slots.activity_place] || state.slots.activity_place || '未定')}`,
    `<strong>📅 開催頻度：</strong>${escapeAttr(freqMap[state.slots.activity_frequency] || state.slots.activity_frequency || '未定')}`
  ], '活動内容を確認しました。次に、いま気になっていることを聞かせてください。');
}

// ── Conversation Steps ──
const STEPS = [
  {
    id: 'source_mode',
    aiMessage: 'こんにちは！😊\nまず、あなたの活動のことを少しだけ教えてください。\n私（AI）に伝えるのに、どの方法がやりやすいですか？',
    chips: [
      { label: '🔗  活動のWebサイト・ブログのURLを入れる', value: 'url', letter: 'A' },
      { label: '📋  SNSプロフィール文をコピペする', value: 'sns', letter: 'B' },
      { label: '💬  どちらもない → 選択式で教える', value: 'none', letter: 'C' }
    ],
    slot: 'source_mode',
    onSelect: handleSourceModeSelect
  },
  {
    id: 'summary_confirm',
    aiMessage: null,
    chips: [
      { label: '✅  だいたい合っている', value: 'confirmed', letter: 'A' },
      { label: '✏️  修正したいところがある', value: 'edit', letter: 'B' }
    ],
    slot: null,
    skip: () => !state.slots.activity_summary,
    onSelect: handleSummaryConfirmSelect,
    dynamicMessage: buildSummaryConfirmMessage
  },
  {
    id: 'activity_type',
    aiMessage: '選択式で進める場合、最初に活動のことを教えてください。\nいちばん近いものはどれですか？',
    chips: [
      { label: '👦  子ども・教育（居場所/学習支援）', value: 'kodomo', letter: 'A' },
      { label: '🏠  福祉・暮らし（高齢者/生活支援）', value: 'ibasho', letter: 'B' },
      { label: '🌱  地域活動（イベント/交流/その他）', value: 'event', letter: 'C' }
    ],
    slot: 'activity_type',
    skip: () => state.slots.source_mode !== 'none'
  },
  {
    id: 'activity_place',
    aiMessage: '活動場所はどこが近いですか？',
    chips: [
      { label: '🏢  対面（公民館・教育施設など）', value: 'kominkan', letter: 'A' },
      { label: '💻  オンライン中心', value: 'online', letter: 'B' },
      { label: '🔁  両方（オンライン＋対面）', value: 'mixed', letter: 'C' }
    ],
    slot: 'activity_place',
    skip: () => state.slots.source_mode !== 'none'
  },
  {
    id: 'activity_frequency',
    aiMessage: '活動頻度はどれが近いですか？',
    chips: [
      { label: '📅  週1回以上', value: 'weekly', letter: 'A' },
      { label: '🗓️  月1〜3回', value: 'biweekly', letter: 'B' },
      { label: '🌱  不定期・これから始める', value: 'irregular', letter: 'C' }
    ],
    slot: 'activity_frequency',
    skip: () => state.slots.source_mode !== 'none'
  },
  {
    id: 'activity_confirm',
    aiMessage: null,
    chips: [
      { label: '✅  この内容で次へ進む', value: 'ok', letter: 'A' }
    ],
    slot: null,
    dynamicMessage: buildManualActivitySummaryCard,
    skip: () => state.slots.source_mode !== 'none'
  },
  {
    id: 'topic',
    aiMessage: 'ありがとうございます 🙏\n今日はどんなことが気になっていますか？',
    chips: [
      { label: '💰  お金のこと（活動費・資金）', value: 'money', letter: 'A' },
      { label: '🤝  人手のこと（一人で回してる）', value: 'people', letter: 'B' },
      { label: '☁️  この先続けられるか漠然と不安', value: 'vague', letter: 'C' }
    ],
    slot: 'topic'
  },
  {
    id: 'risk_type',
    aiMessage: null,
    dynamicMessage: buildRiskTypeMessage, // U3: dynamic based on topic
    chips: [
      { label: '📅  今年度は大丈夫。でも来年が読めない', value: 'next_year_uncertain', letter: 'A' },
      { label: '⚠️  減額・打ち切りの話が出ている', value: 'cut_risk', letter: 'B' },
      { label: '💳  公的支援なしで自費でやっている', value: 'self_funded', letter: 'C' }
    ],
    slot: 'risk_type'
  },
  {
    id: 'deadline_window',
    aiMessage: '手続きや相談のスケジュールがあれば教えてください 📆\nざっくりでOKです',
    chips: [
      { label: '⏰  1か月以内', value: '2-3w', letter: 'A' },
      { label: '🗓️  1〜3か月', value: '1-2m', letter: 'B' },
      { label: '❓  それ以上先 / まだ決まっていない', value: '3m+', letter: 'C' }
    ],
    slot: 'deadline_window'
  },
  {
    id: 'gap_range',
    aiMessage: 'これだけあったら活動にもう少し余裕が出るな、という金額感はどれに近いですか？\n仮置きでOKです 💡',
    chips: [
      { label: '💴  月5万円くらいまで', value: '3万', letter: 'A' },
      { label: '💰  月10万円以上', value: '10万', letter: 'B' },
      { label: '❓  まだ分からない', value: 'まだ分からない', letter: 'C' }
    ],
    slot: 'gap_range'
  },
  {
    id: 'allies',
    aiMessage: 'あなたの活動を応援してくれている人はいますか？ 🌱\n周りからのサポート状況で、次の打ち手が変わります。',
    chips: [
      { label: '😐  協力はあまりない', value: 'none', letter: 'A' },
      { label: '🎁  ちょこちょこ応援がある', value: 'small_support', letter: 'B' },
      { label: '🙋  頼みたい人はいるが巻き込めていない', value: 'want_help', letter: 'C' }
    ],
    slot: 'allies'
  },
  {
    id: 'intent',
    aiMessage: 'あと少しです！\nこの活動、これからどうしていきたいですか？',
    chips: [
      { label: '💪  続けたい', value: 'continue', letter: 'A' },
      { label: '🌿  無理しない範囲で', value: 'continue_light', letter: 'B' },
      { label: '🤝  引き継ぎも視野に', value: 'handover', letter: 'C' }
    ],
    slot: 'intent'
  },
  {
    id: 'desired_output',
    aiMessage: 'ありがとうございます ✨\nここまでの情報で、お渡しできるものがあります。\nまず一番ほしいのはどれですか？',
    chips: [
      { label: '💰  お金の作り方（協賛・寄付）', value: 'A', letter: 'A' },
      { label: '🗣️  まわりへの頼み方・巻き込み方', value: 'B', letter: 'B' },
      { label: '📦  全部まとめて出してほしい', value: 'C', letter: 'C' }
    ],
    slot: 'desired_output'
  },
  {
    id: 'summary_generate',
    aiMessage: null,
    chips: [],
    slot: null,
    isGenerateStep: true,
    dynamicMessage: buildSummaryGenerateMessage
  }
];

function getAlliesLabel(val) {
  const m = {
    none: '具体的な協力なし',
    small_support: 'ちょこちょこ応援あり',
    want_help: '協力者はいるが頼み方不明',
  };
  return m[val] || val || '未定';
}

// ── DOM Helpers ──
const $ = (sel) => document.querySelector(sel);
const chatMessages = () => $('#chat-messages');
const chipsArea = () => $('#chips-area');

// D2: Safe rendering — no raw HTML detection
function renderSummaryCard(items, prefix) {
  const listItems = items.map(item => `<li>${item}</li>`).join('');
  const cardHtml = `<div class="summary-card"><ul>${listItems}</ul></div>`;
  // prefix is trusted static text, cardHtml contains only trusted template strings
  return prefix ? `${prefix}\n\n${cardHtml}` : cardHtml;
}

function escapeAttr(text) {
  if (text == null) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addAiMessage(text, options = {}) {
  const msgId = options.id || ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  const container = chatMessages();
  const div = document.createElement('div');
  div.className = 'message ai';
  div.setAttribute('data-msg-id', msgId);
  div.setAttribute('data-step', String(state.currentStep));

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🎯';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble message-text';

  if (options.rawHtml) {
    // Only used for trusted, internally-built HTML (summary cards)
    bubble.innerHTML = text.replace(/\n(?!<)/g, '<br>');
  } else {
    bubble.textContent = text;
    // Preserve line breaks in plain text
    bubble.innerHTML = bubble.innerHTML.replace(/\n/g, '<br>');
  }

  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
  return msgId;
}

function addUserMessage(text) {
  const container = chatMessages();
  const div = document.createElement('div');
  div.className = 'message user';
  div.setAttribute('data-step', String(state.currentStep));

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '👤';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
}

function addTypingIndicator() {
  const container = chatMessages();
  const div = document.createElement('div');
  div.className = 'message ai';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="message-avatar">🎯</div>
    <div class="message-bubble">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function showChips(chips) {
  const area = chipsArea();
  area.innerHTML = '';
  area.classList.add('has-chips');
  chips.forEach(chip => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.onclick = () => selectChip(chip);
    // D2: use textContent for label, innerHTML only for trusted chip-letter
    const letterSpan = document.createElement('span');
    letterSpan.className = 'chip-letter';
    letterSpan.textContent = chip.letter;
    const labelText = document.createTextNode(chip.label.replace(/^[^\s]+\s+/, ''));
    btn.appendChild(letterSpan);
    btn.appendChild(labelText);
    area.appendChild(btn);
  });
  if (state.currentStep > 0) {
    const backBtn = document.createElement('button');
    backBtn.className = 'chip chip-back';
    backBtn.textContent = '← ひとつ前に戻る';
    backBtn.onclick = () => goBackToPreviousStep();
    area.appendChild(backBtn);
  }
  // Fix: scroll after chips are rendered so AI message stays visible
  scrollToBottom();
}

function clearChips() {
  const area = chipsArea();
  area.innerHTML = '';
  area.classList.remove('has-chips');
}

function showFreeInput(placeholder, handler, options = {}) {
  const area = $('#free-input-area');
  const input = $('#free-input');
  const cancelBtn = $('#free-input-cancel');
  area.classList.remove('hidden');
  input.placeholder = placeholder || '自由に入力してください…';
  input.value = '';
  input.focus();
  state.freeInputHandler = handler; // D4: use state instead of window
  const step = STEPS[state.currentStep];
  const fallbackChips = options.fallbackChips || (step && step.chips ? step.chips : null);
  state.freeInputMeta = { fallbackChips };
  if (cancelBtn) {
    const hasFallback = !!(fallbackChips && fallbackChips.length);
    cancelBtn.classList.toggle('hidden', !hasFallback);
  }
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) submitFreeInput();
  };
}

function hideFreeInput() {
  $('#free-input-area').classList.add('hidden');
  state.freeInputHandler = null; // D4: clean up
  state.freeInputMeta = null;
  const cancelBtn = $('#free-input-cancel');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function scrollToBottom() {
  const container = chatMessages();
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

function updateProgress() {
  const bar = $('#progress-bar');
  if (!bar) return;
  // Count only non-skipped steps for accurate progress
  let done = 0;
  let total = 0;
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (step.skip && step.skip()) continue; // skip this step
    total++;
    if (i <= state.currentStep) done++;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill = bar.querySelector('.progress-bar-fill');
  const label = bar.querySelector('.progress-bar-label');
  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = done + '/' + total;
}

function removeMessagesFrom(stepIndex) {
  const container = chatMessages();
  const messages = container.querySelectorAll('.message');
  messages.forEach((msg) => {
    const step = Number(msg.dataset.step);
    if (!Number.isNaN(step) && step >= stepIndex) {
      msg.remove();
    }
  });
}

function clearSlotsFromStep(stepIndex) {
  for (let i = stepIndex; i < STEPS.length; i++) {
    const slotKey = STEPS[i] && STEPS[i].slot;
    if (slotKey && Object.prototype.hasOwnProperty.call(state.slots, slotKey)) {
      state.slots[slotKey] = null;
    }
  }
}

function goBackToPreviousStep() {
  // Skip over steps that would be skipped in forward flow
  let targetStep = state.currentStep - 1;
  while (targetStep > 0 && STEPS[targetStep].skip && STEPS[targetStep].skip()) {
    targetStep--;
  }
  targetStep = Math.max(0, targetStep);
  clearSlotsFromStep(targetStep);
  removeMessagesFrom(targetStep);
  state.currentStep = targetStep - 1;
  hideFreeInput();
  clearChips();
  advanceStep();
}

// ── Flow Control ──

function startChat() {
  $('#hero').classList.add('hidden');
  $('#app').classList.remove('hidden');
  state.currentStep = -1;
  logEvent('session_started');
  advanceStep();
}

async function advanceStep() {
  state.currentStep++;
  const step = STEPS[state.currentStep];
  if (!step) return;

  if (step.skip && step.skip()) {
    advanceStep();
    return;
  }

  updateProgress();
  clearChips();
  hideFreeInput();

  const msg = step.dynamicMessage ? step.dynamicMessage() : step.aiMessage;
  if (msg) {
    addTypingIndicator();
    await delay(600 + Math.random() * 400);
    removeTypingIndicator();
    // Check if message contains HTML (summary cards)
    const hasHtml = msg.includes('<div class="summary-card"');
    addAiMessage(msg, { rawHtml: hasHtml });
  }

  if (step.isGenerateStep) {
    const area = chipsArea();
    area.innerHTML = `
      <div class="generate-area">
        <button class="btn-primary" onclick="generateOutputs()">
          ✨ 生成する
        </button>
        <div style="margin-top: 0.5rem;">
          <button class="btn-secondary" onclick="goBack()" style="font-size: 0.8rem;">
            ← 戻って修正する
          </button>
        </div>
      </div>
    `;
    return;
  }

  if (step.chips && step.chips.length > 0) {
    await delay(200);
    showChips(step.chips);
    // Fix: ensure latest AI message is visible above chips
    setTimeout(() => scrollToBottom(), 100);
  }
}

async function selectChip(chip) {
  const step = STEPS[state.currentStep];
  if (!step) return;
  logEvent('step_answered', { stepId: step.id, value: chip.value });

  // Handle "other" free input
  if (chip.value === 'other' && step.onOther) {
    addUserMessage(chip.label);
    clearChips();
    showFreeInput('自由に入力してください…', (text) => {
      addUserMessage(text);
      // U6: Acknowledge free input
      addAiMessage('ありがとう、受け取りました 👍');
      if (step.slot) state.slots[step.slot] = text;
      hideFreeInput();
      advanceStep();
    }, { fallbackChips: step.chips });
    return;
  }

  addUserMessage(chip.label);
  clearChips();

  if (step.slot) {
    state.slots[step.slot] = chip.value;
  }

  if (step.onSelect) {
    const shouldAdvance = await step.onSelect(chip.value);
    if (shouldAdvance === false) return;
  }

  advanceStep();
}

// ── URL / SNS Handlers ──

async function handleUrlInput(url) {
  addUserMessage(url);
  hideFreeInput();

  // #1: Progressive loading messages
  const loadingMessages = [
    'サイトを読みに行っています… 🔍',
    '内容を分析しています… 📖',
    'まとめています… ✨'
  ];
  let msgIndex = 0;
  const loadingMsgId = addAiMessage(loadingMessages[0]);
  const progressInterval = setInterval(() => {
    msgIndex++;
    if (msgIndex < loadingMessages.length) {
      const el = document.querySelector(`[data-msg-id="${loadingMsgId}"] .message-text`);
      if (el) el.textContent = loadingMessages[msgIndex];
    }
  }, 3000);

  try {
    const res = await fetch('/api/summarize-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    clearInterval(progressInterval);
    // Remove loading message
    const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
    if (loadingEl) loadingEl.remove();

    if (data.success && data.summary) {
      state.slots.activity_summary = data.summary;
      state.slots.source_mode = 'url';
      advanceStep();
    } else {
      addAiMessage('URLの読み取りがうまくいきませんでした。\nSNSプロフィール文をコピペするか、選択式で教えてください。');
      showChips([
        { label: '📋  SNSプロフィール文をコピペする', value: 'sns', letter: 'A' },
        { label: '💬  選択式で教える', value: 'none', letter: 'B' }
      ]);
    }
  } catch (err) {
    clearInterval(progressInterval);
    const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
    if (loadingEl) loadingEl.remove();
    addAiMessage('通信エラーが発生しました。選択式で進めましょう。');
    state.slots.source_mode = 'none';
    advanceStep();
  }
}

async function handleSnsInput(text) {
  addUserMessage(text);
  hideFreeInput();

  // Show loading messages
  const loadingMessages = [
    'プロフィールを読んでいます… 📖',
    '活動内容を分析しています… 🔍',
    'まとめています… ✨'
  ];
  let msgIndex = 0;
  const loadingMsgId = addAiMessage(loadingMessages[0]);
  const progressInterval = setInterval(() => {
    msgIndex++;
    if (msgIndex < loadingMessages.length) {
      const el = document.querySelector(`[data-msg-id="${loadingMsgId}"] .message-text`);
      if (el) el.textContent = loadingMessages[msgIndex];
    }
  }, 2000);

  try {
    const res = await fetch('/api/summarize-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    clearInterval(progressInterval);
    const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
    if (loadingEl) loadingEl.remove();

    if (data.success && data.summary) {
      state.slots.activity_summary = data.summary;
      state.slots.source_mode = 'sns';
      advanceStep();
    } else {
      addAiMessage('うまく読み取れませんでした。\n別の方法を試してみましょう。');
      showChips([
        { label: '🔗  URLを入力する', value: 'url', letter: 'A' },
        { label: '💬  選択式で教える', value: 'none', letter: 'B' }
      ]);
    }
  } catch (err) {
    clearInterval(progressInterval);
    const loadingEl = document.querySelector(`[data-msg-id="${loadingMsgId}"]`);
    if (loadingEl) loadingEl.remove();
    addAiMessage('通信エラーが発生しました。選択式で進めましょう。');
    state.slots.source_mode = 'none';
    advanceStep();
  }
}

// ── Free Input Submit ──

window.submitFreeInput = function() {
  const input = $('#free-input');
  const text = input.value.trim();
  if (!text) return;
  if (text === 'ひとつ前に戻る' || text === '戻る') {
    goBackToPreviousStep();
    return;
  }
  // Route to free chat handler if in chat mode
  if (state.freeChatMode && state.freeChatHandler) {
    state.freeChatHandler(text);
  } else if (state.freeInputHandler) { // D4: use state
    state.freeInputHandler(text);
  }
};

window.cancelFreeInput = function() {
  const fallbackChips = state.freeInputMeta && state.freeInputMeta.fallbackChips;
  hideFreeInput();
  if (fallbackChips && fallbackChips.length) {
    showChips(fallbackChips);
  }
};

// ── Generate ──

async function generateOutputs() {
  clearChips();
  const loading = $('#loading-overlay');
  loading.classList.remove('hidden');
  trapFocus(loading);
  logEvent('generation_started');

  // Hide cancel button initially
  const cancelBtn = document.getElementById('loading-cancel-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');

  // AbortController for cancellation
  const abortController = new AbortController();
  state._generateAbort = abortController;

  // Show cancel button after 20s timeout
  const cancelTimer = setTimeout(() => {
    if (cancelBtn) cancelBtn.classList.remove('hidden');
  }, 20000);

  // #3: Progressive loading steps
  const loadingSteps = [
    '📋 活動紹介を作成しています…',
    '📅 90日プランを組み立てています…',
    '💰 資金計画を計算しています…',
    '✉️ 文章パックをつくっています…',
    '✨ 最終チェックしています…'
  ];
  let stepIndex = 0;
  const loadingTextEl = loading.querySelector('.loading-text');
  const loadingSubEl = loading.querySelector('.loading-sub');
  if (loadingTextEl) loadingTextEl.textContent = loadingSteps[0];
  if (loadingSubEl) loadingSubEl.textContent = 'あなた専用のプランを作っています';
  const loadingInterval = setInterval(() => {
    stepIndex++;
    if (stepIndex < loadingSteps.length && loadingTextEl) {
      loadingTextEl.textContent = loadingSteps[stepIndex];
    }
  }, 4000);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: state.slots, useMock: false }),
      signal: abortController.signal
    });
    const data = await res.json();
    clearInterval(loadingInterval);
    clearTimeout(cancelTimer);
    loading.classList.add('hidden');
    releaseFocus();

    if (data.success) {
      state.outputs = data.outputs;
      // D5: Show fallback notice if mock
      const isMock = data.source === 'mock' || data.source === 'mock-fallback';
      state.isMock = isMock;
      logEvent('generation_succeeded', { source: data.source || 'api' });
      showResults(data.outputs, isMock);
      // U4: Don't add chat message that will be hidden behind overlay
    } else {
      addAiMessage('生成中にエラーが発生しました。もう一度お試しください。');
      logEvent('generation_failed', { reason: 'api_error' });
    }
  } catch (err) {
    clearInterval(loadingInterval);
    clearTimeout(cancelTimer);
    loading.classList.add('hidden');
    releaseFocus();
    if (err.name === 'AbortError') {
      addAiMessage('生成をキャンセルしました。もう一度試すか、質問内容を変えてみてください。');
      logEvent('generation_failed', { reason: 'cancelled' });
    } else {
      addAiMessage('通信エラーが発生しました。ページを再読み込みしてお試しください。');
      logEvent('generation_failed', { reason: 'network_error' });
    }
  } finally {
    state._generateAbort = null;
  }
}

// ── Results ──

function showResults(outputs, isMock) {
  const overlay = $('#results-overlay');
  overlay.classList.remove('hidden');
  trapFocus(overlay);

  renderTab('tab-profile', outputs.profile);
  renderTab('tab-plan', outputs.plan);
  renderTab('tab-funding', outputs.funding);
  renderTab('tab-messages', outputs.messages);

  // D5: Show mock notice
  const notice = document.getElementById('results-mock-notice');
  if (notice) {
    notice.classList.toggle('hidden', !isMock);
  }

  // U4: Show success message inside overlay
  const successBanner = document.getElementById('results-success');
  if (successBanner) {
    successBanner.classList.remove('hidden');
    setTimeout(() => successBanner.classList.add('hidden'), 4000);
  }

  switchTab('profile');

  // Apply accordion to messages tab
  applyMessagesAccordion();
}

// ── Expert Review (Recipient-Perspective Flow) ──

const TAB_LABELS = {
  profile: '活動紹介', plan: '90日プラン', funding: '資金計画', messages: '文章パック'
};

// Review state
const reviewState = {
  reviews: [],
  suggestions: [],
  currentSuggestion: 0,
  decisions: [],        // { action: 'accept'|'reject'|'alternative', text?: string }
  originalOutputs: null // snapshot before changes
};

window.requestExpertReview = async function(accordionIndex) {
  const accordions = document.querySelectorAll('.msg-accordion');
  if (typeof accordionIndex !== 'number' || !accordions[accordionIndex]) return;

  const accordion = accordions[accordionIndex];
  const btn = accordion.querySelector('.btn-expert-inline');

  // Remember which button triggered the review
  reviewState.activeBtn = btn;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '🔍 確認中…';
    btn.classList.add('reviewing');
  }

  try {
    reviewState.originalOutputs = JSON.parse(JSON.stringify(state.outputs));

    // Show overlay with loading
    const overlay = document.getElementById('review-overlay');
    overlay.classList.remove('hidden');
    trapFocus(overlay);
    logEvent('expert_review_started', { accordionIndex });

    // Set header to loading state
    const reviewHeader = overlay.querySelector('.review-header h2');
    const reviewSubtitle = overlay.querySelector('.review-subtitle');
    if (reviewHeader) reviewHeader.textContent = '📩 この文章を確認しています…';
    if (reviewSubtitle) reviewSubtitle.textContent = '受け取る側の視点で確認中です';

    const reviewerCards = document.getElementById('reviewer-cards');
    reviewerCards.innerHTML = `
      <div class="reviewer-loading">
        <div class="loading-spinner" style="width:48px;height:48px;margin:0 auto;"></div>
        <p class="reviewer-loading-text">受け取る側の気持ちで読んでいます… 📖</p>
      </div>
    `;

    // Reset overlay phases
    document.getElementById('review-summary-bar').classList.add('hidden');
    document.getElementById('review-phase-reviewers').classList.remove('hidden');
    document.getElementById('review-phase-suggestions').classList.add('hidden');
    document.getElementById('review-phase-complete').classList.add('hidden');

    // Progressive loading messages
    const msgs = ['ポイントを整理しています… ✍️', 'レビューをまとめています… 📝'];
    let mi = 0;
    const loadTimer = setInterval(() => {
      mi++;
      if (mi < msgs.length) {
        const t = reviewerCards.querySelector('.reviewer-loading-text');
        if (t) t.textContent = msgs[mi];
      }
    }, 4000);

    // Get this accordion's text
    const bodyEl = accordion.querySelector('.msg-accordion-body');
    const sectionText = bodyEl ? bodyEl.innerText : '';
    const titleEl = accordion.querySelector('.msg-accordion-title');
    const sectionTitle = titleEl ? titleEl.textContent : '';

    // Call API
    const res = await fetch('/api/expert-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputs: state.outputs,
        sectionIndex: accordionIndex,
        sectionTitle: sectionTitle,
        sectionText: sectionText
      })
    });
    const data = await res.json();
    clearInterval(loadTimer);

    if (!data.success) throw new Error('Review failed');

    const allReviews = data.reviews || [];
    const allSuggestions = data.suggestions || [];

    // Match this accordion to the right reviewer
    let matchIdx = accordionIndex < allReviews.length ? accordionIndex : 0;
    for (let i = 0; i < allReviews.length; i++) {
      if (sectionTitle.includes(allReviews[i].persona)) {
        matchIdx = i;
        break;
      }
    }

    // Filter to only this reviewer + their suggestions
    const matchedReviewer = allReviews[matchIdx];
    const matchedSuggestions = allSuggestions
      .filter(s => s.reviewerIndex === matchIdx)
      .map(s => ({ ...s, reviewerIndex: 0 })); // re-index to 0

    // Set reviewState with filtered data
    reviewState.reviews = matchedReviewer ? [matchedReviewer] : [];
    reviewState.suggestions = matchedSuggestions;
    reviewState.currentSuggestion = 0;
    reviewState.decisions = [];

    // Update header to completed state
    if (reviewHeader) reviewHeader.textContent = '📩 この文章を確認しました';
    if (reviewSubtitle) reviewSubtitle.textContent = '文章を受け取る側の視点で確認しました';

    // Render single reviewer card in overlay
    reviewerCards.innerHTML = '';
    if (matchedReviewer) {
      const r = matchedReviewer;
      const color = r.roleColor || '#5BA4A4';
      const commentsHtml = r.comments.map(c => `<li>${escapeHtml(c)}</li>`).join('');

      reviewerCards.innerHTML = `
        <div class="reviewer-card" style="border-left-color:${color};">
          <div class="reviewer-card-header">
            <div class="reviewer-avatar">${r.avatar}</div>
            <div class="reviewer-info">
              <div class="reviewer-name">${escapeHtml(r.persona)}（${escapeHtml(r.role)}）</div>
            </div>
          </div>
          <ul class="reviewer-comments">${commentsHtml}</ul>
        </div>
      `;
    }

    // Show summary bar
    const summaryBar = document.getElementById('review-summary-bar');
    const countEl = document.getElementById('review-suggestion-count');
    countEl.textContent = `${matchedSuggestions.length}件の改善提案があります`;
    summaryBar.classList.remove('hidden');

  } catch (err) {
    console.error('Expert review failed:', err);
    document.getElementById('review-overlay').classList.add('hidden');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📩 この文章を確認してもらう';
      btn.classList.remove('reviewing');
    }
    showToast('確認に失敗しました。もう一度お試しください。', 'error');
    logEvent('expert_review_failed', { error: err.message || String(err) });
  }
};

// Utility for staggered animation
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── KPI Event Logging ──
// Anonymous session ID (privacy-first: random hex, no PII)
function getSessionId() {
  let sid = sessionStorage.getItem('kpi_session_id');
  if (!sid) {
    sid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    sessionStorage.setItem('kpi_session_id', sid);
  }
  return sid;
}

function logEvent(name, data = {}) {
  const entry = { event: name, ts: Date.now(), session_id: getSessionId(), ...data };
  console.info('[KPI]', name, entry);
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, {
        session_id: entry.session_id,
        step_id: entry.stepId,
        source: entry.source,
        reason: entry.reason,
        method: entry.method
      });
    }
  } catch (_) { /* gtag unavailable */ }
  try {
    const log = JSON.parse(sessionStorage.getItem('kpi_log') || '[]');
    log.push(entry);
    sessionStorage.setItem('kpi_log', JSON.stringify(log));
  } catch (_) { /* sessionStorage full or unavailable */ }
  // Server-side collection (fire-and-forget)
  try {
    navigator.sendBeacon('/api/events', JSON.stringify(entry));
  } catch (_) { /* beacon unavailable */ }
}

// ── Toast Notification ──
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Focus Trap for Dialogs (Stack-based for nested overlays) ──
const _focusTrapStack = [];

function trapFocus(overlayEl) {
  // Suspend parent trap's handler if one exists
  const parentTrap = _focusTrapStack.length > 0
    ? _focusTrapStack[_focusTrapStack.length - 1]
    : null;
  if (parentTrap && parentTrap.handler) {
    document.removeEventListener('keydown', parentTrap.handler);
  }

  // Push new trap onto stack
  const entry = {
    overlay: overlayEl,
    previousFocus: document.activeElement,
    handler: null
  };
  _focusTrapStack.push(entry);

  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = overlayEl.querySelectorAll(
      'button:not([disabled]):not(.hidden), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  entry.handler = handler;
  document.addEventListener('keydown', handler);

  // Focus first focusable element
  setTimeout(() => {
    const first = overlayEl.querySelector(
      'button:not([disabled]):not(.hidden), [href], input:not([disabled])'
    );
    if (first) first.focus();
  }, 100);
}

function releaseFocus() {
  const current = _focusTrapStack.pop();
  if (!current) return;

  // Remove current handler
  if (current.handler) {
    document.removeEventListener('keydown', current.handler);
  }

  // Restore parent trap if one exists
  if (_focusTrapStack.length > 0) {
    const parent = _focusTrapStack[_focusTrapStack.length - 1];
    // Re-register parent handler
    if (parent.handler) {
      document.addEventListener('keydown', parent.handler);
    }
    // Focus back into parent overlay
    setTimeout(() => {
      const first = parent.overlay.querySelector(
        'button:not([disabled]):not(.hidden), [href], input:not([disabled])'
      );
      if (first) first.focus();
    }, 50);
  } else if (current.previousFocus && current.previousFocus.focus) {
    current.previousFocus.focus();
  }
}

// ── Cancel Generation ──
window.cancelGeneration = function() {
  if (state._generateAbort) {
    state._generateAbort.abort();
  }
};

// ── Tab Arrow Key Navigation ──
(function initTabKeyboard() {
  document.addEventListener('DOMContentLoaded', () => {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;
    tablist.addEventListener('keydown', (e) => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        next = (current + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        next = (current - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = tabs.length - 1;
      }
      if (next >= 0) {
        e.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      }
    });
  });
})();

// ── Phase 2: Show suggestions one at a time (legacy overlay) ──


window.showSuggestions = function() {
  document.getElementById('review-phase-reviewers').classList.add('hidden');
  document.getElementById('review-phase-suggestions').classList.remove('hidden');
  document.getElementById('suggestion-total').textContent = reviewState.suggestions.length;
  renderCurrentSuggestion();
};

window.skipReview = function() {
  // Mark the button as reviewed even when skipping
  if (reviewState.activeBtn) {
    reviewState.activeBtn.disabled = false;
    reviewState.activeBtn.innerHTML = '✅ 確認済み';
    reviewState.activeBtn.classList.remove('reviewing');
  }
  closeReviewOverlay();
};

function renderCurrentSuggestion() {
  const idx = reviewState.currentSuggestion;
  const suggestions = reviewState.suggestions;
  const s = suggestions[idx];
  if (!s) {
    showReviewComplete();
    return;
  }

  const total = suggestions.length;
  const num = idx + 1;
  const percent = Math.round((num / total) * 100);

  document.getElementById('suggestion-current').textContent = num;
  document.getElementById('suggestion-percent').textContent = `${percent}%`;
  document.getElementById('suggestion-progress-bar').style.width = `${percent}%`;

  const reviewer = reviewState.reviews[s.reviewerIndex] || {};
  const cardEl = document.getElementById('suggestion-card');

  cardEl.innerHTML = `
    <div class="suggestion-source">
      <span class="suggestion-source-avatar">${reviewer.avatar || '👤'}</span>
      <span>${escapeHtml(reviewer.persona || '')}の指摘より</span>
      <span class="suggestion-reason-badge">${escapeHtml(s.reason)}</span>
    </div>
    <div class="suggestion-diff">
      <div>
        <div class="diff-label diff-label-before">変更前</div>
        <div class="diff-before">${escapeHtml(s.before)}</div>
      </div>
      <div>
        <div class="diff-label diff-label-after">変更後</div>
        <div class="diff-after">${escapeHtml(s.after)}</div>
      </div>
    </div>
    <div class="suggestion-actions" id="suggestion-actions-${idx}">
      <button class="btn-accept" onclick="acceptSuggestion(${idx})">✓ 採用</button>
      <button class="btn-reject" onclick="rejectSuggestion(${idx})">✕ 不採用</button>
      <button class="btn-alternative" onclick="showAlternativeInput(${idx})">✏ 別案を書く</button>
    </div>
    <div id="alt-input-${idx}" class="alt-input-area" style="display:none;">
      <textarea id="alt-text-${idx}" placeholder="あなたの案を入力してください…">${escapeHtml(s.after)}</textarea>
      <div class="alt-input-actions">
        <button class="btn-accept" onclick="submitAlternative(${idx})">✓ この案で採用</button>
        <button class="btn-reject" onclick="cancelAlternative(${idx})" style="font-size:0.78rem;">キャンセル</button>
      </div>
    </div>
  `;

  // Remaining count
  const remaining = total - num;
  document.getElementById('suggestion-remaining').textContent =
    remaining > 0 ? `残り${remaining}件の提案があります` : '';
}

window.acceptSuggestion = function(idx) {
  reviewState.decisions[idx] = { action: 'accept' };
  applyTrackChange(idx, reviewState.suggestions[idx].after);
  nextSuggestion();
};

window.rejectSuggestion = function(idx) {
  reviewState.decisions[idx] = { action: 'reject' };
  nextSuggestion();
};

window.showAlternativeInput = function(idx) {
  document.getElementById(`alt-input-${idx}`).style.display = 'block';
  document.getElementById(`suggestion-actions-${idx}`).style.display = 'none';
  document.getElementById(`alt-text-${idx}`).focus();
};

window.cancelAlternative = function(idx) {
  document.getElementById(`alt-input-${idx}`).style.display = 'none';
  document.getElementById(`suggestion-actions-${idx}`).style.display = 'flex';
};

window.submitAlternative = function(idx) {
  const text = document.getElementById(`alt-text-${idx}`).value.trim();
  if (!text) return;
  reviewState.decisions[idx] = { action: 'alternative', text };
  applyTrackChange(idx, text);
  nextSuggestion();
};

function nextSuggestion() {
  reviewState.currentSuggestion++;
  if (reviewState.currentSuggestion >= reviewState.suggestions.length) {
    showReviewComplete();
  } else {
    renderCurrentSuggestion();
  }
}

// ── Apply track-change to the rendered tab content ──

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceOnceFlexible(source, before, after) {
  if (!source || !before) return { changed: false, text: source };
  if (source.includes(before)) {
    return { changed: true, text: source.replace(before, after) };
  }
  const flexiblePattern = new RegExp(escapeRegExp(before).replace(/\s+/g, '\\s+'));
  if (flexiblePattern.test(source)) {
    return { changed: true, text: source.replace(flexiblePattern, after) };
  }
  return { changed: false, text: source };
}

function applySuggestionToOutput(s, newText) {
  if (!state.outputs || !s || !s.tab || !state.outputs[s.tab]) return false;
  const result = replaceOnceFlexible(state.outputs[s.tab], s.before, newText);
  if (!result.changed) return false;
  state.outputs[s.tab] = result.text;
  return true;
}

function applyTrackChange(idx, newText) {
  const s = reviewState.suggestions[idx];
  if (!s) return;

  const outputUpdated = applySuggestionToOutput(s, newText);
  const tabEl = document.getElementById(`tab-${s.tab}`);
  if (!tabEl) return;

  // Find and wrap the old text with strikethrough, insert new text
  const html = tabEl.innerHTML;
  const escapedBefore = escapeHtml(s.before);

  // Try to find the before text in the rendered HTML
  if (html.includes(s.before)) {
    tabEl.innerHTML = html.replace(
      s.before,
      `<span class="redline-deleted">${s.before}</span> <span class="redline-inserted">${newText}</span>`
    );
  } else if (html.includes(escapedBefore)) {
    tabEl.innerHTML = html.replace(
      escapedBefore,
      `<span class="redline-deleted">${escapedBefore}</span> <span class="redline-inserted">${escapeHtml(newText)}</span>`
    );
  } else if (outputUpdated) {
    // If rendered HTML did not have an exact hit, at least indicate the accepted change.
    const hint = document.createElement('p');
    hint.className = 'review-applied-note';
    hint.textContent = `✍️ 反映: ${newText}`;
    tabEl.prepend(hint);
  }
}

// ── Phase 3: Review Complete ──

function showReviewComplete() {
  logEvent('expert_review_completed');
  document.getElementById('review-phase-suggestions').classList.add('hidden');
  document.getElementById('review-phase-complete').classList.remove('hidden');

  const accepted = reviewState.decisions.filter(d => d && d.action !== 'reject').length;
  const rejected = reviewState.decisions.filter(d => d && d.action === 'reject').length;
  const total = reviewState.suggestions.length;

  let summary = '';
  if (accepted > 0) {
    summary += `✅ ${accepted}件の改善を反映しました\n`;
  }
  if (rejected > 0) {
    summary += `❌ ${rejected}件は元のままにしました\n`;
  }
  summary += '\n📌 文書は見え消しの状態です。「確定して反映する」を押すとクリーンな文書に仕上がります。';

  document.getElementById('review-complete-summary').textContent = summary;
}

// ── Finalize: Remove redlines and produce clean document ──

window.finalizeReview = function() {
  // Clean up all tabs: remove redline-deleted, keep redline-inserted as plain text
  ['profile', 'plan', 'funding', 'messages'].forEach(tab => {
    const el = document.getElementById(`tab-${tab}`);
    if (!el) return;

    // Remove deleted spans entirely
    el.querySelectorAll('.redline-deleted').forEach(span => span.remove());

    // Unwrap inserted spans (keep content, remove wrapper)
    el.querySelectorAll('.redline-inserted').forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
  });

  // Re-render from updated markdown source so on-screen content and PDF source stay aligned.
  if (state.outputs) {
    renderTab('tab-profile', state.outputs.profile);
    renderTab('tab-plan', state.outputs.plan);
    renderTab('tab-funding', state.outputs.funding);
    renderTab('tab-messages', state.outputs.messages);
    applyMessagesAccordion();
  }

  // Mark the specific accordion button as reviewed
  if (reviewState.activeBtn) {
    reviewState.activeBtn.disabled = false;
    reviewState.activeBtn.innerHTML = '✅ 確認済み';
    reviewState.activeBtn.classList.remove('reviewing');
  }

  closeReviewOverlay();
};

window.closeReviewOverlay = function() {
  document.getElementById('review-overlay').classList.add('hidden');
  releaseFocus();
  // Reset phases for next use
  document.getElementById('review-phase-reviewers').classList.remove('hidden');
  document.getElementById('review-phase-suggestions').classList.add('hidden');
  document.getElementById('review-phase-complete').classList.add('hidden');
};

// ── Messages Accordion ──

function applyMessagesAccordion() {
  const messagesEl = document.getElementById('tab-messages');
  if (!messagesEl) return;

  const html = messagesEl.innerHTML;
  // Split by --- (hr) separators which divide each message
  const sections = html.split(/<hr\s*\/?>/);
  if (sections.length <= 1) return;

  let accordionHtml = '';
  let accordionIdx = 0;
  sections.forEach((section) => {
    // Extract the h3 title as the accordion header
    const titleMatch = section.match(/<h3[^>]*>(.*?)<\/h3>/);
    if (!titleMatch) {
      accordionHtml += section;
      return;
    }
    const title = titleMatch[1];
    const content = section.replace(/<h3[^>]*>.*?<\/h3>/, '');
    const isFirst = false;

    accordionHtml += `
      <div class="msg-accordion ${isFirst ? 'open' : ''}" data-accordion-index="${accordionIdx}">
        <button class="msg-accordion-header" onclick="toggleAccordion(this)">
          <span class="msg-accordion-title">${title}</span>
          <span class="msg-accordion-arrow">${isFirst ? '▼' : '▶'}</span>
        </button>
        <div class="msg-accordion-body" style="${isFirst ? '' : 'display:none;'}">
          ${content}
          <div class="accordion-review-area" style="margin-top: 1rem; text-align: right;">
            <button class="btn-expert btn-expert-inline" onclick="requestExpertReview(${accordionIdx})">
              📩 この文章を確認してもらう
            </button>
          </div>
        </div>
      </div>
    `;
    accordionIdx++;
  });

  messagesEl.innerHTML = accordionHtml;
}

window.toggleAccordion = function(btn) {
  const accordion = btn.closest('.msg-accordion');
  const body = accordion.querySelector('.msg-accordion-body');
  const arrow = accordion.querySelector('.msg-accordion-arrow');
  const isOpen = accordion.classList.contains('open');

  if (isOpen) {
    accordion.classList.remove('open');
    body.style.display = 'none';
    arrow.textContent = '▶';
  } else {
    accordion.classList.add('open');
    body.style.display = '';
    arrow.textContent = '▼';
  }
};

function renderTab(id, markdown) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof marked !== 'undefined') {
    el.innerHTML = marked.parse(markdown);
  } else {
    el.textContent = markdown;
  }
  // Add edit toolbar inside tab pane (messages tab uses expert review instead)
  const tabKey = id.replace('tab-', '');
  if (tabKey !== 'messages') {
    const toolbar = document.createElement('div');
    toolbar.className = 'tab-edit-toolbar';
    toolbar.dataset.tab = tabKey;
    toolbar.innerHTML = `
      <button class="btn-edit" onclick="enableTabEdit('${tabKey}')">
        ✏️ この内容を編集する
      </button>
    `;
    el.appendChild(toolbar);
  }
}

window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== `tab-${tabName}`);
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });
  // Reset scroll position when switching tabs
  const tabContent = document.querySelector('.tab-content');
  if (tabContent) tabContent.scrollTop = 0;
};

// U2: After closing results, show re-open option
window.closeResults = function() {
  $('#results-overlay').classList.add('hidden');
  releaseFocus();
  addAiMessage('生成が完了しました 🎉\n結果はいつでも見直せます。\n\n他に気になることがあれば、何でも聞いてください。');
  const area = chipsArea();
  area.innerHTML = `
    <div class="generate-area">
      <button class="btn-primary" onclick="reopenResults()">
        📋 結果をもう一度見る
      </button>
      <button class="btn-secondary" onclick="exportPDF()" style="margin-top: 0.5rem;">
        📄 PDFでまとめて出力
      </button>
      <button class="btn-secondary" onclick="enterFreeChat()" style="margin-top: 0.5rem;">
        💬 もっと聞く（雑談・質問）
      </button>
    </div>
  `;
};

window.reopenResults = function() {
  if (state.outputs) {
    clearChips();
    logEvent('results_reopened');
    showResults(state.outputs, !!state.isMock);
  }
};

// ── Tab Edit Mode ──

// Map tab keys to state.outputs keys
const TAB_TO_OUTPUT_KEY = {
  profile: 'profile', plan: 'plan', funding: 'funding', messages: 'messages'
};

window.enableTabEdit = function(tabKey) {
  const el = document.getElementById(`tab-${tabKey}`);
  if (!el || !state.outputs) return;

  const outputKey = TAB_TO_OUTPUT_KEY[tabKey];
  if (!outputKey) return;

  // Switch to markdown source editing
  const textarea = document.createElement('textarea');
  textarea.className = 'tab-edit-textarea';
  textarea.value = state.outputs[outputKey];
  textarea.id = `edit-textarea-${tabKey}`;
  el.innerHTML = '';
  el.appendChild(textarea);

  // Re-create toolbar with save/cancel buttons (previous toolbar was cleared by innerHTML='')
  const toolbar = document.createElement('div');
  toolbar.className = 'tab-edit-toolbar';
  toolbar.dataset.tab = tabKey;
  toolbar.innerHTML = `
    <button class="btn-save" onclick="saveTabEdit('${tabKey}')">
      💾 保存する
    </button>
    <button class="btn-cancel" onclick="cancelTabEdit('${tabKey}')">
      ✕ キャンセル
    </button>
  `;
  el.appendChild(toolbar);
};

window.saveTabEdit = function(tabKey) {
  const textarea = document.getElementById(`edit-textarea-${tabKey}`);
  if (!textarea || !state.outputs) return;

  const outputKey = TAB_TO_OUTPUT_KEY[tabKey];
  if (!outputKey) return;

  // Update state.outputs so PDF reflects the change
  state.outputs[outputKey] = textarea.value;

  // Re-render the tab with updated markdown
  renderTab(`tab-${tabKey}`, textarea.value);

  // Re-apply accordion if messages tab
  if (tabKey === 'messages') {
    applyMessagesAccordion();
  }
};

window.cancelTabEdit = function(tabKey) {
  if (!state.outputs) return;
  const outputKey = TAB_TO_OUTPUT_KEY[tabKey];
  if (!outputKey) return;

  // Re-render with original content
  renderTab(`tab-${tabKey}`, state.outputs[outputKey]);

  // Re-apply accordion if messages tab
  if (tabKey === 'messages') {
    applyMessagesAccordion();
  }
};

// ── PDF Export ──

window.exportPDF = function() {
  if (!state.outputs) return;

  const container = document.createElement('div');
  container.className = 'pdf-export';
  container.innerHTML = `
    <h1>🎯 モヤモヤキャッチャー — 生成結果</h1>
    <p style="color:#888;font-size:10px;">生成日：${new Date().toLocaleDateString('ja-JP')} ／ この出力は提案のたたき台です。最終判断は利用者が行ってください。</p>
    <hr>
    ${marked.parse(state.outputs.profile)}
    <hr>
    ${marked.parse(state.outputs.plan)}
    <hr>
    ${marked.parse(state.outputs.funding)}
    <hr>
    ${marked.parse(state.outputs.messages)}
    <hr>
    <p style="color:#888;font-size:9px;text-align:center;">
      Moyamoya Catcher (+Deliver) — 個人情報は含まれていません<br>
      このツールを使う → <strong>${window.location.origin}</strong>
    </p>
  `;

  const opt = {
    margin: [10, 10, 10, 10],
    filename: 'moyamoya-catcher-output.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };

  html2pdf().set(opt).from(container).save();
  logEvent('pdf_exported');
};

// ── Go back (U1: improved) ──

window.goBack = function() {
  goBackToPreviousStep();
};

// delay is defined near renderReviewerCards

// ── Free Chat (after generation) ──

function renderChatActionButtons() {
  const area = chipsArea();
  area.innerHTML = `
    <div class="generate-area" style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">
      <button class="btn-secondary" onclick="reopenResults()" style="font-size:0.8rem;">
        📋 結果を見る
      </button>
      <button class="btn-secondary" onclick="exportPDF()" style="font-size:0.8rem;">
        📄 PDF出力
      </button>
    </div>
  `;
}

window.enterFreeChat = function() {
  clearChips();
  addAiMessage('何でも聞いてください 💬\n\n例えば：\n・他にどんな支援策があるか知りたい\n・似たような活動の事例を教えて\n・助成金の探し方を教えて\n・文章をもう少し変えたい\n\n自由に入力して送ってください。');
  
  // Show free input
  const inputArea = $('#free-input-area');
  inputArea.classList.remove('hidden');
  const input = $('#free-input');
  input.placeholder = '例：助成金の探し方を教えて…';
  input.value = '';
  input.focus();
  const cancelBtn = $('#free-input-cancel');
  if (cancelBtn) cancelBtn.classList.add('hidden');

  // Set handler for free chat mode
  state.freeChatMode = true;
  state.freeChatHandler = async (text) => {
    addUserMessage(text);
    await sendFreeChatMessage(text);
  };
  renderChatActionButtons();
};

async function sendFreeChatMessage(text) {
  // Show typing indicator
  const typingId = addAiMessage('考え中…');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        context: state.slots,
        outputs: state.outputs ? {
          plan: state.outputs.plan?.substring(0, 500),
          funding: state.outputs.funding?.substring(0, 500)
        } : null
      })
    });
    const data = await res.json();

    // Replace typing indicator
    const typingEl = document.querySelector(`[data-msg-id="${typingId}"]`);
    if (typingEl) typingEl.remove();

    if (data.success) {
      addAiMessage(data.reply);
    } else {
      addAiMessage('すみません、うまく答えられませんでした。もう一度お試しください。');
    }
  } catch (err) {
    const typingEl = document.querySelector(`[data-msg-id="${typingId}"]`);
    if (typingEl) typingEl.remove();
    addAiMessage('通信エラーが発生しました。');
  }

  // Keep showing input for ongoing conversation
  const input = $('#free-input');
  input.value = '';
  input.focus();
  
  renderChatActionButtons();
}

// ── Share Functions (G1: Growth) ──

const SHARE_TEXT = 'モヤモヤキャッチャー — 漠然とした不安を、具体的な次の一手に変えるツール';

window.shareURL = function() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    logEvent('shared_url', { method: 'clipboard' });
    const btn = document.querySelector('[onclick="shareURL()"]');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '✅ コピーしました';
      btn.classList.add('btn-share-copied');
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('btn-share-copied');
      }, 2000);
    }
  }).catch(() => {
    // Fallback for older browsers
    prompt('URLをコピーしてください：', window.location.origin);
  });
};

window.shareLINE = function() {
  const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(SHARE_TEXT)}`;
  window.open(url, '_blank', 'width=600,height=500');
  logEvent('shared_url', { method: 'line' });
};

window.shareX = function() {
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(window.location.origin)}`;
  window.open(url, '_blank', 'width=600,height=400');
  logEvent('shared_url', { method: 'x' });
};

