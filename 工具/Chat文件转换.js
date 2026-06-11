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

function 提取图片URL(part) {
  const imageUrl = part.image_url || part.imageUrl || part.url || (isRecord(part.source) ? (part.source.url || part.source.data) : undefined);
  if (typeof imageUrl === 'string') return imageUrl;
  if (isRecord(imageUrl)) return imageUrl.url || imageUrl.data;
  return undefined;
}

function 提取文件数据(part) {
  return part.file_data || part.fileData || part.data || (isRecord(part.source) ? part.source.data : undefined);
}

function 提取文件URL(part) {
  return part.file_url || part.fileUrl || part.url || (isRecord(part.source) ? part.source.url : undefined);
}

function 是图片Part(part) {
  if (!isRecord(part)) return false;
  const type = part.type || '';
  if (type === 'file' || type === 'input_file') return false;
  return type === 'image_url' || type === 'input_image' || type === 'image' || !!part.image_url || !!part.imageUrl || (isRecord(part.source) && !!(part.source.url || part.source.data) && String(part.source.media_type || '').startsWith('image/'));
}

function 是文件Part(part) {
  if (!isRecord(part)) return false;
  const type = part.type || '';
  return type === 'input_file' || type === 'file' || !!part.file_id || !!提取文件数据(part) || !!提取文件URL(part);
}

function part转文件项(part, index) {
  if (是图片Part(part)) {
    const imageUrl = 提取图片URL(part);
    return compactObject({
      type: 'image',
      image_url: imageUrl,
      url: imageUrl,
      name: part.filename || part.name || ('chat-image-' + (index + 1)),
      mimeType: part.mime_type || part.mimeType || (isRecord(part.source) ? part.source.media_type : undefined),
      detail: part.detail,
    });
  }
  if (是文件Part(part)) {
    return compactObject({
      type: 'file',
      file_id: part.file_id,
      data: 提取文件数据(part),
      url: 提取文件URL(part),
      name: part.filename || part.name || ('chat-file-' + (index + 1)),
      mimeType: part.mime_type || part.mimeType || (isRecord(part.source) ? part.source.media_type : undefined),
    });
  }
  return null;
}

function 规范文件Scope(scope, fallback = 'last_user') {
  const value = String(scope || fallback || 'last_user').toLowerCase();
  return value === 'all' ? 'all' : 'last_user';
}

function 最后一条用户消息(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (isRecord(msg) && String(msg.role || 'user').toLowerCase() === 'user') return msg;
  }
  return null;
}

function 提取单条消息文件(msg, files) {
  if (!isRecord(msg) || !Array.isArray(msg.content)) return;
  for (const part of msg.content) {
    const item = part转文件项(part, files.length);
    if (item) files.push(item);
  }
}

function 提取Chat消息文件(messages, options = {}) {
  if (!Array.isArray(messages)) return [];
  const scope = 规范文件Scope(options.scope || process.env.OPENAI_CHAT_FILE_SCOPE || 配置.openai文件提取?.chatScope);
  const files = [];
  if (scope === 'last_user') {
    提取单条消息文件(最后一条用户消息(messages), files);
    return files;
  }
  for (const msg of messages) 提取单条消息文件(msg, files);
  return files;
}

async function 转换Chat消息文件(messages, options = {}) {
  const files = 提取Chat消息文件(messages, options);
  return 转换Responses文件(files, options);
}

module.exports = {
  提取Chat消息文件,
  转换Chat消息文件,
  是图片Part,
  是文件Part,
};
