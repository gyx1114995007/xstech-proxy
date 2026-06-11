const axios = require('axios');

const 默认最大文件数 = 8;
const 默认最大文件大小MB = 10;
const 默认最大文件字节 = 默认最大文件大小MB * 1024 * 1024;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function 创建错误(message, code, param, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.param = param;
  err.status = status;
  return err;
}

function 是DataURL(value) {
  return typeof value === 'string' && /^data:[^;,]+(?:;[^,]*)?;base64,/i.test(value);
}

function 解析DataURL(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/i);
  if (!m) return null;
  return { mime: m[1] || 'application/octet-stream', base64: m[2] || '' };
}

function base64字节数(base64) {
  const clean = String(base64 || '').replace(/\s+/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function 扩展名转Mime(name = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    pdf: 'application/pdf',
    html: 'text/html',
    htm: 'text/html',
    xml: 'application/xml',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || '';
}

function mime转扩展名(mime = '') {
  const m = String(mime).toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/json') return 'json';
  if (m.startsWith('text/')) return 'txt';
  return 'bin';
}

function 安全文件名(name, mime, index) {
  const raw = String(name || '').trim().replace(/[\r\n\t]/g, '_').slice(0, 180);
  const ext = mime转扩展名(mime);
  if (!raw) return 'responses-file-' + (index + 1) + '.' + ext;
  const last = raw.split('/').pop().split('\\').pop();
  const hasExt = /\.[A-Za-z0-9]{1,10}$/.test(last);
  return hasExt ? raw : (raw + '.' + ext);
}

function 判断图片Mime(mime = '') {
  return String(mime).toLowerCase().startsWith('image/');
}

function 提取图片源(item) {
  const imageUrl = item.image_url || item.imageUrl || item.url || (isRecord(item.source) ? (item.source.url || item.source.data) : undefined);
  if (typeof imageUrl === 'string') return imageUrl;
  if (isRecord(imageUrl)) return imageUrl.url || imageUrl.data;
  return undefined;
}

function 提取文件源(item) {
  return item.file_data || item.fileData || item.data || item.file_url || item.fileUrl || item.url || (isRecord(item.source) ? (item.source.data || item.source.url) : undefined);
}

async function 下载为DataURL(url, hint = {}) {
  const urlText = String(url || '');
  if (!urlText.toLowerCase().startsWith('http://') && !urlText.toLowerCase().startsWith('https://')) {
    throw 创建错误('仅支持 http/https URL 或 data URL 文件输入', 'unsupported_file_url', 'input');
  }
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: hint.timeoutMs || 30000,
    maxContentLength: hint.maxBytes || 默认最大文件字节,
    validateStatus: () => true,
    proxy: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw 创建错误('下载文件失败: HTTP ' + res.status, 'file_download_failed', 'input', 400);
  }
  const buf = Buffer.from(res.data);
  if (buf.length > (hint.maxBytes || 默认最大文件字节)) {
    throw 创建错误('文件超过大小限制 ' + 默认最大文件大小MB + 'MB', 'file_too_large', 'input');
  }
  const contentType = String(res.headers && res.headers['content-type'] || '').split(';')[0].trim();
  const mime = hint.mime || contentType || 扩展名转Mime(hint.name) || 'application/octet-stream';
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

async function 转换单个文件(file, index, options = {}) {
  const kind = file.type === 'image' || file.type === 'input_image' ? 'image' : 'file';
  if (file.file_id) {
    throw 创建错误('暂不支持 OpenAI file_id，请使用 image_url/file_url 或 file_data data URL', 'unsupported_file_id', 'input');
  }

  const source = kind === 'image' ? (file.data || 提取图片源(file)) : 提取文件源(file);
  if (!source) {
    throw 创建错误(kind === 'image' ? 'input_image 缺少 image_url/url/source.data' : 'input_file 缺少 file_data/file_url/url', kind === 'image' ? 'invalid_input_image' : 'invalid_input_file', 'input');
  }

  let dataUrl = source;
  if (!是DataURL(dataUrl)) dataUrl = await 下载为DataURL(dataUrl, {
    name: file.name || file.filename,
    mime: file.mimeType || file.mime_type,
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
  });

  const parsed = 解析DataURL(dataUrl);
  if (!parsed) throw 创建错误('文件必须是有效 data:<mime>;base64,... 格式', 'invalid_file_data', 'input');

  const size = base64字节数(parsed.base64);
  const maxBytes = options.maxBytes || 默认最大文件字节;
  if (size > maxBytes) {
    throw 创建错误('文件超过大小限制 ' + Math.round(maxBytes / 1024 / 1024) + 'MB', 'file_too_large', 'input');
  }

  const mime = file.mimeType || file.mime_type || parsed.mime || 扩展名转Mime(file.name || file.filename) || 'application/octet-stream';
  if (kind === 'image' && !判断图片Mime(mime)) {
    throw 创建错误('input_image 的 MIME 不是 image/*: ' + mime, 'invalid_input_image_mime', 'input');
  }

  return {
    name: 安全文件名(file.name || file.filename, mime, index),
    data: dataUrl,
  };
}

async function 转换Responses文件(files = [], options = {}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const maxCount = options.maxCount || 默认最大文件数;
  if (files.length > maxCount) {
    throw 创建错误('文件数量超过限制 ' + maxCount, 'too_many_files', 'input');
  }
  const out = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await 转换单个文件(files[i], i, options));
  }
  return out;
}

module.exports = {
  转换Responses文件,
  转换单个文件,
  是DataURL,
  解析DataURL,
  base64字节数,
  判断图片Mime,
};
