const { 清理不可见字符, 深度清理不可见字符 } = require('./文本清理');

function 新响应ID() {
  return 'resp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function sse(res, type, data) {
  res.write('event: ' + type + '\n');
  res.write('data: ' + JSON.stringify(深度清理不可见字符({ type, ...data })) + '\n\n');
}

function messageId(id) { return 'msg_' + String(id).replace(/^resp_/, ''); }
function fcItemId(id, index) { return 'fc_' + String(id).replace(/^resp_/, '') + '_' + index; }

function 规范ToolCalls(toolCalls) {
  return (toolCalls || []).filter(Boolean).map((tc, i) => ({
    index: Number.isInteger(tc.index) ? tc.index : i,
    id: tc.id || ('call_' + i),
    type: tc.type || 'function',
    function: {
      name: tc.function && tc.function.name || '',
      arguments: tc.function && tc.function.arguments || '',
    },
  }));
}

function 构造输出({ id, text, toolCalls }) {
  const output = [];
  const calls = 规范ToolCalls(toolCalls);
  const cleanText = 清理不可见字符(text);
  if (cleanText) {
    output.push({
      id: messageId(id),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: cleanText, annotations: [] }],
    });
  }
  for (const tc of calls) {
    output.push({
      id: fcItemId(id, tc.index),
      type: 'function_call',
      status: 'completed',
      call_id: tc.id,
      name: tc.function.name || '',
      arguments: tc.function.arguments || '',
    });
  }
  if (!output.length) {
    output.push({
      id: messageId(id),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    });
  }
  return output;
}

function 构造完整响应({ id, model, text, toolCalls = [], status = 'completed', usage = null, finishReason = 'stop', metadata = null, previousResponseId = null }) {
  const now = Math.floor(Date.now() / 1000);
  const cleanText = 清理不可见字符(text);
  const output = 构造输出({ id, text: cleanText, toolCalls });
  return {
    id,
    object: 'response',
    created_at: now,
    status,
    model,
    previous_response_id: previousResponseId || undefined,
    output,
    output_text: cleanText,
    usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    finish_reason: finishReason || (toolCalls && toolCalls.length ? 'tool_calls' : 'stop'),
    metadata: metadata || undefined,
  };
}

function 写Responses流开始(res, { id, model }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const now = Math.floor(Date.now() / 1000);
  sse(res, 'response.created', {
    response: { id, object: 'response', created_at: now, status: 'in_progress', model, output: [] },
  });
  sse(res, 'response.in_progress', {
    response: { id, object: 'response', created_at: now, status: 'in_progress', model, output: [] },
  });
}

function 写Responses文本开始(res, { id }) {
  sse(res, 'response.output_item.added', {
    output_index: 0,
    item: { id: messageId(id), type: 'message', status: 'in_progress', role: 'assistant', content: [] },
  });
  sse(res, 'response.content_part.added', {
    item_id: messageId(id), output_index: 0, content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
}

function 写Responses文本增量(res, delta, { id }) {
  const cleanDelta = 清理不可见字符(delta);
  if (!cleanDelta) return;
  sse(res, 'response.output_text.delta', {
    item_id: messageId(id), output_index: 0, content_index: 0, delta: cleanDelta,
  });
}

function 写ResponsesToolStart(res, toolCall, current, { id, outputIndex }) {
  const idx = Number.isInteger(outputIndex) ? outputIndex : ((current && current.index) || 0) + 1;
  const tc = current || toolCall || {};
  sse(res, 'response.output_item.added', {
    output_index: idx,
    item: {
      id: fcItemId(id, tc.index || 0),
      type: 'function_call',
      status: 'in_progress',
      call_id: tc.id || (toolCall && toolCall.id) || ('call_' + (tc.index || 0)),
      name: tc.function && tc.function.name || toolCall?.function?.name || '',
      arguments: '',
    },
  });
}

function 写ResponsesToolDelta(res, toolCall, current, { id, outputIndex }) {
  const idx = Number.isInteger(outputIndex) ? outputIndex : ((current && current.index) || 0) + 1;
  const delta = toolCall && toolCall.function && typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : '';
  if (!delta) return;
  sse(res, 'response.function_call_arguments.delta', {
    item_id: fcItemId(id, current && current.index || 0),
    output_index: idx,
    delta,
  });
}

function 写Responses流结束(res, { id, model, text, toolCalls = [], usage, finishReason, textStarted = true }) {
  const cleanText = 清理不可见字符(text);
  if (textStarted) {
    sse(res, 'response.output_text.done', { item_id: messageId(id), output_index: 0, content_index: 0, text: cleanText });
    sse(res, 'response.content_part.done', {
      item_id: messageId(id), output_index: 0, content_index: 0,
      part: { type: 'output_text', text: cleanText, annotations: [] },
    });
    sse(res, 'response.output_item.done', {
      output_index: 0,
      item: { id: messageId(id), type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: cleanText, annotations: [] }] },
    });
  }
  const calls = 规范ToolCalls(toolCalls);
  for (const tc of calls) {
    const outIdx = textStarted ? tc.index + 1 : tc.index;
    sse(res, 'response.function_call_arguments.done', {
      item_id: fcItemId(id, tc.index), output_index: outIdx, arguments: tc.function.arguments || '',
    });
    sse(res, 'response.output_item.done', {
      output_index: outIdx,
      item: {
        id: fcItemId(id, tc.index), type: 'function_call', status: 'completed', call_id: tc.id,
        name: tc.function.name || '', arguments: tc.function.arguments || '',
      },
    });
  }
  sse(res, 'response.completed', {
    response: 构造完整响应({ id, model, text: cleanText, toolCalls: calls, usage, finishReason }),
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = {
  新响应ID,
  构造完整响应,
  写Responses流开始,
  写Responses文本开始,
  写Responses文本增量,
  写ResponsesToolStart,
  写ResponsesToolDelta,
  写Responses流结束,
};