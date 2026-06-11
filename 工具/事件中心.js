
const fs = require('fs');
const path = require('path');

const 事件文件路径 = path.join(__dirname, '..', '事件日志.jsonl');

function 记录事件(type, title, data = {}, level = 'INFO') {
  try {
    const item = {
      time: new Date().toISOString(),
      level: String(level || 'INFO').toUpperCase(),
      type: String(type || 'event'),
      title: String(title || ''),
      data,
    };
    fs.appendFileSync(事件文件路径, JSON.stringify(item) + '\n', 'utf-8');
    return item;
  } catch {
    return null;
  }
}

function 读取全部事件(max = 5000) {
  max = Math.max(1, Math.min(20000, Number(max || 5000)));
  try {
    if (!fs.existsSync(事件文件路径)) return [];
    const text = fs.readFileSync(事件文件路径, 'utf-8');
    const lines = text.split(/\r?\n/).filter(Boolean).slice(-max);
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return { raw: line, level: 'UNKNOWN', type: 'raw', title: line }; }
    }).reverse();
  } catch {
    return [];
  }
}

function 事件匹配(event, filters = {}) {
  const level = String(filters.level || 'ALL').trim().toUpperCase();
  const type = String(filters.type || '').trim();
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  if (level && level !== 'ALL' && String(event.level || '').toUpperCase() !== level) return false;
  if (type && String(event.type || '') !== type) return false;
  if (keyword) {
    const hay = JSON.stringify(event).toLowerCase();
    if (!hay.includes(keyword)) return false;
  }
  return true;
}

function 读取最近事件(limit = 100, filters = {}) {
  limit = Math.max(1, Math.min(1000, Number(limit || 100)));
  const events = 读取全部事件(Math.max(5000, limit * 5));
  return events.filter(e => 事件匹配(e, filters)).slice(0, limit);
}

function 统计事件(options = {}) {
  const max = Math.max(1, Math.min(20000, Number(options.max || 5000)));
  const events = 读取全部事件(max);
  const byLevel = {};
  const byType = {};
  const abnormalLevels = new Set(['WARN', 'ERROR', 'FATAL']);
  const recentAbnormal = [];

  for (const e of events) {
    const level = String(e.level || 'UNKNOWN').toUpperCase();
    const type = String(e.type || 'unknown');
    byLevel[level] = (byLevel[level] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
    if (abnormalLevels.has(level) && recentAbnormal.length < 20) recentAbnormal.push(e);
  }

  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([type, count]) => ({ type, count }));

  return {
    total: events.length,
    byLevel,
    byType,
    topTypes,
    recentAbnormal,
  };
}

function 获取状态() {
  try {
    if (!fs.existsSync(事件文件路径)) {
      return { file: '事件日志.jsonl', exists: false, size: 0, updatedAt: null };
    }
    const st = fs.statSync(事件文件路径);
    return { file: '事件日志.jsonl', exists: true, size: st.size, updatedAt: st.mtime.toISOString() };
  } catch {
    return { file: '事件日志.jsonl', exists: false, size: 0, updatedAt: null };
  }
}

module.exports = {
  记录事件,
  读取全部事件,
  读取最近事件,
  统计事件,
  获取状态,
};
