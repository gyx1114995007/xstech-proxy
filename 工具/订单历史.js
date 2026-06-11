const fs = require('fs');
const path = require('path');

const 文件路径 = path.join(__dirname, '..', '订单历史.jsonl');

function 追加记录(event) {
  const row = {
    time: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(文件路径, JSON.stringify(row) + '\n', 'utf-8');
  return row;
}

function 读取最近(limit = 50) {
  limit = Math.max(1, Math.min(500, Number(limit) || 50));
  if (!fs.existsSync(文件路径)) return [];
  const lines = fs.readFileSync(文件路径, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map(line => {
    try { return JSON.parse(line); }
    catch { return { raw: line }; }
  }).reverse();
}

function 获取状态() {
  let size = 0;
  let exists = false;
  try {
    if (fs.existsSync(文件路径)) {
      exists = true;
      size = fs.statSync(文件路径).size;
    }
  } catch {}
  return {
    file: path.basename(文件路径),
    path: 文件路径,
    exists,
    size,
  };
}

module.exports = {
  追加记录,
  读取最近,
  获取状态,
};
