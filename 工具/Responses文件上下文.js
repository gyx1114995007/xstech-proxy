const fs = require('fs');
const path = require('path');
const 配置 = require('../启动/配置');
const { 解析DataURL, base64字节数, 判断图片Mime } = require('./Responses文件转换');

const 文件路径 = path.join(__dirname, '..', 'Responses文件上下文.jsonl');
const 内存 = new Map();
const 最大内存 = 200;

function 获取TTL() {
  return Number(process.env.RESPONSES_FILE_CONTEXT_TTL_MS || 配置.responses文件上下文?.ttlMs || 3600000);
}

function 获取模式() {
  const mode = String(process.env.RESPONSES_FILE_CONTEXT_MODE || 配置.responses文件上下文?.mode || 'auto').toLowerCase();
  return ['auto', 'always', 'never'].includes(mode) ? mode : 'auto';
}

function 估算文件(file) {
  const parsed = 解析DataURL(file && file.data);
  const mime = parsed ? parsed.mime : '';
  const size = parsed ? base64字节数(parsed.base64) : 0;
  return {
    name: file.name,
    data: file.data,
    mime,
    kind: 判断图片Mime(mime) ? 'image' : 'file',
    size,
  };
}

function 清理过期() {
  const now = Date.now();
  for (const [id, item] of 内存.entries()) {
    if (!item || item.expiresAtMs <= now) 内存.delete(id);
  }
}

function 保存(responseId, files = [], options = {}) {
  if (!responseId || !Array.isArray(files) || files.length === 0) return null;
  const ttlMs = Number(options.ttlMs || 获取TTL());
  if (ttlMs <= 0) return null;
  const now = Date.now();
  const item = {
    response_id: responseId,
    savedAt: new Date(now).toISOString(),
    savedAtMs: now,
    expiresAt: new Date(now + ttlMs).toISOString(),
    expiresAtMs: now + ttlMs,
    files: files.map(估算文件),
  };
  内存.set(responseId, item);
  while (内存.size > 最大内存) 内存.delete(内存.keys().next().value);
  try { fs.appendFileSync(文件路径, JSON.stringify(item) + '\n', 'utf8'); } catch {}
  清理过期();
  return { response_id: responseId, count: item.files.length, expiresAt: item.expiresAt };
}

function 从文件查找(responseId) {
  try {
    if (!fs.existsSync(文件路径)) return null;
    const lines = fs.readFileSync(文件路径, 'utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && obj.response_id === responseId) return obj;
      } catch {}
    }
  } catch {}
  return null;
}

function 获取(responseId) {
  清理过期();
  if (!responseId) return null;
  let item = 内存.get(responseId) || 从文件查找(responseId);
  if (!item || item.expiresAtMs <= Date.now()) return null;
  内存.set(responseId, item);
  return item;
}

function 提取当前文本(input) {
  if (typeof input === 'string') return input;
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { out.push(v); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.text === 'string') out.push(v.text);
    if (typeof v.content === 'string') out.push(v.content);
    if (Array.isArray(v.content)) v.content.forEach(walk);
  };
  if (Array.isArray(input)) input.forEach(walk);
  else walk(input);
  return out.join('\n');
}

function 判断重放意图(text, files = []) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return { replay: false, reason: 'empty_text' };
  const hasImage = files.some(f => f.kind === 'image');
  const imageWords = /(图里|图片里|照片里|截图里|这张图|那张图|上一张图|上一张图片|刚才.*图|看图|识别.*图|左边|右边|上面|下面|角落|颜色|二维码|金额|数字|文字|写了什么|previous image|last image|the image|screenshot)/i;
  const fileWords = /(文件里|文档里|附件里|刚才.*文件|上一个文件|继续解析|继续总结|总结.*文件|分析.*文件|attached file|previous file|last file|document|attachment)/i;
  if (hasImage && imageWords.test(t)) return { replay: true, reason: 'keyword_image' };
  if (fileWords.test(t)) return { replay: true, reason: 'keyword_file' };
  return { replay: false, reason: 'no_intent' };
}

function 解析显式策略(body = {}) {
  const direct = body.xstech_replay_files;
  if (direct === true || direct === false) return { has: true, value: direct, source: 'xstech_replay_files' };
  const meta = body.metadata;
  if (meta && typeof meta === 'object' && (meta.replay_files === true || meta.replay_files === false)) {
    return { has: true, value: meta.replay_files, source: 'metadata.replay_files' };
  }
  return { has: false };
}

function 选择重放文件(body = {}, currentFiles = []) {
  const previousId = body.previous_response_id;
  const ctx = 获取(previousId);
  if (!ctx || !Array.isArray(ctx.files) || ctx.files.length === 0) return { files: [], reason: 'none' };
  if (Array.isArray(currentFiles) && currentFiles.length > 0) return { files: [], reason: 'current_files_present' };

  const explicit = 解析显式策略(body);
  if (explicit.has) return { files: explicit.value ? ctx.files : [], reason: explicit.value ? explicit.source + '_true' : explicit.source + '_false' };

  const mode = 获取模式();
  if (mode === 'never') return { files: [], reason: 'mode_never' };
  if (mode === 'always') return { files: ctx.files, reason: 'mode_always' };

  const intent = 判断重放意图(提取当前文本(body.input), ctx.files);
  return { files: intent.replay ? ctx.files : [], reason: intent.reason };
}

function 状态() {
  清理过期();
  let lines = 0, size = 0;
  try {
    if (fs.existsSync(文件路径)) {
      const st = fs.statSync(文件路径);
      size = st.size;
      lines = fs.readFileSync(文件路径, 'utf8').split(/\r?\n/).filter(Boolean).length;
    }
  } catch {}
  return { file: 文件路径, memory: 内存.size, records: lines, size, mode: 获取模式(), ttlMs: 获取TTL() };
}

module.exports = { 保存, 获取, 选择重放文件, 判断重放意图, 提取当前文本, 状态, 获取模式, 获取TTL };