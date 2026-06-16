const 日志 = require('./日志');
const 请求转发 = require('../服务层/请求转发');
const 会话池 = require('../服务层/会话池');
const 账号池 = require('../服务层/账号池');
const 配置 = require('../启动/配置');
const 模型映射 = require('../服务层/模型映射');
const fs = require('fs');
const path = require('path');

const 规则文件 = path.join(__dirname, '..', '误判词.json');
const ZWS = '\u200B';

let 规则表 = {};

let 当前探测并发 = 0;
const 探测等待队列 = [];

function 计算探测并发上限(accountKey, model) {
  const 当前账号状态 = 会话池.获取池状态 ? 会话池.获取池状态(accountKey, model) : { 空闲数: 0, 总数: 0 };
  let 全局空闲数 = 0;
  let 全局总数 = 0;
  try {
    const accounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [{ key: accountKey || 'acc_0' }];
    for (const acc of accounts) {
      const st = 会话池.获取池状态 ? 会话池.获取池状态(acc.key, model) : { 空闲数: 0, 总数: 0 };
      全局空闲数 += st.空闲数 || 0;
      全局总数 += st.总数 || 0;
    }
  } catch {
    全局空闲数 = 当前账号状态.空闲数 || 0;
    全局总数 = 当前账号状态.总数 || 0;
  }
  // 空闲为 0 时仍放行 1 个探测，让被选账号的会话池.获取会话() 有机会触发动态扩容。
  const 上限 = 全局空闲数 > 0 ? Math.max(1, Math.floor(全局空闲数 * 0.5)) : 1;
  return {
    上限,
    状态: {
      ...当前账号状态,
      全局空闲数,
      全局总数,
    },
  };
}

function 调度探测队列() {
  for (let i = 0; i < 探测等待队列.length; i++) {
    const item = 探测等待队列[i];
    const { 上限 } = 计算探测并发上限(item.accountKey, item.model);
    if (当前探测并发 >= 上限) continue;
    探测等待队列.splice(i, 1);
    当前探测并发++;
    item.resolve();
    i--;
  }
}

function 获取探测槽(accountKey, model) {
  const { 上限 } = 计算探测并发上限(accountKey, model);
  if (当前探测并发 < 上限) {
    当前探测并发++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    探测等待队列.push({ accountKey, model, resolve });
  });
}

function 释放探测槽() {
  当前探测并发 = Math.max(0, 当前探测并发 - 1);
  调度探测队列();
}

async function 限流探测(accountKey, model, fn) {
  await 获取探测槽(accountKey, model);
  try {
    return await fn();
  } finally {
    释放探测槽();
  }
}

function 加载规则() {
  try { if (fs.existsSync(规则文件)) 规则表 = JSON.parse(fs.readFileSync(规则文件, 'utf-8')).词表 || {}; }
  catch {}
}
function 保存规则() {
  try { fs.writeFileSync(规则文件, JSON.stringify({ 词表: 规则表 }, null, 2), 'utf-8'); } catch {}
}
function 重载规则() {
  规则表 = {};
  加载规则();
  return 获取探测状态();
}
function 规避(词) {
  let r = '';
  for (let i = 0; i < 词.length; i++) {
    r += 词[i];
    if (i < 词.length - 1 && 词[i].trim() && 词[i+1].trim()) r += ZWS;
  }
  return r;
}
function 预替换(text) {
  let r = text;
  for (const [词, 替换为] of Object.entries(规则表)) {
    if (r.includes(词)) r = r.split(词).join(替换为);
  }
  return r;
}

async function 被拦(_token, model, text, accountKey) {
  const 探测模型配置 = 配置.误判检测探测模型 || model;
  // 转换为内部模型ID（支持对外名称如 glm-5-1 → 国产::GLM-5.1）
  const 探测模型 = 模型映射.toXstechModel(探测模型配置) || 探测模型配置;
  const 探测账号 = accountKey
    ? { key: accountKey }
    : await 账号池.选择账号();
  const 探测账号Key = 探测账号.key;

  return 限流探测(探测账号Key, 探测模型, async () => {
    let sid = null;
    try {
      const 会话 = await 会话池.获取会话(探测账号Key, 探测模型);
      sid = 会话.id;
      const response = await 账号池.带Token重试(探测账号Key, token => 请求转发.对话补全(token, { text: '探测:' + text, sessionId: sid }));
      const 并发状态 = 计算探测并发上限(探测账号Key, 探测模型);
      日志.记录误判('[探测] model=' + 探测模型 + ' account=' + 探测账号Key + ' sid=' + sid + ' text=' + text.slice(0, 40) + ' 并发=' + 当前探测并发 + '/' + 并发状态.上限 + ' 当前账号空闲=' + 并发状态.状态.空闲数 + ' 全局空闲=' + 并发状态.状态.全局空闲数 + ' 当前池=' + 并发状态.状态.总数 + '/' + 并发状态.状态.当前上限 + '/' + 并发状态.状态.最高上限 + ' 全局池=' + 并发状态.状态.全局总数);
      return new Promise((resolve) => {
        let resolved = false, buffer = '', 已拦截 = false, 所有响应 = '';
        const done = (r) => { if (resolved) return; resolved = true; response.data.removeAllListeners(); 日志.记录误判('[探测结果] model=' + 探测模型 + ' account=' + 探测账号Key + ' ' + (r ? '被拦' : '通过') + ' 响应=' + 所有响应.slice(0, 100) + ' text=' + text.slice(0, 30)); resolve(r); };
        const timer = setTimeout(() => done(已拦截), 10000);
        response.data.on('data', (c) => {
          buffer += c.toString('utf-8');
          while (buffer.indexOf('\n') >= 0) {
            const idx = buffer.indexOf('\n'), line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1);
            if (!line || !line.startsWith('data:')) continue;
            const ds = line.slice(5).trim();
            if (ds === '[DONE]') { clearTimeout(timer); done(已拦截); return; }
            try { 
              const obj = JSON.parse(ds); 
              所有响应 += JSON.stringify(obj) + ' ';
              if (obj.code !== undefined && obj.err) {
                if (obj.err.includes('不允许的文本') || obj.err.includes('包含不允许的文本')) {
                  已拦截 = true;
                }
              }
            } catch {}
          }
        });
        response.data.on('end', () => { clearTimeout(timer); if (!resolved) done(已拦截); });
        response.data.on('error', (err) => { 
          所有响应 += 'stream_error:' + (err.message || '');
          clearTimeout(timer); 
          done(false);
        });
      });
    } catch (e) { 
      日志.记录误判('[探测异常] model=' + 探测模型 + ' account=' + 探测账号Key + ' ' + e.message); 
      return false;
    }
    finally { if (sid) { try { await 会话池.归还会话(探测账号Key, sid, 探测模型); } catch {} } }
  });
}

async function 重叠分段检测(token, model, text, accountKey) {
  const len = text.length;
  let 段数 = 4; if (len > 500) 段数 = 8; if (len > 2000) 段数 = 16;
  const 基本段 = Math.ceil(len / 段数), 重叠 = Math.ceil(基本段 * 0.1);
  const 段落列表 = [];
  for (let i = 0; i < 段数; i++) {
    const start = Math.max(0, i * 基本段 - (i > 0 ? 重叠 : 0));
    const end = Math.min(len, (i + 1) * 基本段 + (i < 段数 - 1 ? 重叠 : 0));
    if (start >= len) break;
    段落列表.push({ start, end, text: text.slice(start, end) });
  }
  const results = await Promise.all(段落列表.map(async p => ({ ...p, 被拦: await 被拦(token, model, p.text, accountKey) })));
  return results.filter(r => r.被拦);
}

async function 细分段检测(token, model, 父段, text, accountKey) {
  const 子段数 = 4, 基本段 = Math.ceil(父段.length / 子段数), 重叠 = Math.ceil(基本段 * 0.15);
  const base = 父段.start, 段落列表 = [];
  for (let i = 0; i < 子段数; i++) {
    const start = i * 基本段, end = Math.min(父段.length, (i + 1) * 基本段 + (i < 子段数 - 1 ? 重叠 : 0));
    if (start >= 父段.length) break;
    段落列表.push({ start: base + start, end: base + end, text: text.slice(base + start, base + end) });
  }
  const results = await Promise.all(段落列表.map(async p => ({ ...p, 被拦: await 被拦(token, model, p.text, accountKey) })));
  return results.filter(r => r.被拦);
}

async function 句级检测(token, model, text, accountKey) {
  const sentences = text.split(/[。！？\n，,;；.]/).filter(s => s.trim().length >= 3);
  if (sentences.length === 0) return [];
  const results = await Promise.all(sentences.map(async s => ({ text: s.trim(), 被拦: await 被拦(token, model, s.trim(), accountKey) })));
  return results.filter(r => r.被拦);
}

// 🔑 第4级：token化+双字组合+逐字精确定位
async function 词级检测(token, model, text, accountKey) {
  const tokens = [];
  let buf = '';
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (/[\w]/.test(ch)) { buf += ch; }
    else { if (buf) { tokens.push(buf); buf = ''; } }
  }
  if (buf) tokens.push(buf);
  日志.记录误判('词级token: ' + tokens.join('|'));
  if (tokens.length === 0) return null;

  // 逐双字组合
  const 组合列表 = [];
  for (let i = 0; i < tokens.length - 1; i++) 组合列表.push(tokens[i] + tokens[i+1]);
  const 候选 = 组合列表.filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 20);

  for (let i = 0; i < 候选.length; i += 100) {
    const batch = 候选.slice(i, i + 100);
    const results = await Promise.all(batch.map(async w => ({ word: w, 被拦: await 被拦(token, model, w, accountKey) })));
    const found = results.find(r => r.被拦);
    if (found) {
      日志.记录误判('双字组合被拦: ' + found.word);
      // 进一步逐token探测（并行）
      const t0 = found.word.slice(0, Math.ceil(found.word.length / 2));
      const t1 = found.word.slice(Math.ceil(found.word.length / 2));
      const [r0, r1] = await Promise.all([被拦(token, model, t0, accountKey), 被拦(token, model, t1, accountKey)]);
      if (r0 && r1) return found.word;
      if (r0) return t0;
      if (r1) return t1;
      return found.word;
    }
  }
  return null;
}

function 规避全文(text) {
  return text.replace(/([\u4e00-\u9fff\w]{2,15})/g, (m) => {
    if (m.length < 2) return m;
    let r = '';
    for (let i = 0; i < m.length; i++) { r += m[i]; if (i < m.length - 1) r += ZWS; }
    return r;
  });
}

async function 检测并修复(text, token, model, accountKey) {
  const fixed = 预替换(text);
  if (fixed !== text) { 日志.info('误判检测', '已知规则覆盖'); return fixed; }
  日志.info('误判检测', '多级递进检测..');
  日志.记录误判('=== 多级检测 === (总长=' + text.length + ')');

  let 问题段 = await 重叠分段检测(token, model, text, accountKey);
  if (问题段.length === 0) {
    日志.记录误判('第1级未发现问题段，尝试合并回退');
    const 合并段 = [];
    const 段数 = text.length > 2000 ? 16 : (text.length > 500 ? 8 : 4);
    const 基本段 = Math.ceil(text.length / 段数);
    for (let i = 0; i < 段数; i += 2) {
      const start = i * 基本段, end = Math.min(text.length, (i + 2) * 基本段);
      if (start >= text.length) break;
      合并段.push({ start, end, text: text.slice(start, end) });
    }
    const 合并结果 = await Promise.all(合并段.map(async p => ({ ...p, 被拦: await 被拦(token, model, p.text, accountKey) })));
    问题段 = 合并结果.filter(r => r.被拦);
    if (问题段.length === 0) {
      日志.记录误判('合并回退仍未找到，尝试全文规避');
      const ft = 规避全文(text);
      if (!(await 被拦(token, model, ft, accountKey))) { 日志.记录误判('全文规避通过！'); 日志.info('误判检测', '全文规避成功'); return ft; }
      日志.记录误判('无法修复'); return null;
    }
  }

  let 细问题段 = [];
  const 细分结果 = await Promise.all(问题段.map(p => 细分段检测(token, model, { start: p.start, end: p.end, length: p.text.length }, text, accountKey)));
  for (const sub of 细分结果) 细问题段.push(...sub);
  if (细问题段.length === 0) 细问题段 = 问题段;

  let merged = '';
  for (const p of 细问题段) merged += ' ' + (p.text || text.slice(p.start, p.end));
  merged = merged.trim();

  const 问题句 = await 句级检测(token, model, merged, accountKey);
  let target = merged;
  if (问题句.length > 0) target = 问题句.map(s => s.text).join(' ');

  const word = await 词级检测(token, model, target, accountKey);
  日志.记录误判('第4级结果: 词=' + (word || ''));
  if (word) {
    const rep = 规避(word);
    规则表[word] = rep; 保存规则();
    日志.info('误判检测', '已记录规则: "' + word + '"');
    日志.记录误判('规则保存: "' + word + '"');
    return text.split(word).join(rep);
  }
  日志.记录误判('未找到精确误判词'); return null;
}

function 获取探测状态() {
  let 并发上限 = 1;
  let 全局空闲数 = 0;
  let 全局总数 = 0;
  try {
    const accounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [{ key: 'acc_0' }];
    const first = accounts[0] && accounts[0].key;
    const r = 计算探测并发上限(first);
    并发上限 = r.上限;
    全局空闲数 = r.状态.全局空闲数 || 0;
    全局总数 = r.状态.全局总数 || 0;
  } catch {}
  return {
    当前探测并发,
    探测等待队列长度: 探测等待队列.length,
    全局探测并发上限: 并发上限,
    全局空闲会话数: 全局空闲数,
    全局会话数: 全局总数,
    并发策略: 'floor(全账号空闲会话数 * 0.5)，全局空闲为0时放行1个探测',
    规则数量: Object.keys(规则表 || {}).length,
  };
}

加载规则();
module.exports = { 预替换, 检测并修复, 获取探测状态, 重载规则 };
