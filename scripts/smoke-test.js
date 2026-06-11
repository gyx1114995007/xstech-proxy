#!/usr/bin/env node

const http = require('http');
const https = require('https');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
let API_KEY = process.env.API_KEY || '';
try {
  if (!API_KEY) API_KEY = require('../启动/配置').apiKey;
} catch {}

const TIMEOUT_MS = Math.max(1000, Number(process.env.SMOKE_TIMEOUT_MS || 5000));

function request(method, path, { auth = false, anthropicAuth = false, body = null, expectJson = true } = {}) {
  return requestRaw(method, path, { auth, anthropicAuth, body, expectJson });
}

function requestRaw(method, path, { auth = false, anthropicAuth = false, body = null, expectJson = true, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body === null ? null : JSON.stringify(body);
    const headers = {};
    if (auth) headers.Authorization = 'Bearer ' + API_KEY;
    if (anthropicAuth) {
      headers['x-api-key'] = API_KEY;
      headers['anthropic-version'] = '2023-06-01';
    }
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const started = Date.now();
    const req = lib.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        if (expectJson) {
          try { json = JSON.parse(text); } catch {}
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          durationMs: Date.now() - started,
          text,
          json,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout ' + timeoutMs + 'ms'));
    });
    req.on('error', err => {
      resolve({ ok: false, status: 0, durationMs: Date.now() - started, error: err.message || String(err) });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(name, condition, detail = '') {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''));
}

const tests = [
  {
    name: 'health',
    run: async () => {
      const r = await request('GET', '/health', { expectJson: true });
      assert('status', r.ok, 'HTTP ' + r.status + ' ' + (r.error || ''));
      assert('json.ok', r.json && r.json.ok === true);
      return { status: r.status, durationMs: r.durationMs, service: r.json.service };
    },
  },
  {
    name: 'panel',
    run: async () => {
      const r = await request('GET', '/panel', { expectJson: false });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('contains panel', /xs中转站控制面板/.test(r.text));
      return { status: r.status, durationMs: r.durationMs, bytes: r.text.length };
    },
  },
  {
    name: 'debug-status',
    run: async () => {
      const r = await request('GET', '/debug/status', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('json.ok', r.json && r.json.ok === true);
      assert('service.pid', r.json.service && r.json.service.pid);
      return { status: r.status, durationMs: r.durationMs, pid: r.json.service.pid, accounts: (r.json.accounts || []).length };
    },
  },
  {
    name: 'debug-config',
    run: async () => {
      const r = await request('GET', '/debug/config', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('runtime', r.json && r.json.runtime);
      return { status: r.status, durationMs: r.durationMs };
    },
  },
  {
    name: 'files-health',
    run: async () => {
      const r = await request('GET', '/debug/files/health?backupCorrupt=false', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('summary', r.json && r.json.result && r.json.result.summary);
      return { status: r.status, durationMs: r.durationMs, summary: r.json.result.summary };
    },
  },
  {
    name: 'deploy-status',
    run: async () => {
      const r = await request('GET', '/debug/deploy/status', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('process.pid', r.json && r.json.result && r.json.result.process && r.json.result.process.pid);
      return { status: r.status, durationMs: r.durationMs, pid: r.json.result.process.pid, port: r.json.result.config.port };
    },
  },
  {
    name: 'metrics-trend',
    run: async () => {
      const r = await request('GET', '/debug/metrics/trend?hours=24', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('rows=24', r.json && r.json.trend && Array.isArray(r.json.trend.rows) && r.json.trend.rows.length === 24);
      return { status: r.status, durationMs: r.durationMs, total: r.json.trend.summary.总数 };
    },
  },
  {
    name: 'events-stats',
    run: async () => {
      const r = await request('GET', '/debug/events/stats?max=1000', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('stats', r.json && r.json.stats);
      return { status: r.status, durationMs: r.durationMs, total: r.json.stats.total };
    },
  },
  {
    name: 'logs-recent',
    run: async () => {
      const r = await request('GET', '/debug/logs/recent?lines=20&level=ALL&keyword=', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('lines', r.json && Array.isArray(r.json.lines));
      return { status: r.status, durationMs: r.durationMs, matched: r.json.totalMatched };
    },
  },
  {
    name: 'v1-models',
    run: async () => {
      const r = await request('GET', '/v1/models', { auth: true });
      assert('status', r.ok, 'HTTP ' + r.status);
      assert('data', r.json && Array.isArray(r.json.data));
      return { status: r.status, durationMs: r.durationMs, count: r.json.data.length };
    },
  },
  {
    name: 'responses-invalid-model-param',
    run: async () => {
      const r = await request('POST', '/v1/responses', { auth: true, body: { input: 'hi' } });
      assert('status=400', r.status === 400, 'HTTP ' + r.status);
      assert('missing_model', r.json && r.json.error && r.json.error.code === 'missing_model');
      return { status: r.status, durationMs: r.durationMs, code: r.json.error.code };
    },
  },
  {
    name: 'responses-not-found',
    run: async () => {
      const r = await request('GET', '/v1/responses/resp_smoke_not_found', { auth: true });
      assert('status=404', r.status === 404, 'HTTP ' + r.status);
      assert('response_not_found', r.json && r.json.error && r.json.error.code === 'response_not_found');
      return { status: r.status, durationMs: r.durationMs, code: r.json.error.code };
    },
  },
  {
    name: 'claude-messages-x-api-key-auth',
    run: async () => {
      const r = await request('POST', '/v1/messages', { anthropicAuth: true, body: { max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] } });
      assert('status=400', r.status === 400, 'HTTP ' + r.status);
      assert('not 401 auth', r.status !== 401);
      assert('anthropic error type', r.json && r.json.type === 'error');
      assert('missing_model', r.json && r.json.error && r.json.error.code === 'missing_model');
      return { status: r.status, durationMs: r.durationMs, code: r.json.error.code };
    },
  },
];

tests.push({
  name: 'claude-converter-multimodal-tool-result',
  run: async () => {
    const { claudeToChat } = require('../工具/Claude转Chat');
    const tinyPng = 'iVBORw0KGgo=';
    const chat = await claudeToChat({
      model: 'deepseek-v4-flash',
      max_tokens: 16,
      messages: [
        { role: 'user', content: [
          { type: 'text', text: '看图并回答' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: tinyPng } },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '结果A' }] },
        ] },
      ],
    });
    assert('files converted', Array.isArray(chat._responsesFiles) && chat._responsesFiles.length === 1);
    assert('file data url', /^data:image\/png;base64,/.test(chat._responsesFiles[0].data));
    assert('tool role', chat.messages.some(m => m.role === 'tool' && m.tool_call_id === 'toolu_1' && m.content === '结果A'));
    return { files: chat._responsesFiles.length, messages: chat.messages.length };
  },
});

tests.push({
  name: 'claude-converter-image-source-variants',
  run: async () => {
    const { claudeToChat } = require('../工具/Claude转Chat');
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const chat = await claudeToChat({
      model: 'deepseek-v4-flash',
      max_tokens: 16,
      messages: [
        { role: 'user', content: [
          { type: 'text', text: '看两张图' },
          { type: 'image', source: dataUrl, media_type: 'image/png' },
          { type: 'image', image_url: { url: dataUrl }, media_type: 'image/png', name: 'inline.png' },
        ] },
      ],
    });
    assert('variant files converted', Array.isArray(chat._responsesFiles) && chat._responsesFiles.length === 2);
    assert('variant first data url', chat._responsesFiles[0].data === dataUrl);
    assert('variant second data url', chat._responsesFiles[1].data === dataUrl);
    return { files: chat._responsesFiles.length };
  },
});

tests.push({
  name: 'upstream-text-keeps-censor-but-excludes-files-meta',
  run: async () => {
    const { openAIChatToUnified } = require('../工具/OpenAI聊天请求规范化');
    const { buildUpstreamText } = require('../工具/上游请求构建器');
    const body = {
      model: 'deepseek-v4-flash',
      stream: true,
      messages: [{ role: 'user', content: '请判断这段文本是否误判' }],
      _responsesFiles: [{ name: 'a.png', data: 'data:image/png;base64,SHOULD_NOT_APPEAR' }],
      _claudeMeta: { system: [{ type: 'text', text: 'SHOULD_NOT_APPEAR_META' }], fileCount: 1 },
    };
    const text = buildUpstreamText(openAIChatToUnified(body, body.model));
    assert('keeps user text', text.includes('请判断这段文本是否误判'));
    assert('excludes files', !text.includes('_responsesFiles') && !text.includes('SHOULD_NOT_APPEAR'));
    assert('excludes claude meta', !text.includes('_claudeMeta') && !text.includes('SHOULD_NOT_APPEAR_META'));
    return { bytes: text.length };
  },
});

tests.push({
  name: 'claude-stream-sse-newline-format',
  run: async () => {
    const r = await requestRaw('POST', '/v1/messages', {
      anthropicAuth: true,
      expectJson: false,
      timeoutMs: Math.max(TIMEOUT_MS, 20000),
      body: {
        model: 'deepseek-v4-flash',
        max_tokens: 32,
        stream: true,
        messages: [{ role: 'user', content: '只回答：ok' }],
      },
    });
    assert('status', r.ok, 'HTTP ' + r.status + ' ' + (r.error || r.text || ''));
    assert('message_start', /event: message_start\n/.test(r.text));
    assert('has real sse separator', /\n\ndata:|\n\nevent:|\n\n$/.test(r.text));
    assert('no literal slash-n separator', !/event: message_start\\n/.test(r.text));
    assert('content delta or stop', /content_block_delta|message_stop/.test(r.text));
    return { status: r.status, durationMs: r.durationMs, bytes: r.text.length };
  },
});

(async () => {
  const started = Date.now();
  const results = [];
  console.log('xs smoke test');
  console.log('BASE_URL=' + BASE_URL);
  console.log('TIMEOUT_MS=' + TIMEOUT_MS);
  console.log('API_KEY=' + (API_KEY ? '(configured)' : '(missing)'));
  console.log('');

  for (const t of tests) {
    const s = Date.now();
    try {
      const data = await t.run();
      results.push({ name: t.name, ok: true, durationMs: Date.now() - s, data });
      console.log('✓ ' + t.name + ' ' + (Date.now() - s) + 'ms ' + JSON.stringify(data));
    } catch (err) {
      results.push({ name: t.name, ok: false, durationMs: Date.now() - s, error: err.message || String(err) });
      console.log('✗ ' + t.name + ' ' + (Date.now() - s) + 'ms ' + (err.message || err));
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log('summary: passed=' + passed + ' failed=' + failed + ' total=' + results.length + ' durationMs=' + (Date.now() - started));
  if (failed > 0) {
    console.log('failed tests: ' + results.filter(r => !r.ok).map(r => r.name).join(', '));
    process.exitCode = 1;
  }
})();
