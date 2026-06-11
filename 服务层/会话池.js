const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const 内存锁 = require('../工具/内存锁');
const 账号池 = require('./账号池');
const 请求转发 = require('./请求转发');
const fs = require('fs');
const path = require('path');

const 默认模型 = 'openai::gpt-5.5';
const 默认账号 = 'acc_0';
const 文件路径 = path.join(__dirname, '..', 配置.会话池.文件路径);
const 默认参数 = 配置.会话池.默认配置;
const 池大小下限 = Math.max(1, 配置.会话池.池大小下限 || 50);
const 池大小上限 = Math.max(池大小下限, 配置.会话池.池大小上限 || 1000);

const 池 = {};
const 账号状态 = {};

class 包装会话 {
  constructor(id, model) {
    this.id = id;
    this.model = model;
    this.used = false;
    this.获取时间 = Date.now();
  }
}

function 读文件() {
  try {
    if (!fs.existsSync(文件路径)) return { 账号会话: {} };
    return JSON.parse(fs.readFileSync(文件路径, 'utf-8'));
  } catch {
    return { 账号会话: {} };
  }
}

function 写文件(data) {
  try { fs.writeFileSync(文件路径, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (err) { 日志.error('会话池', '写文件失败: ' + err.message); }
}

function 确保账号(accountKey = 默认账号) {
  const key = accountKey || 默认账号;
  if (!池[key]) 池[key] = {};
  if (!账号状态[key]) 账号状态[key] = { 当前池大小上限: 池大小下限 };
  return key;
}

function 锁名(accountKey, sessionId) {
  return 'session-' + accountKey + '-' + sessionId;
}

function 总数(accountKey) {
  if (accountKey) {
    const key = 确保账号(accountKey);
    let n = 0;
    for (const list of Object.values(池[key])) n += list.length;
    return n;
  }
  let n = 0;
  for (const key of Object.keys(池)) n += 总数(key);
  return n;
}

function 获取空闲会话数(accountKey, model) {
  const key = 确保账号(accountKey);
  const entries = model ? [[model, 池[key][model] || []]] : Object.entries(池[key]);
  let n = 0;
  for (const [, list] of entries) {
    for (const s of list) {
      if (!s.used && !内存锁.isLocked(锁名(key, s.id))) n++;
    }
  }
  return n;
}

function 获取池状态(accountKey, model) {
  const key = 确保账号(accountKey);
  return {
    accountKey: key,
    总数: 总数(key),
    空闲数: 获取空闲会话数(key, model),
    当前上限: 账号状态[key].当前池大小上限,
    最低上限: 池大小下限,
    最高上限: 池大小上限,
  };
}

function 尝试扩容池上限(accountKey, 原因 = '') {
  const key = 确保账号(accountKey);
  const total = 总数(key);
  const state = 账号状态[key];
  if (total < state.当前池大小上限 || state.当前池大小上限 >= 池大小上限) return false;
  const old = state.当前池大小上限;
  state.当前池大小上限 = Math.min(池大小上限, Math.max(total + 1, Math.ceil(state.当前池大小上限 * 1.2)));
  日志.info('会话池', '[' + key + '] 动态扩容上限: ' + old + ' → ' + state.当前池大小上限 + (原因 ? ' (' + 原因 + ')' : ''));
  return state.当前池大小上限 > old;
}

async function 创建新会话(accountKey, model) {
  const key = 确保账号(accountKey);
  const m = model || 默认模型;
  const obj = await 账号池.带Token重试(key, token => 请求转发.创建会话(token, m));
  try { await 账号池.带Token重试(key, token => 请求转发.更新会话(token, { ...obj, ...默认参数, model: m })); }
  catch (err) { 日志.warn('会话池', '[' + key + '] 默认配置应用失败: ' + err.message); }
  日志.info('会话池', '[' + key + '] 新会话: id=' + obj.id + ' model=' + m);
  return new 包装会话(obj.id, m);
}

async function 持久化() {
  const 文件数据 = 读文件();
  const 结果 = {};
  for (const [accountKey, models] of Object.entries(池)) {
    结果[accountKey] = {};
    for (const [模型, list] of Object.entries(models)) {
      结果[accountKey][模型] = list.map(s => ({ id: s.id, 创建时间: s.获取时间 }));
    }
  }
  文件数据.账号会话 = 结果;
  delete 文件数据.会话;
  写文件(文件数据);
}

async function 初始化() {
  const 文件数据 = 读文件();
  let 所有账号会话 = 文件数据.账号会话 || null;
  if (!所有账号会话 && 文件数据.会话) {
    所有账号会话 = { [默认账号]: 文件数据.会话 };
    日志.warn('会话池', '检测到旧版会话池文件，已迁移到 ' + 默认账号);
  }
  所有账号会话 = 所有账号会话 || {};

  let 恢复数 = 0;
  for (const [accountKey, models] of Object.entries(所有账号会话)) {
    const key = 确保账号(accountKey);
    for (const [模型, 列表] of Object.entries(models || {})) {
      池[key][模型] = 池[key][模型] || [];
      for (const { id, 创建时间 } of 列表 || []) {
        const s = new 包装会话(id, 模型);
        if (创建时间) s.获取时间 = 创建时间;
        池[key][模型].push(s);
        恢复数++;
      }
    }
    账号状态[key].当前池大小上限 = Math.min(池大小上限, Math.max(池大小下限, 总数(key)));
  }

  日志.info('会话池', '从文件恢复 ' + 恢复数 + ' 个会话，账号数 ' + Object.keys(池).length);
  if (恢复数 === 0) {
    const accounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [{ key: 默认账号 }];
    for (const acc of accounts) 确保账号(acc.key);
    await 持久化();
  }
}

function 解析获取参数(a, b) {
  if (b === undefined) return { accountKey: 默认账号, model: a || 默认模型 };
  return { accountKey: a || 默认账号, model: b || 默认模型 };
}

async function 获取会话(a, b) {
  const { accountKey, model } = 解析获取参数(a, b);
  const key = 确保账号(accountKey);
  const m = model || 默认模型;
  池[key][m] = 池[key][m] || [];

  for (const s of 池[key][m]) {
    if (!s.used && 内存锁.acquire(锁名(key, s.id), 3600)) {
      s.used = true; s.获取时间 = Date.now();
      日志.info('会话池', '[' + key + '] 会话 ' + s.id + ' 已分配 (' + m + ')');
      return s;
    }
  }

  if (总数(key) >= 账号状态[key].当前池大小上限) {
    尝试扩容池上限(key, '无空闲会话');
  }

  if (总数(key) >= 账号状态[key].当前池大小上限) {
    for (const [其他模型, list] of Object.entries(池[key])) {
      for (const s of list) {
        if (!s.used && 内存锁.acquire(锁名(key, s.id), 3600)) {
          s.used = true; s.获取时间 = Date.now();
          if (其他模型 !== m) {
            try {
              await 账号池.带Token重试(key, token => 请求转发.更新会话(token, { id: s.id, model: m, ...默认参数 }));
              s.model = m;
              list.splice(list.indexOf(s), 1);
              池[key][m] = 池[key][m] || [];
              池[key][m].push(s);
              日志.info('会话池', '[' + key + '] 会话 ' + s.id + ' 模型切换: ' + 其他模型 + ' → ' + m);
              await 持久化();
            } catch (err) { 日志.warn('会话池', '[' + key + '] 模型切换失败: ' + (err.message || '')); }
          }
          return s;
        }
      }
    }
    throw new Error('会话池已满: ' + key);
  }

  const s = await 创建新会话(key, m);
  池[key][m].push(s);
  内存锁.acquire(锁名(key, s.id), 3600);
  s.used = true;
  await 持久化();
  return s;
}

function 解析归还参数(a, b, c, d) {
  if (d === undefined) return { accountKey: 默认账号, sessionId: a, model: b || 默认模型, 是否脏: !!c };
  return { accountKey: a || 默认账号, sessionId: b, model: c || 默认模型, 是否脏: !!d };
}

async function 归还会话(a, b, c, d) {
  const { accountKey, sessionId, model, 是否脏 } = 解析归还参数(a, b, c, d);
  const key = 确保账号(accountKey);
  const m = model || 默认模型;
  const list = 池[key][m];
  if (!list) return;
  const s = list.find(x => String(x.id) === String(sessionId));
  if (!s) return;

  if (是否脏) {
    try {
      await 账号池.带Token重试(key, token => 请求转发.更新会话(token, { id: s.id, model: s.model, ...默认参数 }));
      日志.info('会话池', '[' + key + '] 会话 ' + sessionId + ' 参数已重置为默认值');
    } catch (err) { 日志.warn('会话池', '[' + key + '] 重置参数失败: ' + err.message); }
  }

  s.used = false;
  内存锁.release(锁名(key, sessionId));
  日志.info('会话池', '[' + key + '] 会话 ' + sessionId + ' (' + s.model + ') 已归还' + (是否脏 ? ' [参数已重置]' : ' [无需操作]'));
  await 持久化();
}

function 从云端同步(a, b) {
  const accountKey = b === undefined ? 默认账号 : (a || 默认账号);
  const 云端会话列表 = b === undefined ? a : b;
  const key = 确保账号(accountKey);
  const 新池 = {};
  const 旧索引 = new Map();

  for (const [模型, list] of Object.entries(池[key])) {
    for (const s of list) 旧索引.set(String(s.id), s);
  }

  for (const item of 云端会话列表 || []) {
    if (!item || item.id === undefined || item.id === null) continue;
    const id = item.id;
    const model = item.model || item.tmpl || item.template || item.modelValue || 默认模型;
    const old = 旧索引.get(String(id));
    const s = old || new 包装会话(id, model);
    s.model = model;
    if (!old) s.used = false;
    新池[model] = 新池[model] || [];
    新池[model].push(s);
  }

  池[key] = 新池;
  账号状态[key].当前池大小上限 = Math.min(池大小上限, Math.max(池大小下限, 总数(key)));
  持久化();
  日志.info('会话池', '[' + key + '] 已按云端会话同步本地池，共 ' + 总数(key) + ' 个，当前动态上限 ' + 账号状态[key].当前池大小上限 + '/' + 池大小上限);
}

function 获取会话详情(accountKey, model, limit = 20) {
  limit = Math.max(1, Math.min(200, Number(limit || 20)));
  const keys = accountKey ? [确保账号(accountKey)] : (Object.keys(池).length ? Object.keys(池) : ((账号池.获取全部账号 ? 账号池.获取全部账号() : []).map(a => 确保账号(a.key))));
  const accounts = [];
  for (const key of keys) {
    const models = 池[key] || {};
    const state = 账号状态[key] || { 当前池大小上限: 池大小下限 };
    const byModel = [];
    let accountTotal = 0;
    let accountIdle = 0;
    let accountUsing = 0;
    for (const [模型, list] of Object.entries(models)) {
      if (model && 模型 !== model) continue;
      const sessions = (list || []).map(s => {
        const locked = 内存锁.isLocked(锁名(key, s.id));
        const using = !!s.used || locked;
        return {
          id: s.id,
          model: s.model || 模型,
          used: !!s.used,
          locked,
          idle: !using,
          acquiredAt: s.获取时间 ? new Date(s.获取时间).toISOString() : null,
          ageSec: s.获取时间 ? Math.max(0, Math.round((Date.now() - s.获取时间) / 1000)) : null,
        };
      });
      const total = sessions.length;
      const idle = sessions.filter(s => s.idle).length;
      const using = total - idle;
      accountTotal += total;
      accountIdle += idle;
      accountUsing += using;
      byModel.push({
        model: 模型,
        total,
        idle,
        using,
        latestAcquiredAt: sessions.reduce((max, s) => !max || (s.acquiredAt && s.acquiredAt > max) ? s.acquiredAt : max, null),
        sessions: sessions.slice(0, limit),
        truncated: Math.max(0, sessions.length - limit),
      });
    }
    byModel.sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
    accounts.push({
      accountKey: key,
      total: accountTotal,
      idle: accountIdle,
      using: accountUsing,
      currentLimit: state.当前池大小上限,
      minLimit: 池大小下限,
      maxLimit: 池大小上限,
      modelCount: byModel.length,
      byModel,
    });
  }
  const summary = accounts.reduce((acc, a) => {
    acc.total += a.total;
    acc.idle += a.idle;
    acc.using += a.using;
    acc.currentLimitTotal += a.currentLimit || 0;
    acc.minLimitTotal += a.minLimit || 0;
    acc.maxLimitTotal += a.maxLimit || 0;
    acc.accountCount += 1;
    acc.modelCount += a.modelCount || 0;
    return acc;
  }, { total: 0, idle: 0, using: 0, currentLimitTotal: 0, minLimitTotal: 0, maxLimitTotal: 0, accountCount: 0, modelCount: 0 });
  return {
    summary,
    filters: { accountKey: accountKey || '', model: model || '', limit },
    accounts,
  };
}

module.exports = {
  初始化,
  获取会话,
  归还会话,
  从云端同步,
  获取空闲会话数,
  获取池状态,
  获取会话详情,
};
