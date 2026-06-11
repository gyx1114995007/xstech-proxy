const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const 账号池 = require('./账号池');
const 请求转发 = require('./请求转发');
const 会话池 = require('./会话池');

function 时间值(r) {
  const v = r.updated || r.updateTime || r.updatedAt || r.created || r.createTime || r.createdAt || '';
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return t;
  const id = Number(r.id);
  return Number.isFinite(id) ? id : 0;
}

async function 获取全部云端会话(accountKey) {
  const all = [];
  let 页 = 1;
  while (true) {
    const data = await 账号池.带Token重试(accountKey, token => 请求转发.获取会话列表(token, 页));
    const records = Array.isArray(data.records) ? data.records : [];
    all.push(...records);
    const pages = Number(data.pages || 1);
    if (records.length < 30 || 页 >= pages) break;
    页++;
  }
  return all;
}
// token 获取与失效重试统一由 账号池.带Token重试 处理。


async function 删除云端会话(accountKey, list) {
  const ids = (list || [])
    .map(r => r && r.id)
    .filter(id => id !== undefined && id !== null);
  let 删除数 = 0;
  const 批大小 = 50;

  for (let i = 0; i < ids.length; i += 批大小) {
    const batch = ids.slice(i, i + 批大小);
    try {
      await 账号池.带Token重试(accountKey, token => 请求转发.批量删除会话(token, batch));
      删除数 += batch.length;
      日志.info('会话同步', '批量删除会话 ' + batch.length + ' 个，进度 ' + 删除数 + '/' + ids.length);
      await new Promise(res => setTimeout(res, 200));
    } catch (err) {
      日志.warn('会话同步', '批量删除失败，回退单个删除: ' + (err.message || ''));
      for (const id of batch) {
        try {
          await 账号池.带Token重试(accountKey, token => 请求转发.删除会话(token, id));
          删除数++;
          await new Promise(res => setTimeout(res, 80));
        } catch (e) {
          日志.warn('会话同步', '删除失败: ' + id + ' ' + (e.message || ''));
        }
      }
    }
  }

  return 删除数;
}

/**
 * 云端作为真实来源：
 * 1. 拉取全部云端会话
 * 2. 超过 CLOUD_SESSION_MAX / 配置.会话池.云端上限 时，保留较新的会话，删除多余旧会话
 * 3. 用保留下来的云端会话重建本地会话池
 */
async function 同步单账号(account) {
  const 上限 = 配置.会话池.云端上限 || 配置.会话池.池大小上限 || 1000;
  const 云端 = await 获取全部云端会话(account.key);
  const 排序 = 云端.slice().sort((a, b) => 时间值(b) - 时间值(a));
  const 保留 = 排序.slice(0, 上限);
  const 删除 = 排序.slice(上限);

  日志.info('会话同步', '[' + account.key + '] 云端会话 ' + 云端.length + ' 个，本地同步保留 ' + 保留.length + ' 个，上限 ' + 上限);

  let 删除数 = 0;
  if (删除.length > 0) {
    删除数 = await 删除云端会话(account.key, 删除);
    日志.warn('会话同步', '[' + account.key + '] 云端超限，已删除 ' + 删除数 + ' 个多余会话');
  }

  会话池.从云端同步(account.key, 保留);
  return { accountKey: account.key, total: 云端.length, kept: 保留.length, deleted: 删除数 };
}

async function 同步云端到本地() {
  const accounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [{ key: 'acc_0' }];
  const results = [];
  for (const account of accounts) {
    try {
      results.push(await 同步单账号(account));
    } catch (err) {
      日志.error('会话同步', '[' + account.key + '] 同步失败: ' + (err.message || err));
      results.push(null);
    }
  }
  return results;
}

let 定时器 = null;

function 启动() {
  if (定时器) clearInterval(定时器);
  const 间隔秒 = Math.max(60, Number(配置.会话池.同步间隔秒 || 1800));
  const 间隔 = 间隔秒 * 1000;
  日志.info('会话同步', '定时同步已启动，间隔 ' + (间隔 / 60000) + ' 分钟，云端上限 ' + (配置.会话池.云端上限 || 配置.会话池.池大小上限 || 1000));
  定时器 = setInterval(同步云端到本地, 间隔);
  if (typeof 定时器.unref === 'function') 定时器.unref();
}

function 重启定时同步() {
  启动();
  return { ok: true, intervalSec: Math.max(60, Number(配置.会话池.同步间隔秒 || 1800)) };
}

module.exports = { 启动, 重启定时同步, 同步云端到本地, 同步清理: 同步云端到本地 };
