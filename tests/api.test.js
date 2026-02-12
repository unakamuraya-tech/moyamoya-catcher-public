// L4 API Integration Tests (node:test + supertest)
// All tests run in mock mode — no external API dependency.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Force mock mode: prevent dotenv from loading .env, then clear API key
process.env.NODE_ENV = 'test';
delete process.env.GEMINI_API_KEY;

const request = require('supertest');
const app = require('../server');

describe('/api/generate', () => {
  it('returns mock data with success:true and degraded:false when useMock is set', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ slots: { topic: 'test' }, useMock: true })
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.degraded, false);
    assert.equal(res.body.source, 'mock');
    assert.ok(res.body.outputs);
    assert.ok(res.body.outputs.plan);
    assert.ok(res.body.outputs.funding);
    assert.ok(res.body.outputs.messages);
    assert.ok(res.body.outputs.profile);
  });

  it('returns mock with degraded:false when no API key is configured', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ slots: { topic: 'test' } })
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.degraded, false);
    assert.equal(res.body.source, 'mock');
  });
});

describe('Input validation (4xx)', () => {
  it('POST /api/update-summary returns 400 when correction is missing', async () => {
    const res = await request(app)
      .post('/api/update-summary')
      .send({ currentSummary: {} })
      .expect(400);
    assert.equal(res.body.error, 'correction is required');
  });

  it('POST /api/summarize-url returns 400 when URL is missing', async () => {
    const res = await request(app)
      .post('/api/summarize-url')
      .send({})
      .expect(400);
    assert.equal(res.body.error, 'URL is required');
  });

  it('POST /api/summarize-text returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/summarize-text')
      .send({})
      .expect(400);
    assert.equal(res.body.error, 'text is required');
  });
});

describe('/api/health', () => {
  it('returns degraded/503 when no API key is configured', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(503);

    assert.equal(res.body.status, 'degraded');
    assert.equal(res.body.checks.gemini_key_configured, false);
    assert.ok(res.body.timestamp);
  });
});

describe('/api/events (KPI collection)', () => {
  it('accepts valid KPI events', async () => {
    await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ event: 'session_started', ts: Date.now() }))
      .expect(204);
  });

  it('rejects invalid event names', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ event: 'invalid_event', ts: Date.now() }))
      .expect(400);
    assert.equal(res.body.error_code, 'INVALID_EVENT');
  });

  it('strips disallowed keys (PII protection)', async () => {
    await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ event: 'step_answered', ts: Date.now(), value: 'secret PII', stepId: 'q1' }))
      .expect(204);

    const summary = await request(app).get('/api/events/summary').expect(200);
    assert.ok(summary.body.counts.step_answered >= 1);
  });

  it('returns event summary with counts', async () => {
    const res = await request(app)
      .get('/api/events/summary')
      .expect(200);

    assert.ok(typeof res.body.total === 'number');
    assert.equal(res.body.max, 5000);
    assert.ok(res.body.counts);
    assert.ok(res.body.counts.session_started >= 1);
  });
});

// ── ALLOWED_VALUES_BY_STEP: permitted values are saved, rejected values are dropped ──
// Uses test-only /api/events/latest endpoint to directly verify entry.value
describe('/api/events — stepId-based value validation', () => {

  // -- Allowed values per step are SAVED --

  const validCases = [
    { stepId: 'source_mode',     value: 'url',                 desc: 'source_mode: url' },
    { stepId: 'source_mode',     value: 'sns',                 desc: 'source_mode: sns' },
    { stepId: 'source_mode',     value: 'none',                desc: 'source_mode: none' },
    { stepId: 'summary_confirm', value: 'confirmed',           desc: 'summary_confirm: confirmed' },
    { stepId: 'summary_confirm', value: 'edit',                desc: 'summary_confirm: edit' },
    { stepId: 'topic',           value: 'money',               desc: 'topic: money' },
    { stepId: 'topic',           value: 'people',              desc: 'topic: people' },
    { stepId: 'topic',           value: 'vague',               desc: 'topic: vague' },
    { stepId: 'risk_type',       value: 'next_year_uncertain', desc: 'risk_type: next_year_uncertain' },
    { stepId: 'risk_type',       value: 'cut_risk',            desc: 'risk_type: cut_risk' },
    { stepId: 'risk_type',       value: 'self_funded',         desc: 'risk_type: self_funded' },
    { stepId: 'deadline_window', value: '2-3w',                desc: 'deadline_window: 2-3w' },
    { stepId: 'deadline_window', value: '1-2m',                desc: 'deadline_window: 1-2m' },
    { stepId: 'deadline_window', value: '3m+',                 desc: 'deadline_window: 3m+' },
    { stepId: 'deadline_window', value: 'まだ決まっていない',     desc: 'deadline_window: まだ決まっていない' },
    { stepId: 'gap_range',       value: '3万',                 desc: 'gap_range: 3万' },
    { stepId: 'gap_range',       value: '5万',                 desc: 'gap_range: 5万' },
    { stepId: 'gap_range',       value: '10万',                desc: 'gap_range: 10万' },
    { stepId: 'gap_range',       value: '15万+',               desc: 'gap_range: 15万+' },
    { stepId: 'gap_range',       value: 'まだ分からない',        desc: 'gap_range: まだ分からない' },
    { stepId: 'allies',          value: 'small_support',       desc: 'allies: small_support' },
    { stepId: 'allies',          value: 'want_help',           desc: 'allies: want_help' },
    { stepId: 'intent',          value: 'continue',            desc: 'intent: continue' },
    { stepId: 'intent',          value: 'continue_light',      desc: 'intent: continue_light' },
    { stepId: 'intent',          value: 'handover',            desc: 'intent: handover' },
    { stepId: 'desired_output',  value: 'A',                   desc: 'desired_output: A' },
    { stepId: 'desired_output',  value: 'D',                   desc: 'desired_output: D' },
  ];

  for (const { stepId, value, desc } of validCases) {
    it(`SAVES allowed value — ${desc}`, async () => {
      await request(app)
        .post('/api/events')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ event: 'step_answered', ts: Date.now(), stepId, value }))
        .expect(204);

      // Verify value is actually persisted in buffer
      const latest = await request(app).get('/api/events/latest?n=1').expect(200);
      const entry = latest.body.events[0];
      assert.equal(entry.value, value, `expected value '${value}' to be persisted`);
      assert.equal(entry.stepId, stepId);
    });
  }

  // -- Disallowed / free-text values are DROPPED --

  const rejectedCases = [
    { stepId: 'topic',      value: 'children',        desc: 'old value children (removed)' },
    { stepId: 'topic',      value: 'elderly',          desc: 'old value elderly (removed)' },
    { stepId: 'topic',      value: 'yes',              desc: 'old value yes (removed)' },
    { stepId: 'topic',      value: 'no',               desc: 'old value no (removed)' },
    { stepId: 'topic',      value: 'disability',       desc: 'old value disability (removed)' },
    { stepId: 'allies',     value: 'A',                desc: 'cross-step value A (belongs to desired_output)' },
    { stepId: 'topic',      value: 'continue',         desc: 'cross-step value continue (belongs to intent)' },
    { stepId: 'topic',      value: '個人情報テスト',      desc: 'free text (Japanese PII)' },
    { stepId: 'topic',      value: 'my name is John',  desc: 'free text (English PII)' },
  ];

  for (const { stepId, value, desc } of rejectedCases) {
    it(`DROPS disallowed value — ${desc}`, async () => {
      await request(app)
        .post('/api/events')
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ event: 'step_answered', ts: Date.now(), stepId, value }))
        .expect(204);

      // Verify value is NOT persisted (stripped from entry)
      const latest = await request(app).get('/api/events/latest?n=1').expect(200);
      const entry = latest.body.events[0];
      assert.equal(entry.value, undefined, `expected value '${value}' to be dropped but it was persisted`);
      assert.equal(entry.event, 'step_answered');
    });
  }

  // -- Fallback: value allowed even without stepId if in global set --
  it('SAVES value via fallback when stepId is missing', async () => {
    await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ event: 'step_answered', ts: Date.now(), value: 'money' }))
      .expect(204);

    const latest = await request(app).get('/api/events/latest?n=1').expect(200);
    const entry = latest.body.events[0];
    assert.equal(entry.value, 'money', 'expected fallback-allowed value to be persisted');
  });

  it('DROPS value via fallback when stepId is missing and value not in global set', async () => {
    await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ event: 'step_answered', ts: Date.now(), value: 'children' }))
      .expect(204);

    const latest = await request(app).get('/api/events/latest?n=1').expect(200);
    const entry = latest.body.events[0];
    assert.equal(entry.value, undefined, 'expected old value to be dropped in fallback mode');
  });
});

