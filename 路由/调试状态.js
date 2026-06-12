
const express = require('express');
const fs = require('fs');
const path = require('path');
const 配置 = require('../启动/配置');

const 账号池 = require('../服务层/账号池');
const 会话池 = require('../服务层/会话池');
const 误判检测 = require('../工具/误判检测');
const 运行指标 = require('../工具/运行指标');
const 模型映射 = require('../服务层/模型映射');
const 会话同步 = require('../服务层/会话同步');
const OpenAI错误 = require('../工具/OpenAI错误');
const 日志 = require('../工具/日志');
const 模型流错误分类 = require('../工具/模型流错误分类');


const 自动签到 = require('../服务层/自动签到');
const 请求转发 = require('../服务层/请求转发');
const 运行配置 = require('../服务层/运行配置');
const 企业微信通知 = require('../服务层/企业微信通知');
const 事件中心 = require('../工具/事件中心');
const 订单历史 = require('../工具/订单历史');
const 上游诊断 = require('../工具/上游诊断');
const 数据文件健康 = require('../工具/数据文件健康');
const 部署诊断 = require('../工具/部署诊断');


const router = express.Router();

const 启动时间 = Date.now();

function 脱敏账号(account) {
  if (!account || typeof account !== 'string') return '';
  const at = account.indexOf('@');
  if (at > 1) {
    const name = account.slice(0, at);
    const domain = account.slice(at);
    return name.slice(0, Math.min(3, name.length)) + '***' + domain;
  }
  if (account.length <= 4) return '***';
  return account.slice(0, 3) + '***' + account.slice(-2);
}

function 脱敏错误摘要(err) {
  const upstream = err && err.upstream;
  return {
    name: err && err.name,
    message: err && err.message,
    code: err && err.code,
    status: err && (err.status || err.statusCode || (err.response && err.response.status)),
    upstream: upstream === undefined ? undefined : upstream,
    axiosCode: err && err.isAxiosError ? err.code : undefined,
    causeCode: err && err.cause && err.cause.code,
  };
}

function 时间字符串FromExp(exp) {
  if (!exp) return null;
  try { return new Date(exp * 1000).toISOString(); }
  catch { return null; }
}

function token剩余秒(exp) {
  if (!exp) return null;
  return exp - Math.floor(Date.now() / 1000);
}

function 汇总会话(accounts) {
  const summary = {
    total: 0,
    idle: 0,
    currentLimitTotal: 0,
    minLimitTotal: 0,
    maxLimitTotal: 0,
  };
  for (const acc of accounts) {
    const st = acc.sessions || {};
    summary.total += st.total || 0;
    summary.idle += st.idle || 0;
    summary.currentLimitTotal += st.currentLimit || 0;
    summary.minLimitTotal += st.minLimit || 0;
    summary.maxLimitTotal += st.maxLimit || 0;
  }
  return summary;
}

const 备份文件列表 = [
  '账号列表.json',
  '账号token.json',
  '会话池.json',
  '模型映射.json',
  '模型价格.json',
  '运行配置.json',
  '误判词.json',
  '模型流错误规则.json',
  '未分类模型流错误样例.json',
  '项目进度.md',
];

function 安全备份文件名(name) {
  name = String(name || '');
  if (!备份文件列表.includes(name)) return null;
  return name;
}

function 备份文件路径(name) {
  return path.join(__dirname, '..', name);
}

function 获取备份文件信息(name) {
  const file = 备份文件路径(name);
  if (!fs.existsSync(file)) {
    return { name, exists: false, size: 0, updatedAt: null };
  }
  const st = fs.statSync(file);
  return {
    name,
    exists: true,
    size: st.size,
    updatedAt: st.mtime.toISOString(),
  };
}

function 读取备份文件(name) {
const file = 备份文件路径(name);
if (!fs.existsSync(file)) return null;
const text = fs.readFileSync(file, 'utf-8');
let json = null;
try { json = JSON.parse(text); } catch {}
return {
...获取备份文件信息(name),
type: json ? 'json' : 'text',
json,
text: json ? undefined : text,
};
}

function 从备份项提取文本(item) {
if (!item || typeof item !== 'object') return null;
if (item.type === 'json' || item.json !== undefined) return JSON.stringify(item.json, null, 2);
if (item.text !== undefined) return String(item.text);
return null;
}

function 解析备份包(input) {
if (typeof input === 'string') return JSON.parse(input);
return input;
}

function 生成恢复预览(backup, selectedFiles) {
backup = 解析备份包(backup);
const files = backup && backup.files && typeof backup.files === 'object' ? backup.files : {};
const selected = Array.isArray(selectedFiles) && selectedFiles.length ? selectedFiles : Object.keys(files);
return selected.map(name => {
const safe = 安全备份文件名(name);
const item = safe ? files[safe] : null;
const nextText = 从备份项提取文本(item);
const current = safe ? 读取备份文件(safe) : null;
const currentText = current ? (current.type === 'json' ? JSON.stringify(current.json, null, 2) : current.text) : null;
return {
name,
allowed: !!safe,
inBackup: !!item,
canRestore: !!safe && !!item && nextText !== null,
currentExists: !!current,
currentSize: current ? current.size : 0,
backupType: item ? item.type : null,
changed: nextText !== currentText,
currentPreview: currentText ? currentText.slice(0, 500) : '',
backupPreview: nextText ? nextText.slice(0, 500) : '',
};
});
}

function 执行选择性恢复(backup, selectedFiles) {
backup = 解析备份包(backup);
const files = backup && backup.files && typeof backup.files === 'object' ? backup.files : {};
if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) throw new Error('必须指定要恢复的 files 数组');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const restored = [];
for (const name of selectedFiles) {
const safe = 安全备份文件名(name);
if (!safe) throw new Error('不允许恢复该文件: ' + name);
const item = files[safe];
const nextText = 从备份项提取文本(item);
if (nextText === null) throw new Error('备份包中缺少有效内容: ' + safe);
const file = 备份文件路径(safe);
let backupPath = null;
if (fs.existsSync(file)) {
backupPath = file + '.restore-backup-' + ts;
fs.copyFileSync(file, backupPath);
}
fs.writeFileSync(file, nextText, 'utf-8');
restored.push({ name: safe, backupPath, size: Buffer.byteLength(nextText) });
}
return restored;
}

function 找最新运行日志文件() {
  const root = path.join(__dirname, '..', 'logs', '运行');
  if (!fs.existsSync(root)) return null;
  const files = [];
  const days = fs.readdirSync(root).sort().reverse();
  for (const day of days) {
    const dir = path.join(root, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.includes('runtime') && f.endsWith('.log')) files.push(path.join(dir, f));
    }
    if (files.length) break;
  }
  return files.sort().reverse()[0] || null;
}

function 读取最近日志(lines = 200, filters = {}) {
lines = Math.max(1, Math.min(5000, Number(lines || 200)));
const file = 找最新运行日志文件();
if (!file) return { file: null, lines: [], filters: { lines, ...filters } };

const level = String(filters.level || '').trim().toUpperCase();
const keyword = String(filters.keyword || '').trim().toLowerCase();

let all = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);

if (level && level !== 'ALL') {
all = all.filter(line => line.includes('[' + level.padEnd(5) + ']') || line.includes('[' + level + ']'));
}

if (keyword) {
all = all.filter(line => line.toLowerCase().includes(keyword));
}

return {
file: path.relative(path.join(__dirname, '..'), file),
filters: { lines, level: level || 'ALL', keyword },
totalMatched: all.length,
lines: all.slice(-lines),
};
}

router.get('/status', async (_req, res) => {
const rawAccounts = 账号池.获取全部账号 ? 账号池.获取全部账号() : [];
  const accounts = rawAccounts.map(acc => {
    const st = 会话池.获取池状态 ? 会话池.获取池状态(acc.key) : {};
    const left = token剩余秒(acc.exp);
    return {
      key: acc.key,
      index: acc.index,
      account: 脱敏账号(acc.account),
      token: {
        valid: !!acc.token有效,
        exp: acc.exp || 0,
        expireAt: 时间字符串FromExp(acc.exp),
        leftSec: left,
      },

      usageCount: acc.使用次数 || 0,
enabled: acc.enabled !== false,
loggingIn: !!acc.登录中,
health: acc.health || null,
sessions: {

        total: st.总数 || 0,
        idle: st.空闲数 || 0,
        currentLimit: st.当前上限 || 0,
        minLimit: st.最低上限 || 0,
        maxLimit: st.最高上限 || 0,
      },
    };
  });

  const censor = 误判检测.获取探测状态 ? 误判检测.获取探测状态() : null;

  res.json({
    ok: true,
    service: {
      uptimeSec: Math.floor((Date.now() - 启动时间) / 1000),
      startedAt: new Date(启动时间).toISOString(),
      now: new Date().toISOString(),
      pid: process.pid,
      node: process.version,
    },
    config: {
      host: 配置.主机,
      port: 配置.端口,
      sessionPoolMin: 配置.会话池.池大小下限,
      sessionPoolMax: 配置.会话池.池大小上限,
      cloudSessionMax: 配置.会话池.云端上限,
      sessionSyncIntervalSec: 配置.会话池.同步间隔秒,
      tokenRefreshBeforeSec: 配置.token提前刷新秒,
      tokenRefreshCheckIntervalSec: 配置.token刷新检查间隔秒,
      logLevel: 配置.日志级别,
    },
    accounts,
    sessionSummary: 汇总会话(accounts),
    modelMapping: 模型映射.获取状态 ? 模型映射.获取状态() : null,

    autoSign: 自动签到.获取状态 ? 自动签到.获取状态() : null,

    notify: 企业微信通知.获取状态 ? 企业微信通知.获取状态() : null,
    events: 事件中心.获取状态 ? 事件中心.获取状态() : null,
    censor,

    metrics: 运行指标.获取指标(),
  });
});

router.get('/metrics/trend', async (req, res) => {
try {
const hours = Number(req.query.hours || 24);
res.json({
ok: true,
action: 'metrics-trend',
trend: 运行指标.获取请求趋势 ? 运行指标.获取请求趋势(hours) : null,
});
} catch (err) {
OpenAI错误.返回错误(res, 500, {
message: err.message || '读取请求趋势失败',
type: 'server_error',
code: 'read_metrics_trend_failed',
detail: 脱敏错误摘要(err),
});
}
});

router.get('/upstream/diagnostics', async (req, res) => {
try {
const accountKey = String(req.query.accountKey || 'acc_0').trim();
const timeoutMs = Number(req.query.timeoutMs || 5000);
const result = await 上游诊断.诊断({ accountKey, timeoutMs });
事件中心.记录事件('upstream_diagnostics', '已执行上游网络诊断', {
ok: result.ok,
durationMs: result.durationMs,
base: result.base,
recommendation: result.recommendation,
checks: (result.checks || []).map(c => ({ name: c.name, ok: c.ok, durationMs: c.durationMs, status: c.status, error: c.error })),
}, result.ok ? 'INFO' : 'WARN');
res.json({ ok: true, action: 'upstream-diagnostics', result });
} catch (err) {
OpenAI错误.返回错误(res, 500, {
message: err.message || '执行上游网络诊断失败',
type: 'server_error',
code: 'upstream_diagnostics_failed',
detail: 脱敏错误摘要(err),
});
}
});

router.get('/billing/products', async (req, res) => {
  try {
    const accountKey = req.query.accountKey || 'acc_0';
    const data = await 账号池.带Token重试(accountKey, token => 请求转发.获取积分套餐商品(token));
    res.json({ ok: true, action: 'billing-products', accountKey, data });
  } catch (err) {
    OpenAI错误.返回错误(res, err.status || err.statusCode || 500, {
      message: err.message || '获取积分商品失败',
      type: 'server_error',
      code: 'billing_products_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

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

router.get('/billing/plans', async (req, res) => {
try {
const accountKey = req.query.accountKey || 'acc_0';
const page = Number(req.query.page || 1);
const all = String(req.query.all || '').toLowerCase() === 'true';

if (!all) {
const data = await 账号池.带Token重试(accountKey, token => 请求转发.获取用户积分计划(token, page));
const records = Array.isArray(data && data.records) ? data.records : [];
return res.json({ ok: true, action: 'billing-plans', accountKey, page, all: false, summary: 汇总积分计划(records), data });
}

const first = await 账号池.带Token重试(accountKey, token => 请求转发.获取用户积分计划(token, 1));
const pages = Math.max(1, Number(first && first.pages || 1));
const records = Array.isArray(first && first.records) ? first.records.slice() : [];

for (let p = 2; p <= pages; p++) {
const data = await 账号池.带Token重试(accountKey, token => 请求转发.获取用户积分计划(token, p));
if (Array.isArray(data && data.records)) records.push(...data.records);
}

const data = {
...(first || {}),
page: 1,
all: true,
records,
size: records.length,
pages,
};
const summary = 汇总积分计划(records);
try {
const notifyConfig = 企业微信通知.获取通知配置 ? 企业微信通知.获取通知配置() : {};
const threshold = Number(notifyConfig.lowBalanceThreshold || 0);
if (threshold > 0 && summary.usable < threshold && 企业微信通知.发送余额过低) {
企业微信通知.发送余额过低(accountKey, summary.usable, threshold, summary).catch(() => {});
}
} catch {}
res.json({ ok: true, action: 'billing-plans', accountKey, page: 1, all: true, pages, summary, data });
} catch (err) {
OpenAI错误.返回错误(res, err.status || err.statusCode || 500, {
message: err.message || '获取积分计划失败',
type: 'server_error',
code: 'billing_plans_failed',
detail: 脱敏错误摘要(err),
});
}
});

router.post('/billing/orders', async (req, res) => {
  try {
    const accountKey = (req.body && req.body.accountKey) || 'acc_0';
    const productId = Number(req.body && req.body.productId);
    const method = String((req.body && req.body.method) || '').trim();
    const openid = (req.body && req.body.openid) || {};
    if (!productId || !method) {
      return OpenAI错误.返回错误(res, 400, {
        message: '缺少 productId 或 method',
        type: 'invalid_request_error',
        code: 'missing_billing_order_param',
      });
    }
    const data = await 账号池.带Token重试(accountKey, token => 请求转发.创建积分订单(token, { method, productId, openid }));
    事件中心.记录事件('billing_order_created', '积分订单已创建', {
      accountKey,
      productId,
      method,
      orderNo: data && data.orderNo,
      orderId: data && data.orderId,
      payUrl: data && data.payUrl ? true : false,
    }, 'INFO');
    订单历史.追加记录({
      event: 'created',
      accountKey,
      productId,
      method,
      orderNo: data && data.orderNo,
      orderId: data && data.orderId,
      payMethod: data && data.payMethod,
      payUrl: data && data.payUrl,
      qrcode: data && data.qrcode,
      status: data && data.status,
      amount: data && data.amount,
      name: data && data.name,
      raw: data,
    });
    res.json({ ok: true, action: 'billing-order-created', accountKey, data });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '创建积分订单失败',
      type: 'server_error',
      code: 'create_billing_order_failed',
    });
  }
});

router.get('/billing/orders/recent', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    res.json({
      ok: true,
      action: 'billing-orders-recent',
      status: 订单历史.获取状态(),
      orders: 订单历史.读取最近(limit),
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '读取订单历史失败',
      type: 'server_error',
      code: 'read_billing_orders_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.post('/billing/orders/:orderNo/cancel', async (req, res) => {
  try {
    const accountKey = (req.body && req.body.accountKey) || req.query.accountKey || 'acc_0';
    const orderNo = req.params.orderNo;
    const data = await 账号池.带Token重试(accountKey, token => 请求转发.取消积分订单(token, orderNo));
    事件中心.记录事件('billing_order_canceled', '积分订单已取消', { accountKey, orderNo }, 'INFO');
    订单历史.追加记录({
      event: 'canceled',
      accountKey,
      orderNo,
      orderId: data && data.id,
      payMethod: data && data.payMethod,
      status: data && data.status,
      amount: data && data.amount,
      productId: data && data.productId,
      name: data && data.name,
      payTime: data && data.payTime,
      platformOrderId: data && data.platformOrderId,
      raw: data,
    });
    res.json({ ok: true, action: 'billing-order-canceled', accountKey, orderNo, data });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '取消积分订单失败',
      type: 'server_error',
      code: 'cancel_billing_order_failed',
    });
  }
});

function 模型价格项匹配(item, keyword) {
  if (!keyword) return true;
  const k = String(keyword).trim().toLowerCase();
  if (!k) return true;
  const fields = [item && item.id, item && item.label, item && item.value, item && item.provider];
  return fields.some(v => String(v || '').toLowerCase().includes(k));
}

function 筛选价格历史(history, model) {
  const keyword = String(model || '').trim();
  if (!keyword) return history;
  return (history || []).map(h => {
    const added = Array.isArray(h.added) ? h.added.filter(x => 模型价格项匹配(x, keyword)) : [];
    const removed = Array.isArray(h.removed) ? h.removed.filter(x => 模型价格项匹配(x, keyword)) : [];
    const priceChanged = Array.isArray(h.priceChanged) ? h.priceChanged.filter(x => 模型价格项匹配(x, keyword)) : [];
    return { ...h, added, removed, priceChanged };
  }).filter(h => (h.added.length + h.removed.length + h.priceChanged.length) > 0);
}

function 汇总价格历史(history) {
  const summary = {
    records: Array.isArray(history) ? history.length : 0,
    added: 0,
    removed: 0,
    priceChanged: 0,
    latestAt: null,
    topChangedModels: [],
  };
  const modelCounter = new Map();
  for (const h of history || []) {
    if (!summary.latestAt && h.time) summary.latestAt = h.time;
    const added = Array.isArray(h.added) ? h.added : [];
    const removed = Array.isArray(h.removed) ? h.removed : [];
    const changed = Array.isArray(h.priceChanged) ? h.priceChanged : [];
    summary.added += added.length;
    summary.removed += removed.length;
    summary.priceChanged += changed.length;
    for (const item of [...added, ...removed, ...changed]) {
      const key = String((item && (item.id || item.value || item.label)) || 'unknown');
      modelCounter.set(key, (modelCounter.get(key) || 0) + 1);
    }
  }
  summary.topChangedModels = Array.from(modelCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([model, count]) => ({ model, count }));
  return summary;
}

router.get('/model-price/history', async (req, res) => {

try {
const limit = Number(req.query.limit || 50);
const model = String(req.query.model || '').trim();
const rawHistory = 模型映射.读取价格变化历史 ? 模型映射.读取价格变化历史(limit) : [];
const history = 筛选价格历史(rawHistory, model);
res.json({
ok: true,
status: 模型映射.获取价格历史状态 ? 模型映射.获取价格历史状态() : null,
filters: { limit, model },
summary: 汇总价格历史(history),
history,
});
} catch (err) {
OpenAI错误.返回错误(res, 500, {
message: '读取模型价格变化历史失败',
type: 'server_error',
code: 'read_model_price_history_failed',
});
}
});

router.get('/logs/recent', async (req, res) => {

try {
res.json({
ok: true,
...读取最近日志(req.query.lines || 200, {
level: req.query.level || 'ALL',
keyword: req.query.keyword || '',
}),
});
} catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取最近日志失败',
      type: 'server_error',
      code: 'read_recent_logs_failed',
    });
  }
});

router.get('/events/recent', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const filters = {
      level: req.query.level || 'ALL',
      type: req.query.type || '',
      keyword: req.query.keyword || '',
    };
    const events = 事件中心.读取最近事件(limit, filters);
    res.json({
      ok: true,
      status: 事件中心.获取状态(),
      filters,
      totalMatched: events.length,
      events,
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取事件失败',
      type: 'server_error',
      code: 'read_recent_events_failed',
    });
  }
});

router.get('/events/stats', async (req, res) => {
  try {
    const max = Number(req.query.max || 5000);
    res.json({
      ok: true,
      status: 事件中心.获取状态(),
      stats: 事件中心.统计事件({ max }),
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取事件统计失败',
      type: 'server_error',
      code: 'read_event_stats_failed',
    });
  }
});

router.get('/backup/files', async (_req, res) => {

  try {
    res.json({
      ok: true,
      files: 备份文件列表.map(获取备份文件信息),
      sensitive: ['账号列表.json', '账号token.json'],
      note: '备份中可能包含账号密码和 token，请勿泄露。',
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取备份文件清单失败',
      type: 'server_error',
      code: 'read_backup_files_failed',
    });
  }
});

router.get('/backup/file/:name', async (req, res) => {
  try {
    const name = 安全备份文件名(req.params.name);
    if (!name) {
      return OpenAI错误.返回错误(res, 400, {
        message: '不允许读取该文件',
        type: 'invalid_request_error',
        code: 'backup_file_not_allowed',
      });
    }
    const data = 读取备份文件(name);
    if (!data) {
      return OpenAI错误.返回错误(res, 404, {
        message: '备份文件不存在',
        type: 'invalid_request_error',
        code: 'backup_file_not_found',
      });
    }
    res.json({ ok: true, file: data });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取备份文件失败',
      type: 'server_error',
      code: 'read_backup_file_failed',
    });
  }
});

router.post('/backup/restore/preview', async (req, res) => {
try {
const backup = req.body && (req.body.backup || req.body);
const files = req.body && req.body.files;
const preview = 生成恢复预览(backup, files);
res.json({
ok: true,
action: 'backup-restore-preview',
preview,
note: '这只是预览，不会写入文件。apply 时必须显式传 files 数组。',
});
} catch (err) {
OpenAI错误.返回错误(res, 400, {
message: err.message || '生成恢复预览失败',
type: 'invalid_request_error',
code: 'backup_restore_preview_failed',
detail: 脱敏错误摘要(err),
});
}
});

router.post('/backup/restore/apply', async (req, res) => {
try {
const backup = req.body && req.body.backup;
const files = req.body && req.body.files;
const restored = 执行选择性恢复(backup, files);
事件中心.记录事件('backup_restored', '已执行选择性备份恢复', { files, restored }, 'WARN');
res.json({
ok: true,
action: 'backup-restore-apply',
restored,
note: '已恢复所选文件，原文件如存在已自动生成 .restore-backup-* 备份。',
});
} catch (err) {
OpenAI错误.返回错误(res, 400, {
message: err.message || '执行备份恢复失败',
type: 'invalid_request_error',
code: 'backup_restore_apply_failed',
detail: 脱敏错误摘要(err),
});
}
});

router.get('/backup/export', async (_req, res) => {
  try {
    const files = {};
    for (const name of 备份文件列表) {
      const data = 读取备份文件(name);
      if (data) files[name] = data;
    }
    const backup = {
      version: 1,
      service: 'xs-openai-proxy',
      exportedAt: new Date().toISOString(),
      sensitive: true,
      note: '此备份可能包含账号密码和 token，请妥善保存。',
      files,
    };
    const filename = 'xs-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '导出备份失败',
      type: 'server_error',
      code: 'export_backup_failed',
    });
  }
});

router.get('/config', async (_req, res) => {
  res.json({ ok: true, runtime: 运行配置.获取状态() });
});

router.get('/config/history', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    res.json({
      ok: true,
      action: 'runtime-config-history',
      history: 运行配置.读取历史 ? 运行配置.读取历史(limit) : [],
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '读取运行配置历史失败',
      type: 'server_error',
      code: 'read_runtime_config_history_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

function 应用运行配置变更() {
  const applied = {};
  if (模型映射.重启自动刷新) applied.modelRefreshTimer = 模型映射.重启自动刷新();
  if (会话同步.重启定时同步) applied.sessionSyncTimer = 会话同步.重启定时同步();
  if (账号池.重启Token自动刷新) applied.tokenRefreshTimer = 账号池.重启Token自动刷新();
  if (自动签到.重启) applied.autoSignTimer = 自动签到.重启();
  applied.logLevel = 日志.获取级别 ? 日志.获取级别() : 配置.日志级别;
  return applied;
}

router.get('/deploy/status', async (_req, res) => {
  try {
    const result = await 部署诊断.获取部署状态();
    res.json({ ok: true, action: 'deploy-status', result });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '读取部署状态失败',
      type: 'server_error',
      code: 'deploy_status_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.get('/files/health', async (req, res) => {
  try {
    const backupCorrupt = String(req.query.backupCorrupt || '').toLowerCase() === 'true';
    const result = 数据文件健康.检查({ backupCorrupt });
    if (!result.ok || backupCorrupt) {
      事件中心.记录事件('data_files_health_checked', '数据文件健康检查', {
        ok: result.ok,
        summary: result.summary,
        badFiles: (result.files || []).filter(f => !f.ok).map(f => ({ name: f.name, issue: f.issue, backupPath: f.backupPath })),
      }, result.ok ? 'INFO' : 'WARN');
    }
    res.json({ ok: true, action: 'files-health', result });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '检查数据文件健康失败',
      type: 'server_error',
      code: 'files_health_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.get('/files/censor-rules', async (_req, res) => {
  try {
    const file = path.join(__dirname, '..', '误判词.json');
    let data = { 词表: {} };
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({
      ok: true,
      file: '误判词.json',
      exists: fs.existsSync(file),
      count: data && data.词表 ? Object.keys(data.词表).length : 0,
      data,
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取误判词 JSON 失败',
      type: 'server_error',
      code: 'read_censor_rules_failed',
    });
  }
});

router.post('/files/censor-rules', async (req, res) => {
  try {
    const body = req.body && req.body.data !== undefined ? req.body.data : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return OpenAI错误.返回错误(res, 400, {
        message: '误判词 JSON 必须是对象',
        type: 'invalid_request_error',
        code: 'invalid_censor_rules_json',
      });
    }
    if (!body.词表 || typeof body.词表 !== 'object' || Array.isArray(body.词表)) {
      return OpenAI错误.返回错误(res, 400, {
        message: '误判词 JSON 必须包含对象字段：词表',
        type: 'invalid_request_error',
        code: 'invalid_censor_rules_table',
      });
    }

    const normalized = { ...body, 词表: {} };
    for (const [k, v] of Object.entries(body.词表)) {
      if (!String(k).trim()) continue;
      normalized.词表[String(k)] = String(v);
    }

    const file = path.join(__dirname, '..', '误判词.json');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let backupPath = null;
    if (fs.existsSync(file)) {
      backupPath = file + '.bak-' + ts;
      fs.copyFileSync(file, backupPath);
    }
    const tmp = file + '.tmp-' + ts;
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    const status = 误判检测.重载规则 ? 误判检测.重载规则() : 误判检测.获取探测状态();
    事件中心.记录事件('censor_rules_updated', '误判词规则已在线保存', {
      count: Object.keys(normalized.词表).length,
      backupPath: backupPath ? path.basename(backupPath) : null,
    }, 'WARN');
    res.json({
      ok: true,
      action: 'save-censor-rules',
      file: '误判词.json',
      count: Object.keys(normalized.词表).length,
      backupPath,
      status,
      data: normalized,
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '保存误判词 JSON 失败',
      type: 'server_error',
      code: 'save_censor_rules_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.post('/maintenance/config', async (req, res) => {
  try {
    const before = 运行配置.获取状态();
    const runtime = 运行配置.更新(req.body || {}, { source: 'panel' });
    if (日志.设置级别) 日志.设置级别(runtime.config.logLevel);

    const applied = 应用运行配置变更();

    事件中心.记录事件('runtime_config_updated', '运行配置已更新', { runtime: runtime.config, applied }, 'INFO');
    res.json({
      ok: true,
      action: 'update-config',
      before,
      runtime,
      applied,
      needRestart: [],
    });

  } catch (err) {
    日志.error('维护接口', '更新运行配置失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 400, {
      message: err.message || '更新运行配置失败',
      type: 'invalid_request_error',
      code: 'update_runtime_config_failed',
    });
  }
});

router.post('/maintenance/config/reset', async (_req, res) => {
  try {
    const before = 运行配置.获取状态();
    const runtime = 运行配置.恢复默认 ? 运行配置.恢复默认({ source: 'panel' }) : 运行配置.更新({}, { source: 'panel-reset-fallback' });
    if (日志.设置级别) 日志.设置级别(runtime.config.logLevel);
    const applied = 应用运行配置变更();

    事件中心.记录事件('runtime_config_reset', '运行配置已恢复默认', { runtime: runtime.config, applied }, 'WARN');
    res.json({
      ok: true,
      action: 'reset-config',
      before,
      runtime,
      applied,
      needRestart: [],
    });
  } catch (err) {
    日志.error('维护接口', '恢复默认运行配置失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 400, {
      message: err.message || '恢复默认运行配置失败',
      type: 'invalid_request_error',
      code: 'reset_runtime_config_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.post('/maintenance/test-notify', async (_req, res) => {
  try {

    const result = await 企业微信通知.发送测试();
    事件中心.记录事件('notify_test', '企业微信测试通知', { result }, result.ok ? 'INFO' : 'WARN');
    res.json({ ok: !!result.ok, action: 'test-notify', result, status: 企业微信通知.获取状态() });

  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '发送测试通知失败',
      type: 'server_error',
      code: 'test_notify_failed',
    });
  }
});

router.post('/maintenance/refresh-models', async (_req, res) => {

  try {
    日志.info('维护接口', '手动刷新模型映射');
    await 模型映射.刷新();
    const models = 模型映射.getModels();
    res.json({
      ok: true,
      action: 'refresh-models',
      modelCount: models.length,
      models,
    });
  } catch (err) {
    日志.error('维护接口', '刷新模型失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 500, {
      message: '刷新模型失败',
      type: 'server_error',
      code: 'refresh_models_failed',
    });
  }
});

router.get('/sessions/detail', async (req, res) => {
  try {
    const accountKey = String(req.query.accountKey || '').trim();
    const model = String(req.query.model || '').trim();
    const limit = Number(req.query.limit || 20);
    const detail = 会话池.获取会话详情 ? 会话池.获取会话详情(accountKey, model, limit) : null;
    res.json({
      ok: true,
      action: 'session-detail',
      detail,
    });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '读取会话池详情失败',
      type: 'server_error',
      code: 'read_session_detail_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

router.post('/maintenance/sync-sessions', async (_req, res) => {
  try {
    日志.info('维护接口', '手动同步云端会话');
    const result = await 会话同步.同步云端到本地();
    res.json({
      ok: true,
      action: 'sync-sessions',
      result,
    });
  } catch (err) {
    日志.error('维护接口', '同步会话失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 500, {
      message: '同步会话失败',
      type: 'server_error',
      code: 'sync_sessions_failed',
    });
  }
});

router.post('/maintenance/refresh-token', async (req, res) => {
  try {
    const accountKey = (req.body && req.body.accountKey) || 'acc_0';
    日志.info('维护接口', '手动刷新 token: ' + accountKey);
    await 账号池.刷新Token(accountKey);
    const acc = (账号池.获取全部账号 ? 账号池.获取全部账号() : []).find(a => a.key === accountKey);
    res.json({
      ok: true,
      action: 'refresh-token',
      account: acc ? {
        key: acc.key,
        index: acc.index,
        account: 脱敏账号(acc.account),
        tokenValid: !!acc.token有效,
        exp: acc.exp || 0,
        expireAt: 时间字符串FromExp(acc.exp),
        leftSec: token剩余秒(acc.exp),
      } : { key: accountKey },
    });
  } catch (err) {
    日志.error('维护接口', '刷新 token 失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 500, {
      message: '刷新 token 失败',
      type: 'server_error',
      code: 'refresh_token_failed',
    });
  }
});

router.post('/maintenance/accounts', async (req, res) => {
  try {
    const { account, password, login } = req.body || {};
    日志.info('维护接口', '新增账号: ' + 脱敏账号(account));
    const added = await 账号池.增加账号(account, password, { login: login !== false });

    事件中心.记录事件('account_added', '账号已新增', { key: added.key, account: 脱敏账号(added.account), enabled: added.enabled !== false }, 'INFO');
    res.json({
      ok: true,
      action: 'add-account',

      account: {
        key: added.key,
        index: added.index,
        account: 脱敏账号(added.account),
        tokenValid: !!added.token有效,
        exp: added.exp || 0,
        expireAt: 时间字符串FromExp(added.exp),
        leftSec: token剩余秒(added.exp),
      },
      accounts: (账号池.获取全部账号 ? 账号池.获取全部账号() : []).map(a => ({
        key: a.key,
        index: a.index,
        account: 脱敏账号(a.account),
        tokenValid: !!a.token有效,
        exp: a.exp || 0,
        expireAt: 时间字符串FromExp(a.exp),
        leftSec: token剩余秒(a.exp),
        usageCount: a.使用次数 || 0,
        loggingIn: !!a.登录中,
      })),
    });
  } catch (err) {
    日志.error('维护接口', '新增账号失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 400, {
      message: err.message || '新增账号失败',
      type: 'invalid_request_error',
      code: 'add_account_failed',
    });
  }
});

router.patch('/maintenance/accounts/:accountKey', async (req, res) => {
  try {
    const accountKey = req.params.accountKey;
    const patch = req.body || {};
    日志.info('维护接口', '更新账号: ' + accountKey);
    const updated = await 账号池.更新账号(accountKey, patch);

    事件中心.记录事件('account_updated', '账号已更新', { key: updated.key, account: 脱敏账号(updated.account), enabled: updated.enabled !== false }, 'INFO');
    res.json({
      ok: true,
      action: 'update-account',

      account: {
        key: updated.key,
        index: updated.index,
        account: 脱敏账号(updated.account),
        tokenValid: !!updated.token有效,
        enabled: updated.enabled !== false,
        exp: updated.exp || 0,
        expireAt: 时间字符串FromExp(updated.exp),
        leftSec: token剩余秒(updated.exp),
        usageCount: updated.使用次数 || 0,
      },
      accounts: (账号池.获取全部账号 ? 账号池.获取全部账号() : []).map(a => ({
        key: a.key,
        index: a.index,
        account: 脱敏账号(a.account),
        tokenValid: !!a.token有效,
        enabled: a.enabled !== false,
        exp: a.exp || 0,
        expireAt: 时间字符串FromExp(a.exp),
        leftSec: token剩余秒(a.exp),
        usageCount: a.使用次数 || 0,
        loggingIn: !!a.登录中,
      })),
    });
  } catch (err) {
    日志.error('维护接口', '更新账号失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 400, {
      message: err.message || '更新账号失败',
      type: 'invalid_request_error',
      code: 'update_account_failed',
    });
  }
});

router.delete('/maintenance/accounts/:accountKey', async (req, res) => {

  try {
    const accountKey = req.params.accountKey;
    日志.warn('维护接口', '删除账号: ' + accountKey);
    const removed = await 账号池.删除账号(accountKey);

    事件中心.记录事件('account_deleted', '账号已删除', { key: removed.key, account: 脱敏账号(removed.account) }, 'WARN');
    res.json({
      ok: true,
      action: 'delete-account',

      removed: {
        key: removed.key,
        account: 脱敏账号(removed.account),
      },
      accounts: (账号池.获取全部账号 ? 账号池.获取全部账号() : []).map(a => ({
        key: a.key,
        index: a.index,
        account: 脱敏账号(a.account),
        tokenValid: !!a.token有效,
        exp: a.exp || 0,
        expireAt: 时间字符串FromExp(a.exp),
        leftSec: token剩余秒(a.exp),
        usageCount: a.使用次数 || 0,
        loggingIn: !!a.登录中,
      })),
    });
  } catch (err) {
    日志.error('维护接口', '删除账号失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 400, {
      message: err.message || '删除账号失败',
      type: 'invalid_request_error',
      code: 'delete_account_failed',
    });
  }
});

router.post('/maintenance/reload-model-stream-error-rules', async (_req, res) => {

  try {
    日志.info('维护接口', '重载模型流错误规则');
    const status = 模型流错误分类.重载规则();
    res.json({ ok: true, action: 'reload-model-stream-error-rules', status });
  } catch (err) {
    日志.error('维护接口', '重载模型流错误规则失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 500, {
      message: '重载模型流错误规则失败',
      type: 'server_error',
      code: 'reload_model_stream_error_rules_failed',
    });
  }
});

router.get('/maintenance/unclassified-model-errors', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    res.json({ ok: true, action: 'unclassified-model-errors', ...模型流错误分类.获取未分类样例(limit) });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '读取未分类模型流错误失败',
      type: 'server_error',
      code: 'read_unclassified_model_errors_failed',
    });
  }
});

router.post('/maintenance/clear-unclassified-model-errors', async (_req, res) => {
  try {
    const result = 模型流错误分类.清空未分类样例();
    res.json({ ok: true, action: 'clear-unclassified-model-errors', ...result });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '清空未分类模型流错误失败',
      type: 'server_error',
      code: 'clear_unclassified_model_errors_failed',
    });
  }
});

router.post('/maintenance/sign-now', async (_req, res) => {
  try {
    日志.info('维护接口', '手动触发签到');
    const result = await 自动签到.执行签到();
    const summary = {
      accounts: Array.isArray(result.results) ? result.results.length : 0,
      success: Array.isArray(result.results) ? result.results.filter(r => r && r.ok).length : 0,
      skipped: Array.isArray(result.results) ? result.results.filter(r => r && r.skipped).length : 0,
      failed: Array.isArray(result.results) ? result.results.filter(r => r && !r.ok).length : 0,
      usableDelta: Array.isArray(result.results) ? result.results.reduce((n, r) => n + Number(r && r.balanceChange && r.balanceChange.usable || 0), 0) : 0,
    };
    事件中心.记录事件('sign_now', '已手动执行签到', { summary, result }, summary.failed > 0 ? 'WARN' : 'INFO');
    res.json({ ok: true, action: 'sign-now', summary, result, status: 自动签到.获取状态() });
  } catch (err) {
    OpenAI错误.返回错误(res, 500, {
      message: '执行签到失败',
      type: 'server_error',
      code: 'sign_now_failed',
    });
  }
});

router.post('/sessions/delete-batch', async (req, res) => {
  try {
    const accountKey = (req.body && req.body.accountKey) || 'acc_0';
    const count = Number(req.body && req.body.count) || 0;
    if (count <= 0 || count > 500) {
      return OpenAI错误.返回错误(res, 400, {
        message: '删除数量必须在 1-500 之间',
        type: 'invalid_request_error',
        code: 'invalid_delete_count',
      });
    }
    
    日志.info('维护接口', `批量删除会话: ${accountKey} count=${count}`);
    
    // 获取该账号的会话详情
    const detail = 会话池.获取会话详情 ? 会话池.获取会话详情(accountKey, '', 500) : null;
    if (!detail || !detail.accounts || detail.accounts.length === 0) {
      return OpenAI错误.返回错误(res, 404, {
        message: '未找到该账号的会话',
        type: 'invalid_request_error',
        code: 'account_sessions_not_found',
      });
    }
    
    const account = detail.accounts[0];
    const allSessions = [];
    for (const m of account.byModel || []) {
      allSessions.push(...(m.sessions || []));
    }
    
    if (allSessions.length === 0) {
      return res.json({
        ok: true,
        action: 'delete-sessions-batch',
        accountKey,
        requested: count,
        deleted: 0,
        message: '该账号没有会话可删除',
      });
    }
    
    // 只选择空闲会话删除
    const idleSessions = allSessions.filter(s => s.idle);
    const toDelete = idleSessions.slice(0, count).map(s => s.id);
    
    if (toDelete.length === 0) {
      return res.json({
        ok: true,
        action: 'delete-sessions-batch',
        accountKey,
        requested: count,
        deleted: 0,
        message: '该账号没有空闲会话可删除',
      });
    }
    
    // 调用批量删除云端会话
    await 账号池.带Token重试(accountKey, token => 请求转发.批量删除会话(token, toDelete));
    
    // 同步云端会话到本地，会自动移除已删除的会话
    日志.info('维护接口', `批量删除后同步云端会话到本地`);
    await 会话同步.同步云端到本地();
    
    事件中心.记录事件('sessions_batch_deleted', '批量删除会话', {
      accountKey,
      requested: count,
      deleted: toDelete.length,
    }, 'WARN');
    
    res.json({
      ok: true,
      action: 'delete-sessions-batch',
      accountKey,
      requested: count,
      deleted: toDelete.length,
      message: `已删除 ${toDelete.length} 个空闲会话`,
    });
  } catch (err) {
    日志.error('维护接口', '批量删除会话失败: ' + (err.message || ''));
    OpenAI错误.返回错误(res, 500, {
      message: err.message || '批量删除会话失败',
      type: 'server_error',
      code: 'delete_sessions_batch_failed',
      detail: 脱敏错误摘要(err),
    });
  }
});

module.exports = router;
