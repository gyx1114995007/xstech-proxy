const 不可见格式字符 = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function 清理不可见字符(text) {
  if (text === undefined || text === null) return '';
  return String(text).replace(不可见格式字符, '');
}

function 深度清理不可见字符(value) {
  if (typeof value === 'string') return 清理不可见字符(value);
  if (Array.isArray(value)) return value.map(深度清理不可见字符);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = 深度清理不可见字符(item);
    return out;
  }
  return value;
}

module.exports = { 清理不可见字符, 深度清理不可见字符 };
