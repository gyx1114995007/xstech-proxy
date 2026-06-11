const 模型映射 = require('../服务层/模型映射');
const { 解析DataURL, 判断图片Mime, base64字节数 } = require('./Responses文件转换');

function 创建错误(message, code, param = 'input') {
  const err = new Error(message);
  err.code = code;
  err.param = param;
  err.status = 400;
  return err;
}

function 获取模型能力(model) {
  const list = 模型映射.getModelPrices ? 模型映射.getModelPrices() : [];
  const xstech = 模型映射.toXstechModel ? 模型映射.toXstechModel(model) : model;
  const item = (list || []).find(x => x && (x.id === model || x.value === model || x.value === xstech));
  return item ? (item.capabilities || {}) : null;
}

function 文件信息(file) {
  const parsed = 解析DataURL(file && file.data);
  const mime = (file && file.mime) || (parsed && parsed.mime) || '';
  const size = (file && file.size) || (parsed ? base64字节数(parsed.base64) : 0);
  return { mime, size, kind: 判断图片Mime(mime) ? 'image' : 'file', name: file && file.name };
}

function 校验模型文件能力(model, files = [], options = {}) {
  if (!Array.isArray(files) || files.length === 0) return { ok: true, skipped: true };
  const caps = 获取模型能力(model);
  // 没有能力缓存时不做硬拒绝，避免本地缓存缺失导致兼容性倒退。
  if (!caps) return { ok: true, skipped: true, reason: 'capabilities_missing' };

  const maxCount = Number(options.maxCount || process.env.XSTECH_MAX_FILE_COUNT || 8);
  const maxSizeMB = Number(options.maxSizeMB || process.env.XSTECH_MAX_FILE_SIZE_MB || 10);
  const maxBytes = maxSizeMB * 1024 * 1024;

  if (files.length > maxCount) throw 创建错误('文件数量超过模型限制 ' + maxCount, 'too_many_files');

  for (const file of files) {
    const info = 文件信息(file);
    if (info.size > maxBytes) throw 创建错误('文件超过模型大小限制 ' + maxSizeMB + 'MB: ' + (info.name || ''), 'file_too_large');
    if (info.kind === 'image') {
      if (!(caps.imageInput || caps.anyFile)) throw 创建错误('当前模型不支持图片输入', 'model_image_not_supported');
    } else {
      if (!caps.anyFile) throw 创建错误('当前模型不支持任意文件输入', 'model_file_not_supported');
    }
  }
  return { ok: true, capabilities: caps, maxCount, maxSizeMB };
}

module.exports = { 获取模型能力, 校验模型文件能力, 文件信息 };