const 配置 = require('../启动/配置');
const { 转换Responses文件 } = require('./Responses文件转换');

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) if (v !== undefined) out[k] = v;
  return out;
}

function 创建错误(message, code, param, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.param = param;
  err.status = status;
  return err;
}

function claudeSource转DataURL(source, param = 'messages') {
  if (typeof source === 'string') return source;
  if (!isRecord(source)) return undefined;
  if (source.type === 'base64') {
    if (!source.data) throw 创建错误('Claude 文件 source 缺少 data', 'invalid_file_data', param);
    const mime = source.media_type || source.mime_type || 'application/octet-stream';
    return 'data:' + mime + ';base64,' + String(source.data).replace(/^data:[^,]+,/i, '');
  }
  if (source.type === 'url') {
    if (typeof source.url === 'string') return source.url;
    if (isRecord(source.url)) return source.url.url || source.url.data;
  }
  if (typeof source.url === 'string') return source.url;
  if (isRecord(source.url)) return source.url.url || source.url.data;
  if (typeof source.data === 'string') {
    if (/^data:[^;,]+(?:;[^,]*)?;base64,/i.test(source.data)) return source.data;
    const mime = source.media_type || source.mime_type || 'application/octet-stream';
    return 'data:' + mime + ';base64,' + source.data;
  }
  return undefined;
}

function claude块转文件项(item, index = 0) {
  if (!isRecord(item)) return null;
  const type = item.type || '';
  const isImage = type === 'image' || !!item.image_url || !!item.imageUrl || (typeof item.url === 'string' && String(item.media_type || item.mime_type || '').startsWith('image/'));
  if (isImage) {
    const imageSource = item.source || item.image_url || item.imageUrl || item.url || item.data;
    const data = claudeSource转DataURL(imageSource, 'messages.content.source');
    if (!data) throw 创建错误('Claude image 缺少 source.data/source.url/image_url/url', 'invalid_image_source', 'messages');
    return compactObject({
      type: 'image',
      data,
      url: data,
      name: item.name || item.filename || ('claude-image-' + (index + 1)),
      mimeType: item.media_type || item.mime_type || item.mimeType || (isRecord(item.source) ? (item.source.media_type || item.source.mime_type) : undefined),
    });
  }
  if (type === 'document' || type === 'file') {
    const data = claudeSource转DataURL(item.source, 'messages.content.source') || item.data || item.file_data || item.fileData || item.url || item.file_url || item.fileUrl;
    if (!data && item.file_id) throw 创建错误('暂不支持 Claude file_id，请使用 base64 或 url source', 'unsupported_file_id', 'messages');
    if (!data) throw 创建错误('Claude document/file 缺少 source.data 或 source.url', 'invalid_file_source', 'messages');
    return compactObject({
      type: 'file',
      data,
      url: data,
      name: item.name || item.filename || ('claude-file-' + (index + 1)),
      mimeType: item.media_type || item.mime_type || item.mimeType || (isRecord(item.source) ? (item.source.media_type || item.source.mime_type) : undefined),
    });
  }
  return null;
}

function 文本化Content(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (isRecord(content)) return 文本化Content([content]);
  if (!Array.isArray(content)) return String(content);

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const type = item.type || '';
    if (type === 'text') parts.push(item.text || '');
    else if (type === 'tool_result') {
      const contentText = typeof item.content === 'string' ? item.content : 文本化Content(item.content);
      parts.push('[Tool Result ' + (item.tool_use_id || item.id || '') + ']\\n' + contentText);
    } else if (type === 'tool_use') {
      parts.push('[Tool Use ' + (item.name || '') + ']\\n' + JSON.stringify(item.input || {}));
    } else if (type === 'image' || type === 'document' || type === 'file') {
      // 文件/图片由 _responsesFiles 独立传给 xstech files，不污染文本上下文。
    } else if (item.text) {
      parts.push(String(item.text));
    } else if (item.content) {
      parts.push(文本化Content(item.content));
    } else if (type) {
      parts.push('[' + type + '] ' + JSON.stringify(item));
    }
  }
  return parts.filter(Boolean).join('\\n');
}

function 规范ClaudeRole(role) {
  return role === 'assistant' ? 'assistant' : 'user';
}

function claudeToolUse转Chat消息(item) {
  if (!isRecord(item) || item.type !== 'tool_use') return null;
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: item.id || item.tool_use_id || ('toolu_' + Date.now()),
      type: 'function',
      function: {
        name: item.name || '',
        arguments: JSON.stringify(item.input || {}),
      },
    }],
  };
}

function claudeToolResult转Chat消息(item) {
  if (!isRecord(item) || item.type !== 'tool_result') return null;
  const contentText = typeof item.content === 'string' ? item.content : 文本化Content(item.content);
  return {
    role: 'tool',
    tool_call_id: item.tool_use_id || item.id || '',
    content: contentText || '',
  };
}

function 转换单条消息(m) {
  if (!isRecord(m)) return [];
  const content = m.content;
  const role = 规范ClaudeRole(m.role);

  if (!Array.isArray(content)) {
    const text = 文本化Content(content);
    return text ? [{ role, content: text }] : [];
  }

  const out = [];
  const textParts = [];
  for (const item of content) {
    if (isRecord(item) && item.type === 'tool_result') {
      const pendingText = textParts.filter(Boolean).join('\\n');
      if (pendingText) {
        out.push({ role, content: pendingText });
        textParts.length = 0;
      }
      const toolMsg = claudeToolResult转Chat消息(item);
      if (toolMsg) out.push(toolMsg);
      continue;
    }
    if (isRecord(item) && item.type === 'tool_use') {
      const pendingText = textParts.filter(Boolean).join('\\n');
      if (pendingText) {
        out.push({ role, content: pendingText });
        textParts.length = 0;
      }
      const toolUseMsg = claudeToolUse转Chat消息(item);
      if (toolUseMsg) out.push(toolUseMsg);
      continue;
    }
    const text = 文本化Content([item]);
    if (text) textParts.push(text);
  }
  const tail = textParts.filter(Boolean).join('\\n');
  if (tail) out.push({ role, content: tail });
  return out;
}

function 转换消息(messages) {
  if (!Array.isArray(messages)) throw 创建错误('Claude messages 必须是数组', 'invalid_messages', 'messages');
  return messages.flatMap(转换单条消息).filter(Boolean).filter(m => m.content !== '' || Array.isArray(m.tool_calls));
}

function 提取Claude文件(messages, options = {}) {
  if (!Array.isArray(messages)) return [];
  const scope = String(options.scope || process.env.CLAUDE_INPUT_FILE_SCOPE || 配置.openai文件提取?.chatScope || 'last_user').toLowerCase() === 'all' ? 'all' : 'last_user';
  const sourceMessages = scope === 'all' ? messages : (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (isRecord(m) && 规范ClaudeRole(m.role) === 'user') return [m];
    }
    return [];
  })();

  const files = [];
  for (const msg of sourceMessages) {
    if (!isRecord(msg) || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      const file = claude块转文件项(part, files.length);
      if (file) files.push(file);
    }
  }
  return files;
}

function 转换工具(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = [];
  for (const t of tools) {
    if (!isRecord(t) || typeof t.name !== 'string') continue;
    out.push({
      type: 'function',
      function: compactObject({
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
      }),
    });
  }
  return out.length ? out : undefined;
}

function 转换ToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto' || toolChoice === 'any') return 'auto';
    if (toolChoice === 'none') return 'none';
    return toolChoice;
  }
  if (!isRecord(toolChoice)) return undefined;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'auto';
  if (toolChoice.type === 'none') return 'none';
  if (toolChoice.type === 'tool' && toolChoice.name) return { type: 'function', function: { name: toolChoice.name } };
  return undefined;
}

function 追加System(messages, system) {
  if (!system) return;
  const text = 文本化Content(system);
  if (text) messages.unshift({ role: 'system', content: text });
}

async function claudeToChat(body = {}, options = {}) {
  if (!body.model) throw 创建错误('缺少 model', 'missing_model', 'model');
  const messages = 转换消息(body.messages);
  追加System(messages, body.system);

  const claudeFiles = 提取Claude文件(body.messages, { scope: options.fileScope });
  const upstreamFiles = await 转换Responses文件(claudeFiles, {
    maxCount: options.maxFileCount || 8,
    maxBytes: (options.maxFileSizeMB || 10) * 1024 * 1024,
  });

  return compactObject({
    model: body.model,
    messages,
    stream: true,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
    tools: 转换工具(body.tools),
    tool_choice: 转换ToolChoice(body.tool_choice),
    user: body.metadata && body.metadata.user_id,
    _responsesFiles: upstreamFiles.length ? upstreamFiles : undefined,
    _claudeMeta: {
      metadata: body.metadata,
      system: body.system,
      stop_sequences: body.stop_sequences,
      tool_choice: body.tool_choice,
      fileCount: claudeFiles.length,
    },
  });
}

module.exports = {
  claudeToChat,
  文本化Content,
  转换消息,
  转换工具,
  转换ToolChoice,
  提取Claude文件,
  claude块转文件项,
};
