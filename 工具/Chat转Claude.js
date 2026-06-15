const { 清理不可见字符, 深度清理不可见字符 } = require('./文本清理');

function 新消息ID() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function 规范StopReason(finishReason, toolCalls = []) {
  if (toolCalls && toolCalls.length) return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  if (finishReason === 'stop' || finishReason == null) return 'end_turn';
  if (finishReason === 'tool_calls') return 'tool_use';
  return String(finishReason || 'end_turn');
}

function usageToClaude(usage) {
  usage = usage || {};
  return {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
  };
}

function 规范ToolCalls(toolCalls) {
  return (toolCalls || []).filter(Boolean).map((tc, i) => ({
    index: Number.isInteger(tc.index) ? tc.index : i,
    id: tc.id || ('toolu_' + i),
    name: tc.function && tc.function.name || '',
    inputText: tc.function && tc.function.arguments || '{}',
  }));
}
function 安全JSON(text) {
  if (typeof text !== 'string' || !text.trim()) return {};
  try { return JSON.parse(text); } catch { return text; }
}

function 清理思考文本(text) {
  return 清理不可见字符(String(text || '').replace(/<think>[\s\S]*?<\/think>\s*/gi, '')).trimStart();
}

function 创建思考过滤器() {
  let mode = 'deciding';
  let buffer = '';
  const marker = '<think>';

  function consumeThinking() {
    const lower = buffer.toLowerCase();
    const end = lower.indexOf('</think>');
    if (end < 0) return '';
    const after = buffer.slice(end + '</think>'.length).replace(/^\s+/, '');
    buffer = '';
    mode = 'visible';
    return after;
  }

  return {
    push(delta) {
      const text = 清理不可见字符(delta);
      if (!text) return '';
      if (mode === 'visible') return text;

      buffer += text;
      if (mode === 'stripping') return consumeThinking();

      const trimmed = buffer.trimStart();
      const lower = trimmed.toLowerCase();
      if (lower.startsWith(marker)) {
        mode = 'stripping';
        return consumeThinking();
      }
      if (!trimmed || marker.startsWith(lower)) return '';

      mode = 'visible';
      const out = buffer;
      buffer = '';
      return out;
    },
  };
}

function 构造Content(text, toolCalls) {
  const content = [];
  const cleanText = 清理不可见字符(text).trimStart();
  if (cleanText) content.push({ type: 'text', text: cleanText });

  for (const tc of 规范ToolCalls(toolCalls)) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: 安全JSON(tc.inputText),
    });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  return content;
}

function 构造完整消息({ id, model, text, toolCalls = [], usage = null, finishReason = 'stop' }) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: 构造Content(text || '', toolCalls),
    stop_reason: 规范StopReason(finishReason, toolCalls),
    stop_sequence: null,
    usage: usageToClaude(usage),
  };
}

function sse(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(深度清理不可见字符(data)) + '\n\n');
}

function 写Claude流开始(res, { id, model }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

function 写Claude文本开始(res, { index = 0 } = {}) {
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  });
}

function 写Claude文本增量(res, delta, { index = 0 } = {}) {
  const cleanDelta = 清理不可见字符(delta);
  if (!cleanDelta) return;
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text: cleanDelta },
  });
}

function 写Claude文本结束(res, { index = 0 } = {}) {
  sse(res, 'content_block_stop', { type: 'content_block_stop', index });
}

function 写ClaudeToolStart(res, current, { index }) {
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id: current.id || ('toolu_' + index),
      name: current.function && current.function.name || '',
      input: {},
    },
  });
}

function 写ClaudeToolDelta(res, delta, { index }) {
  if (!delta) return;
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: delta },
  });
}

function 写ClaudeTool结束(res, { index }) {
  sse(res, 'content_block_stop', { type: 'content_block_stop', index });
}

function 写Claude流结束(res, { usage, finishReason, toolCalls = [] }) {
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: 规范StopReason(finishReason, toolCalls),
      stop_sequence: null,
    },
    usage: usageToClaude(usage),
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

module.exports = {
  新消息ID,
  构造完整消息,
  写Claude流开始,
  写Claude文本开始,
  写Claude文本增量,
  写Claude文本结束,
  写ClaudeToolStart,
  写ClaudeToolDelta,
  写ClaudeTool结束,
  写Claude流结束,
  清理思考文本,
  创建思考过滤器,
};
