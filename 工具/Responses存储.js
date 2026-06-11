const fs = require('fs');
const path = require('path');

const 文件路径 = path.join(__dirname, '..', '响应历史.jsonl');
const 内存 = new Map();
const 最大内存 = 200;

function 追加记录(record) {
  const item = { ...record, savedAt: new Date().toISOString() };
  内存.set(item.id, item);
  while (内存.size > 最大内存) 内存.delete(内存.keys().next().value);
  try { fs.appendFileSync(文件路径, JSON.stringify(item) + '\n'); } catch {}
  return item;
}

function 从文件查找(id) {
  try {
    if (!fs.existsSync(文件路径)) return null;
    const lines = fs.readFileSync(文件路径, 'utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && obj.id === id) return obj.deleted ? { deleted: true, id } : obj;
      } catch {}
    }
  } catch {}
  return null;
}

function 获取(id) {
  if (内存.has(id)) return 内存.get(id);
  const found = 从文件查找(id);
  if (found && !found.deleted) 内存.set(id, found);
  return found;
}

function 删除(id) {
  内存.delete(id);
  const item = { id, deleted: true, deletedAt: new Date().toISOString() };
  try { fs.appendFileSync(文件路径, JSON.stringify(item) + '\n'); } catch {}
  return { id, object: 'response.deleted', deleted: true };
}

function 输出项转Chat消息(item) {
  if (!item || typeof item !== 'object') return [];
  if (item.type === 'message') {
    const parts = Array.isArray(item.content) ? item.content : [];
    const text = parts.map(p => {
      if (!p || typeof p !== 'object') return '';
      if (p.type === 'output_text' || p.type === 'text') return p.text || '';
      if (p.type === 'refusal') return p.refusal || '';
      return p.text || '';
    }).filter(Boolean).join('\n');
    return text ? [{ role: item.role || 'assistant', content: text }] : [];
  }
  if (item.type === 'function_call') {
    return [{
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: item.call_id || item.id,
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '' },
      }],
    }];
  }
  return [];
}

function 响应转Chat消息(response) {
  if (!response || response.deleted) return [];
  const output = Array.isArray(response.output) ? response.output : [];
  return output.flatMap(输出项转Chat消息);
}

function 构建上下文链(previousId, maxDepth = 20) {
  const chain = [];
  const seen = new Set();
  let id = previousId;
  let depth = 0;
  while (id && depth < maxDepth && !seen.has(id)) {
    seen.add(id);
    const r = 获取(id);
    if (!r || r.deleted) break;
    chain.unshift(r);
    id = r.previous_response_id;
    depth++;
  }
  return chain.flatMap(响应转Chat消息);
}

function 状态() {
  let lines = 0;
  let size = 0;
  try {
    if (fs.existsSync(文件路径)) {
      const st = fs.statSync(文件路径);
      size = st.size;
      lines = fs.readFileSync(文件路径, 'utf8').split(/\r?\n/).filter(Boolean).length;
    }
  } catch {}
  return { file: 文件路径, memory: 内存.size, records: lines, size };
}

module.exports = { 追加记录, 获取, 删除, 状态, 输出项转Chat消息, 响应转Chat消息, 构建上下文链 };