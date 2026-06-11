function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function 生成nonce() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeRole(role) {
  if (role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  if (role === 'developer') return 'developer';
  if (role === 'tool') return 'tool';
  return 'user';
}

function textFromPart(part) {
  if (typeof part === 'string') return part;
  if (!isRecord(part)) return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (typeof part.input_text === 'string') return part.input_text;
  if (typeof part.output_text === 'string') return part.output_text;
  return '';
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textFromPart).filter(Boolean).join('\\n');
  if (isRecord(content)) return textFromPart(content);
  return '';
}

function contentToUnifiedBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return extractTextContent(content);
  const blocks = [];
  const textParts = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const text = textFromPart(part);
    if (text) { textParts.push(text); continue; }
    const imageUrl = part.image_url?.url || part.image_url || part.source?.data;
    if (typeof imageUrl === 'string') {
      blocks.push({ ...part, type: 'image', imageUrl, detail: part.detail });
      continue;
    }
    blocks.push(part);
  }
  if (blocks.length === 0) return textParts.join('\\n');
  if (textParts.length) blocks.unshift({ type: 'text', text: textParts.join('\\n') });
  return blocks;
}

function splitSystemPrompt(messages) {
  const promptParts = [];
  const normalized = [];
  for (const msg of messages) {
    const role = normalizeRole(msg.role);
    const textContent = extractTextContent(msg.content);
    if (role === 'system' || role === 'developer') {
      if (textContent) promptParts.push(textContent);
      continue;
    }
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      normalized.push({ role: role === 'tool' ? 'user' : role, content: msg.content });
      continue;
    }
    if (textContent) normalized.push({ role: role === 'tool' ? 'user' : role, content: textContent });
  }
  return { messages: normalized, systemPrompt: promptParts.length ? promptParts.join('\\n\\n') : undefined };
}

function normalizeOpenAIChatTool(tool) {
  if (!isRecord(tool)) return tool;
  if (tool.type === 'function' && isRecord(tool.function)) return tool;
  if (typeof tool.name === 'string') {
    return {
      type: 'function',
      function: compactObject({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        parameters: tool.parameters ?? tool.input_schema,
      }),
    };
  }
  return tool;
}

function normalizeOpenAIChatToolChoice(toolChoice) {
  if (!isRecord(toolChoice)) return toolChoice;
  if (toolChoice.type === 'function' && isRecord(toolChoice.function)) return toolChoice;
  if ((toolChoice.type === 'function' || toolChoice.type === 'tool') && typeof toolChoice.name === 'string') {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return toolChoice;
}

function toOpenAIChatLegacyFromChat(body) {
  return compactObject({
    model: body.model,
    messages: Array.isArray(body.messages) ? body.messages : [],
    stream: body.stream,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    max_completion_tokens: body.max_completion_tokens,
    presence_penalty: body.presence_penalty,
    frequency_penalty: body.frequency_penalty,
    stop: body.stop,
    tools: Array.isArray(body.tools) ? body.tools.map(normalizeOpenAIChatTool) : undefined,
    tool_choice: normalizeOpenAIChatToolChoice(body.tool_choice),
    parallel_tool_calls: body.parallel_tool_calls,
    response_format: body.response_format,
    stream_options: body.stream_options,
    logprobs: body.logprobs,
    top_logprobs: body.top_logprobs,
    logit_bias: body.logit_bias,
    seed: body.seed,
    n: body.n,
    user: body.user,
    service_tier: body.service_tier,
    modalities: body.modalities,
    audio: body.audio,
    prediction: body.prediction,
  });
}

function buildOpenAIChatLegacyConsumedKeys() {
  return ['model', 'stream', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'presence_penalty', 'frequency_penalty'];
}

function resolveNativeToolCallMode(body) {
  return Array.isArray(body.tools) && body.tools.length > 0 ? 'on' : 'off';
}

function buildOpenAIChatExtra(body, nativeToolCallMode) {
  const handled = new Set([
    'model', 'messages', 'stream', 'temperature', 'top_p', 'max_tokens',
    'max_completion_tokens', 'presence_penalty', 'frequency_penalty', 'stop',
    'tools', 'tool_choice', 'parallel_tool_calls', 'response_format',
    'stream_options', 'logprobs', 'top_logprobs', 'logit_bias', 'seed', 'n',
    'user', 'service_tier', 'modalities', 'audio', 'prediction', '_responsesFiles', '_upstreamFiles'
  ]);
  const extra = {};
  for (const [key, value] of Object.entries(body)) {
    if (handled.has(key) || value === undefined) continue;
    extra[key] = value;
  }
  if (nativeToolCallMode === 'on') extra.relayToolCallNonce = 生成nonce();
  return extra;
}

function openAIChatToUnified(body, defaultModel = '') {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const requestedModel = body.model || defaultModel;
  const convertedMessages = rawMessages.map(m => ({
    role: m.role || 'user',
    content: contentToUnifiedBlocks(m.content ?? ''),
  }));
  const split = splitSystemPrompt(convertedMessages);

  // 关键原则：rawRequestBody 必须尽量保持下游原始请求体。
  // 中转站只通过 consumedKeys 抽离自身已经消费的字段，其余字段不重建、不规范化、不改名。
  const rawRequestBody = { ...body };
  const nativeToolCallMode = resolveNativeToolCallMode(rawRequestBody);

  return {
    protocol: 'openai-chat',
    downstreamModel: requestedModel,
    upstreamModel: requestedModel,
    messages: split.messages,
    systemPrompt: split.systemPrompt,
    temperature: body.temperature,
    topP: body.top_p,
    maxTokens: body.max_tokens,
    presencePenalty: body.presence_penalty,
    frequencyPenalty: body.frequency_penalty,
    stop: body.stop,
    stream: body.stream !== false,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    toolChoice: body.tool_choice,
    rawRequestBody,
    consumedKeys: buildOpenAIChatLegacyConsumedKeys(),
    nativeToolCallMode,
    extra: buildOpenAIChatExtra(body, nativeToolCallMode),
  };
}

module.exports = {
  openAIChatToUnified,
  toOpenAIChatLegacyFromChat,
  buildOpenAIChatLegacyConsumedKeys,
  normalizeOpenAIChatTool,
  normalizeOpenAIChatToolChoice,
};