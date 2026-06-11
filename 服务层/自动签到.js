
const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const 账号池 = require('./账号池');
const 请求转发 = require('./请求转发');

let 首次定时器 = null;
let 循环定时器 = null;

const 状态 = {
  启动: false,
  运行中: false,
  上次运行时间: null,
  下次运行时间: null,
  最近结果: [],
};

function 今天信息() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const ymd = String(y) + String(m).padStart(2, '0') + String(day).padStart(2, '0');
  return { year: y, month: m, ymd };
}

function 汇总积分计划(records = []) {
  let total = 0;
  let use = 0;
  let usable = 0;
  for (const p of records || []) {
    total += Number(p.total ?? p.integral ?? p.value ?? 0) || 0;
    use += Number(p.use ?? p.used ?? p.usedIntegral ?? p.consume ?? p.consumed ?? 0) || 0;
    usable += Number(p.usable ?? p.remain ?? p.remaining ?? p.balance ?? p.available ?? 0) || 0;
  }
  return { total, use, usable, count: records.length };
}

async function 获取账号积分摘要(accountKey) {
  const first = await 账号池.带Token重试(accountKey, token => 请求转发.获取用户积分计划(token, 1));
  const pages = Math.max(1, Number(first && first.pages || 1));
  const records = Array.isArray(first && first.records) ? first.records.slice() : [];
  for (let p = 2; p <= pages; p++) {
    const data = await 账号池.带Token重试(accountKey, token => 请求转发.获取用户积分计划(token, p));
    if (Array.isArray(data && data.records)) records.push(...data.records);
  }
  return {
    page: 1,
    pages,
    summary: 汇总积分计划(records),
  };
}

async function 安全获取积分摘要(accountKey) {
  try {
    return { ok: true, ...(await 获取账号积分摘要(accountKey)) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function 计算积分变化(before, after) {
  const b = before && before.ok ? before.summary || {} : {};
  const a = after && after.ok ? after.summary || {} : {};
  return {
    total: Number(a.total || 0) - Number(b.total || 0),
    use: Number(a.use || 0) - Number(b.use || 0),
    usable: Number(a.usable || 0) - Number(b.usable || 0),
  };
}

async function 签到单账号(accountKey) {
  const { year, month, ymd } = 今天信息();
  const beforeBalance = await 安全获取积分摘要(accountKey);
  const records = await 账号池.带Token重试(accountKey, token => 请求转发.获取签到记录(token, year, month));
  const 已签到 = Array.isArray(records) && records.some(r => String(r.ymd) === ymd);

  if (已签到) {
    const afterBalance = await 安全获取积分摘要(accountKey);
    const balanceChange = 计算积分变化(beforeBalance, afterBalance);
    日志.info('自动签到', '[' + accountKey + '] 今日已签到，跳过；当前可用积分 ' + (afterBalance.summary && afterBalance.summary.usable));
    return { accountKey, ok: true, skipped: true, ymd, beforeBalance, afterBalance, balanceChange };
  }

  const data = await 账号池.带Token重试(accountKey, token => 请求转发.签到打卡(token));
  const afterBalance = await 安全获取积分摘要(accountKey);
  const balanceChange = 计算积分变化(beforeBalance, afterBalance);
  日志.info('自动签到', '[' + accountKey + '] 签到成功，积分 +' + (data && data.integral !== undefined ? data.integral : '?') + '，可用积分变化 ' + balanceChange.usable);
  return { accountKey, ok: true, skipped: false, ymd, data, beforeBalance, afterBalance, balanceChange };
}

async function 执行签到() {
  if (状态.运行中) return { ok: false, skipped: true, reason: 'already_running' };
  状态.运行中 = true;
  状态.上次运行时间 = new Date().toISOString();

  const accounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [];
  const results = [];

  try {
    for (const acc of accounts) {
      try {
        results.push(await 签到单账号(acc.key));
      } catch (err) {
        日志.warn('自动签到', '[' + acc.key + '] 签到失败: ' + (err.message || err));
        results.push({ accountKey: acc.key, ok: false, error: err.message || String(err) });
      }
    }
    状态.最近结果 = results;
    return { ok: true, results };
  } finally {
    状态.运行中 = false;
  }
}

function 清理定时器() {
  if (首次定时器) clearTimeout(首次定时器);
  if (循环定时器) clearInterval(循环定时器);
  首次定时器 = null;
  循环定时器 = null;
}

function 启动() {
  清理定时器();

  const signConfig = 配置.自动签到 || {};
  const 启用 = signConfig.启用 !== false;
  const 间隔小时 = Math.max(1, Number(signConfig.间隔小时 || 24));
  const 初始延迟秒 = Math.max(0, Number(signConfig.初始延迟秒 === undefined ? 15 : signConfig.初始延迟秒));
  const 间隔 = 间隔小时 * 60 * 60 * 1000;

  状态.启动 = 启用;

  if (!启用) {
    状态.下次运行时间 = null;
    日志.warn('自动签到', '自动签到已禁用');
    return;
  }

  const 安排下次 = () => {
    状态.下次运行时间 = new Date(Date.now() + 间隔).toISOString();
  };

  首次定时器 = setTimeout(() => {
    执行签到().finally(安排下次);
  }, 初始延迟秒 * 1000);
  if (typeof 首次定时器.unref === 'function') 首次定时器.unref();

  循环定时器 = setInterval(() => {
    执行签到().finally(安排下次);
  }, 间隔);
  if (typeof 循环定时器.unref === 'function') 循环定时器.unref();

  状态.下次运行时间 = new Date(Date.now() + 初始延迟秒 * 1000).toISOString();
  日志.info('自动签到', '自动签到已启动：启动后 ' + 初始延迟秒 + ' 秒执行一次，之后每 ' + 间隔小时 + ' 小时检查一次');
}

function 重启() {
  启动();
  const signConfig = 配置.自动签到 || {};
  return {
    ok: true,
    enabled: signConfig.启用 !== false,
    intervalHours: Math.max(1, Number(signConfig.间隔小时 || 24)),
    initialDelaySec: Math.max(0, Number(signConfig.初始延迟秒 === undefined ? 15 : signConfig.初始延迟秒)),
  };
}

function 获取状态() {
  return {
    启动: 状态.启动,
    运行中: 状态.运行中,
    上次运行时间: 状态.上次运行时间,
    下次运行时间: 状态.下次运行时间,
    最近结果: 状态.最近结果,
  };
}

module.exports = { 启动, 重启, 执行签到, 获取状态 };
