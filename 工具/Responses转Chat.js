const 配置 = require('../启动/配置');
const { 转换Responses文件 } = require('./Responses文件转换');

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

function 规范role(role) {
  if (role === 'assistant') return 'assistant';
  if (role === 'system' || role === 'developer') return 'system';
  if (role === 'tool') return 'tool';
  return 'user';
}

function 提取文件项(item) {
  if (!isRecord(item)) return null;
  const type = item.type || '';
  if (type === 'input_image' || type === 'image_url') {
    const imageUrl = item.image_url || item.imageUrl || item.url || (isRecord(item.source) ? (item.source.url || item.source.data) : undefined);
    if (!imageUrl) throw Object.assign(new Error('input_image 缺少 image_url/url/source.data'), { code: 'invalid_input_image', param: 'input' });
    return compactObject({
      type: 'image',
      url: typeof imageUrl === 'string' ? imageUrl : imageUrl.url,
      image_url: typeof imageUrl === 'string' ? imageUrl : imageUrl,
      detail: item.detail,
      mimeType: item.mime_type || item.mimeType || (isRecord(item.source) ? item.source.media_type : undefined),
      name: item.name || item.filename,
    });
  }
  if (type === 'input_file' || type === 'file') {
    return compactObject({
      type: 'file',
      file_id: item.file_id,
      data: item.file_data || item.fileData || item.data || (isRecord(item.source) ? item.source.data : undefined),
      url: item.file_url || item.fileUrl || item.url || (isRecord(item.source) ? item.source.url : undefined),
      name: item.filename || item.name,
      mimeType: item.mime_type || item.mimeType || (isRecord(item.source) ? item.source.media_type : undefined),
    });
  }
  return null;
}

function 提取Content文件(content) {
  if (!Array.isArray(content)) return [];
  return content.map(提取文件项).filter(Boolean);
}

function 文本化Content(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (isRecord(content)) return 文本化Content([content]);
  if (!Array.isArray(content)) return String(content);
  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') { parts.push(item); continue; }
    if (!isRecord(item)) continue;
    const type = item.type || '';
    if (type === 'input_text' || type === 'text' || type === 'output_text') parts.push(item.text || '');
    else if (type === 'refusal') parts.push(item.refusal || '');
    else if (type === 'summary_text') parts.push(item.text || '');
    else if (type === 'input_image' || type === 'image_url') {
      // 文件/图片由 _responsesFiles 独立传给 xstech files，不再污染文本上下文。
    }
    else if (type === 'input_file' || type === 'file') {
      // 文件/图片由 _responsesFiles 独立传给 xstech files，不再污染文本上下文。
    }
    else if (type === 'function_call_output') parts.push('[Function Output ' + (item.call_id || '') + ']\n' + (typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')));
    else if (item.text) parts.push(String(item.text));
    else if (item.content) parts.push(文本化Content(item.content));
    else if (type) parts.push('[' + type + '] ' + JSON.stringify(item));
  }
  return parts.filter(Boolean).join('\n');
}

function itemToMessage(item) {
  if (typeof item === 'string') return { role: 'user', content: item };
  if (!isRecord(item)) return null;
  const type = item.type || 'message';
  if (type === 'message' || item.role) {
    const role = 规范role(item.role || 'user');
    const content = 文本化Content(item.content);
    return content ? { role: role === 'tool' ? 'user' : role, content } : null;
  }
  if (type === 'function_call_output') {
    return {
      role: 'tool',
      tool_call_id: item.call_id || item.id,
      content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
    };
  }
  if (type === 'function_call') {
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: item.call_id || item.id,
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '' },
      }],
    };
  }
  if (type === 'reasoning') {
    const text = 文本化Content(item.summary || item.content || item.text || '');
    return text ? { role: 'assistant', content: '[Reasoning Summary]\n' + text } : null;
  }
  const text = 文本化Content(item.content || item.text || item);
  return text ? { role: 'user', content: text } : null;
}

function 规范文件Scope(scope, fallback = 'last_user') {
  const value = String(scope || fallback || 'last_user').toLowerCase();
  return value === 'all' ? 'all' : 'last_user';
}

function 是ResponsesMessage(item) {
  return isRecord(item) && (item.type === 'message' || Object.prototype.hasOwnProperty.call(item, 'role'));
}

function 最后一条用户Input消息(input) {
  if (!Array.isArray(input)) return null;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (是ResponsesMessage(item) && 规范role(item.role || 'user') === 'user') return item;
  }
  return null;
}

function 提取Input文件(input, options = {}) {
  if (!Array.isArray(input)) return [];
  const scope = 规范文件Scope(options.scope || process.env.RESPONSES_INPUT_FILE_SCOPE || 配置.openai文件提取?.responsesScope);
  const files = [];

  if (scope === 'last_user') {
    // 顶层直接 input_image/input_file 不属于历史 message，通常代表当前轮多模态输入，应该保留。
    for (const item of input) {
      if (!isRecord(item) || 是ResponsesMessage(item)) continue;
      const direct = 提取文件项(item);
      if (direct) files.push(direct);
    }
    const lastUser = 最后一条用户Input消息(input);
    if (lastUser) files.push(...提取Content文件(lastUser.content));
    return files;
  }

  for (const item of input) {
    if (!isRecord(item)) continue;
    const direct = 提取文件项(item);
    if (direct) files.push(direct);
    files.push(...提取Content文件(item.content));
  }
  return files;
}

function 转换消息(input) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) throw Object.assign(new Error('Responses input 必须是字符串或数组'), { code: 'invalid_responses_input', param: 'input' });
  return input.map(itemToMessage).filter(Boolean).filter(m => m.content !== '' || Array.isArray(m.tool_calls));
}

function 是FunctionTool(tool) {
  return isRecord(tool) && tool.type === 'function';
}

function 是OpenAI内置工具(tool) {
  // 重要：只按 type 判断内置工具，绝不能按 name 判断。
  // { type: 'function', name: 'web_search_preview' } 是用户自定义函数工具，必须允许。
  // { type: 'web_search_preview' } 才是 OpenAI Responses 内置工具。
  return isRecord(tool) && typeof tool.type === 'string' && tool.type !== 'function';
}

function 转换工具(tools) {
  if (!Array.isArray(tools)) return { tools: undefined, unsupported: [] };
  const out = [];
  const unsupported = [];
  for (const t of tools) {
    if (!isRecord(t)) continue;
    if (是FunctionTool(t)) {
      if (isRecord(t.function)) out.push(t);
      else out.push({
        type: 'function',
        function: compactObject({
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || t.input_schema || { type: 'object', properties: {} },
        }),
      });
    } else if (是OpenAI内置工具(t)) {
      unsupported.push(t.type || 'unknown');
    }
  }
  return { tools: out.length ? out : undefined, unsupported };
}

function 转换ToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (!isRecord(toolChoice)) return toolChoice;
  if (toolChoice.type === 'function') {
    if (toolChoice.function) return toolChoice;
    if (toolChoice.name) return { type: 'function', function: { name: toolChoice.name } };
  }
  return toolChoice;
}

async function responsesToChat(body = {}, options = {}) {
  if (!body.model) throw Object.assign(new Error('缺少 model'), { code: 'missing_model', param: 'model' });
  const messages = [];
  if (body.instructions) messages.push({ role: 'system', content: String(body.instructions) });
  if (Array.isArray(options.previousMessages) && options.previousMessages.length) messages.push(...options.previousMessages);
  messages.push(...转换消息(body.input == null ? '' : body.input));

  const { tools, unsupported } = 转换工具(body.tools);
  if (unsupported && unsupported.length) {
    messages.unshift({ role: 'system', content: '注意：本中转站当前暂不支持以下 OpenAI Responses 内置工具，将忽略这些工具：' + unsupported.join(', ') });
  }

  const responseFiles = 提取Input文件(body.input, { scope: options.fileScope });
  const upstreamFiles = await 转换Responses文件(responseFiles, {
    maxCount: options.maxFileCount || 8,
    maxBytes: (options.maxFileSizeMB || 10) * 1024 * 1024,
  });
  const chat = compactObject({
    model: body.model,
    messages,
    stream: true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens ?? body.max_tokens,
    presence_penalty: body.presence_penalty,
    frequency_penalty: body.frequency_penalty,
    stop: body.stop,
    tools,
    tool_choice: 转换ToolChoice(body.tool_choice),
    parallel_tool_calls: body.parallel_tool_calls,
    response_format: body.text && body.text.format ? { type: body.text.format.type || body.text.format } : body.response_format,
    user: body.user,
    _responsesFiles: upstreamFiles.length ? upstreamFiles : undefined,
  });
  chat._responsesMeta = {
    previous_response_id: body.previous_response_id,
    store: body.store,
    metadata: body.metadata,
    truncation: body.truncation,
    reasoning: body.reasoning,
    unsupportedTools: unsupported,
    fileCount: responseFiles.length,
  };
  return chat;
}

module.exports = { responsesToChat, 文本化Content, 转换消息, 转换工具, 是FunctionTool, 是OpenAI内置工具, 提取文件项, 提取Input文件 };