const { compileGenericStructureToLines, compileSchemaNodeToLines } = require('./请求结构编译器');
const { 构建工具调用提示词 } = require('./工具调用提示词');

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildRequestExtraSection(request, excludedKeys = new Set()) {
  const extra = request.extra || {};
  const entries = Object.entries(extra).filter(([key, value]) => value !== undefined && !excludedKeys.has(key));
  if (entries.length === 0) return '';
  const lines = [];
  for (const [key, value] of entries) {
    lines.push(key + ':');
    lines.push(...compileGenericStructureToLines(value, '  '));
  }
  return lines.join('\n').trim();
}

function buildToolChoiceSection(request) {
  const extra = request.extra || {};
  const toolChoice = request.toolChoice ?? extra.tool_choice ?? extra.toolChoice;
  if (toolChoice === undefined) return '';
  return compileGenericStructureToLines(toolChoice).join('\n');
}

function buildToolRegistrySection(request) {
  const tools = Array.isArray(request.tools) ? request.tools : [];
  if (tools.length === 0) return '';
  const lines = [];
  for (const tool of tools) {
    const fn = tool && typeof tool === 'object' && tool.function && typeof tool.function === 'object' ? tool.function : {};
    const type = typeof tool.type === 'string' ? tool.type : 'function';
    const name = typeof fn.name === 'string' ? fn.name : (typeof tool.name === 'string' ? tool.name : 'unknown_tool');
    const description = typeof fn.description === 'string' ? fn.description : '';
    lines.push('tool:');
    lines.push('  type: ' + type);
    lines.push('  name: ' + name);
    if (description) lines.push('  description: ' + description);
    lines.push('  parameters:');
    lines.push(...compileSchemaNodeToLines(fn.parameters, '    '));
    lines.push('');
  }
  return lines.join('\n').trim();
}

function isImageContentPart(part) {
  if (!isRecord(part)) return false;
  if (part.type === 'image' || part.type === 'image_url' || part.type === 'input_image') return true;
  if ('image_url' in part || 'imageUrl' in part) return true;
  const source = part.source;
  return isRecord(source) && typeof source.type === 'string' && source.type.includes('base64');
}

function isFileContentPart(part) {
  if (!isRecord(part)) return false;
  const type = part.type || '';
  if (type === 'file' || type === 'input_file') return true;
  if ('file_data' in part || 'fileData' in part || 'file_url' in part || 'fileUrl' in part || 'file_id' in part) return true;
  return false;
}

function sanitizeMessageContentForText(content) {
  if (!Array.isArray(content)) return content;
  const kept = content.filter(part => !isImageContentPart(part) && !isFileContentPart(part));
  if (kept.length === 0) return '';
  if (kept.length === 1 && isRecord(kept[0]) && kept[0].type === 'text' && typeof kept[0].text === 'string') {
    return kept[0].text;
  }
  return kept;
}

function sanitizeMessagesForText(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(message => {
    if (!isRecord(message)) return message;
    return { ...message, content: sanitizeMessageContentForText(message.content) };
  });
}

function sanitizeRawRequestBodyForText(raw) {
  if (!Array.isArray(raw.messages)) return raw;
  return { ...raw, messages: sanitizeMessagesForText(raw.messages) };
}

const 内部文本排除字段 = new Set(['_responsesFiles', '_upstreamFiles', '_claudeMeta', '_responsesMeta']);

function buildRemainingRequestBody(request) {
  const raw = request.rawRequestBody;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const sanitizedRaw = sanitizeRawRequestBodyForText(raw);
  const consumed = new Set(request.consumedKeys || []);
  const remaining = {};
  for (const [key, value] of Object.entries(sanitizedRaw)) {
    if (consumed.has(key) || 内部文本排除字段.has(key) || value === undefined) continue;
    remaining[key] = value;
  }
  return remaining;
}

function buildUpstreamToolPrompt(request) {
  if (request.nativeToolCallMode !== 'on') return '';
  const relayToolCallNonce = request.extra && typeof request.extra.relayToolCallNonce === 'string'
    ? request.extra.relayToolCallNonce
    : '';
  if (!relayToolCallNonce) return '';
  return 构建工具调用提示词(relayToolCallNonce).trim();
}

function buildUpstreamText(request) {
  const remaining = buildRemainingRequestBody(request);
  if (!remaining) throw new Error('rawRequestBody is required for openai-chat translation');

  // 严格对齐 xs-relay 当前路径：
  // 给上游的 JSON = 下游原始请求体 - 中转站已消费字段。
  // 不额外添加 tool registry / tool choice / system_prompt 等协议字段。
  const requestJson = JSON.stringify(remaining, null, 2);
  const toolPrompt = buildUpstreamToolPrompt(request);
  return toolPrompt ? (toolPrompt + '\n\n════════════════════════════════\n' + requestJson) : requestJson;
}

module.exports = {
  buildUpstreamText,
  buildRemainingRequestBody,
  buildToolChoiceSection,
  buildToolRegistrySection,
  buildRequestExtraSection,
};