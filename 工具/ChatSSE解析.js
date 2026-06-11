async function 解析ChatSSE(stream, handlers = {}) {
  let buffer = '';
  const state = {
    content: '',
    toolCalls: [],
    finishReason: null,
    usage: null,
    id: null,
    model: null,
    rawEvents: 0,
  };

  async function emitJson(json) {
    state.rawEvents++;
    if (json.id && !state.id) state.id = json.id;
    if (json.model && !state.model) state.model = json.model;
    if (json.usage) state.usage = json.usage;
    if (json.error) {
      if (handlers.onError) await handlers.onError(json.error, json, state);
      return;
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    for (const choice of choices) {
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        // 过滤所有零宽字符、不可见字符和控制字符
        const cleanContent = delta.content
          // 零宽字符
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          // 其他不可见字符
          .replace(/[\u00AD\u061C\u180E\u2060-\u2069]/g, '')
          // 所有Unicode不可见分隔符和格式字符（通用方案）
          .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, '');
        if (!cleanContent) return;
        state.content += cleanContent;
        if (handlers.onTextDelta) await handlers.onTextDelta(cleanContent, json, state);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = Number.isInteger(tc.index) ? tc.index : 0;
          const isNew = !state.toolCalls[idx];
          if (!state.toolCalls[idx]) {
            state.toolCalls[idx] = {
              index: idx,
              id: tc.id || ('call_' + idx),
              type: tc.type || 'function',
              function: { name: '', arguments: '' },
            };
          }
          const cur = state.toolCalls[idx];
          if (tc.id) cur.id = tc.id;
          if (tc.type) cur.type = tc.type;
          if (tc.function) {
            if (tc.function.name) cur.function.name = tc.function.name;
            if (typeof tc.function.arguments === 'string') cur.function.arguments += tc.function.arguments;
          }
          if (isNew && handlers.onToolCallStart) await handlers.onToolCallStart(tc, cur, json, state);
          if (handlers.onToolCallDelta) await handlers.onToolCallDelta(tc, cur, json, state);
        }
      }
      if (choice.finish_reason) state.finishReason = choice.finish_reason;
    }
    if (handlers.onJson) await handlers.onJson(json, state);
  }

  async function processEvent(block) {
    const lines = block.split(/\r?\n/);
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const data = dataLines.join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') {
      if (handlers.onDone) await handlers.onDone(state);
      return;
    }
    try {
      await emitJson(JSON.parse(data));
    } catch (err) {
      if (handlers.onParseError) await handlers.onParseError(err, data, state);
    }
  }

  for await (const chunk of stream) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      await processEvent(block);
    }
  }
  if (buffer.trim()) await processEvent(buffer);
  if (handlers.onEnd) await handlers.onEnd(state);
  return state;
}

module.exports = { 解析ChatSSE };