const fs = require('fs');
const path = require('path');

const 根目录 = path.join(__dirname, '..');

const 默认文件 = [
  { name: '账号列表.json', type: 'json', required: true },
  { name: '账号token.json', type: 'json', required: false },
  { name: '会话池.json', type: 'json', required: true },
  { name: '模型映射.json', type: 'json', required: false },
  { name: '模型价格.json', type: 'json', required: false },
  { name: '运行配置.json', type: 'json', required: false },
  { name: '误判词.json', type: 'json', required: false },
  { name: '模型流错误规则.json', type: 'json', required: false },
  { name: '模型流错误未分类.json', type: 'json', required: false },
  { name: '事件日志.jsonl', type: 'jsonl', required: false },
  { name: '订单历史.jsonl', type: 'jsonl', required: false },
  { name: '运行配置历史.jsonl', type: 'jsonl', required: false },
  { name: '项目进度.md', type: 'text', required: false },
];

function 文件路径(name) {
  return path.join(根目录, name);
}

function 解析JSON文本(text) {
  JSON.parse(text);
}

function 检查JSONL(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  let invalid = 0;
  const samples = [];
  lines.forEach((line, index) => {
    try { JSON.parse(line); }
    catch (err) {
      invalid++;
      if (samples.length < 5) samples.push({ line: index + 1, message: err.message, preview: line.slice(0, 160) });
    }
  });
  return { lines: lines.length, invalid, samples };
}

function 备份损坏文件(file, ts) {
  const backupPath = file + '.corrupt-backup-' + ts;
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

function 检查单文件(item, options = {}) {
  const file = 文件路径(item.name);
  const out = {
    name: item.name,
    type: item.type,
    required: !!item.required,
    exists: false,
    ok: true,
    size: 0,
    updatedAt: null,
    parseOk: null,
    issue: null,
    backupPath: null,
  };

  if (!fs.existsSync(file)) {
    out.exists = false;
    out.ok = !item.required;
    out.issue = item.required ? 'missing_required_file' : 'missing_optional_file';
    return out;
  }

  const st = fs.statSync(file);
  out.exists = true;
  out.size = st.size;
  out.updatedAt = st.mtime.toISOString();

  try {
    const text = fs.readFileSync(file, 'utf-8');
    if (item.type === 'json') {
      解析JSON文本(text || 'null');
      out.parseOk = true;
    } else if (item.type === 'jsonl') {
      const result = 检查JSONL(text);
      out.parseOk = result.invalid === 0;
      out.lines = result.lines;
      out.invalidLines = result.invalid;
      out.invalidSamples = result.samples;
      if (result.invalid > 0) throw new Error('JSONL 存在 ' + result.invalid + ' 行无法解析');
    } else {
      out.parseOk = true;
    }
  } catch (err) {
    out.ok = false;
    out.parseOk = false;
    out.issue = err.message || String(err);
    if (options.backupCorrupt) {
      try {
        out.backupPath = 备份损坏文件(file, options.ts || new Date().toISOString().replace(/[:.]/g, '-'));
      } catch (backupErr) {
        out.backupError = backupErr.message || String(backupErr);
      }
    }
  }

  return out;
}

function 检查(options = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const files = 默认文件.map(item => 检查单文件(item, { ...options, ts }));
  const summary = files.reduce((s, f) => {
    s.total++;
    if (f.exists) s.exists++; else s.missing++;
    if (f.ok) s.ok++; else s.bad++;
    if (f.parseOk === false) s.parseFailed++;
    if (f.backupPath) s.backups++;
    return s;
  }, { total: 0, exists: 0, missing: 0, ok: 0, bad: 0, parseFailed: 0, backups: 0 });
  return {
    ok: summary.bad === 0,
    checkedAt: new Date().toISOString(),
    backupCorrupt: !!options.backupCorrupt,
    summary,
    files,
  };
}

module.exports = { 检查, 默认文件 };