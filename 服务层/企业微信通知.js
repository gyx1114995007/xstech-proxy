
const axios = require('axios');
const 运行配置 = require('./运行配置');

const 日志 = require('../工具/日志');
const 事件中心 = require('../工具/事件中心');

function 获取通知配置() {
  const c = 运行配置.获取配置 ? 运行配置.获取配置() : {};
  return {
    enabled: c.notifyEnabled === true,
    webhookUrl: String(c.weworkWebhookUrl || '').trim(),
    modelChange: c.notifyModelChange !== false,
    failure: c.notifyFailure !== false,
    accountFailure: c.notifyAccountFailure !== false,
    upstreamFailure: c.notifyUpstreamFailure !== false,
    lowBalance: c.notifyLowBalance !== false,
    lowBalanceThreshold: Number(c.lowBalanceThreshold || 50000),
    cooldownMs: Number(c.notifyCooldownMs || 10 * 60 * 1000),
  };
}

const 通知冷却 = new Map();

function 冷却允许(key, cooldownMs) {
  const now = Date.now();
  const last = 通知冷却.get(key) || 0;
  if (now - last < cooldownMs) return false;
  通知冷却.set(key, now);
  return true;
}

function 已配置() {
  const c = 获取通知配置();
  return !!(c.enabled && c.webhookUrl);
}

async function 发送文本(content) {
  const c = 获取通知配置();

  if (!c.enabled) {
    const r = { ok: false, skipped: true, reason: 'notify_disabled' };
    事件中心.记录事件('notify_skipped', '企业微信通知跳过', r, 'DEBUG');
    return r;
  }
  if (!c.webhookUrl) {
    const r = { ok: false, skipped: true, reason: 'webhook_empty' };
    事件中心.记录事件('notify_skipped', '企业微信通知跳过', r, 'WARN');
    return r;
  }

  const text = String(content || '').slice(0, 3800);
  try {
    const res = await axios.post(c.webhookUrl, {
      msgtype: 'text',
      text: { content: text },
    }, { timeout: 10000 });

    日志.info('企业微信通知', '发送成功');
    事件中心.记录事件('notify_sent', '企业微信通知发送成功', { data: res.data }, 'INFO');
    return { ok: true, data: res.data };

  } catch (err) {

    日志.warn('企业微信通知', '发送失败: ' + (err.message || ''));
    事件中心.记录事件('notify_failed', '企业微信通知发送失败', { error: err.message || String(err) }, 'WARN');
    return { ok: false, error: err.message || String(err) };

  }
}

function 格式化模型变化(changes) {
  const 新增 = changes && Array.isArray(changes.新增) ? changes.新增 : [];
  const 下线 = changes && Array.isArray(changes.下线) ? changes.下线 : [];
  const 积分变化 = changes && Array.isArray(changes.积分变化) ? changes.积分变化 : [];
  const lines = [
    '【xs中转站】模型价格/上下线变化',
    '时间：' + new Date().toLocaleString(),
    '新增：' + 新增.length,
    '下线：' + 下线.length,
    '积分变化：' + 积分变化.length,
  ];

  if (新增.length) {
    lines.push('', '新增模型：');
    for (const x of 新增.slice(0, 20)) lines.push('- ' + (x.label || x.id) + ' · ' + (x.integral || '-'));
    if (新增.length > 20) lines.push('... 还有 ' + (新增.length - 20) + ' 个');
  }

  if (下线.length) {
    lines.push('', '下线模型：');
    for (const x of 下线.slice(0, 20)) lines.push('- ' + (x.label || x.id) + ' · ' + (x.integral || '-'));
    if (下线.length > 20) lines.push('... 还有 ' + (下线.length - 20) + ' 个');
  }

  if (积分变化.length) {
    lines.push('', '积分变化：');
    for (const x of 积分变化.slice(0, 20)) {
      lines.push('- ' + (x.label || x.id) + ': ' + (x.oldIntegral || '-') + ' -> ' + (x.newIntegral || '-'));
    }
    if (积分变化.length > 20) lines.push('... 还有 ' + (积分变化.length - 20) + ' 个');
  }

  return lines.join('\n');
}

async function 发送模型变化(changes) {
  const c = 获取通知配置();
  if (!c.modelChange) return { ok: false, skipped: true, reason: 'model_change_notify_disabled' };
  return 发送文本(格式化模型变化(changes));
}

async function 发送账号异常(accountKey, reason, detail = {}) {
  const c = 获取通知配置();
  if (!c.failure || !c.accountFailure) return { ok: false, skipped: true, reason: 'account_failure_notify_disabled' };
  const key = 'account:' + accountKey;
  if (!冷却允许(key, c.cooldownMs)) return { ok: false, skipped: true, reason: 'cooldown' };
  return 发送文本([
    '【xs中转站】账号异常告警',
    '时间：' + new Date().toLocaleString(),
    '账号：' + accountKey,
    '原因：' + (reason || '-'),
    '详情：' + JSON.stringify(detail || {}).slice(0, 1200),
  ].join('\n'));
}

async function 发送上游异常(label, summary = {}) {
  const c = 获取通知配置();
  if (!c.failure || !c.upstreamFailure) return { ok: false, skipped: true, reason: 'upstream_failure_notify_disabled' };
  const code = summary.code || summary.causeCode || summary.axiosCode || summary.status || 'unknown';
  const key = 'upstream:' + label + ':' + code;
  if (!冷却允许(key, c.cooldownMs)) return { ok: false, skipped: true, reason: 'cooldown' };
  return 发送文本([
    '【xs中转站】上游异常告警',
    '时间：' + new Date().toLocaleString(),
    '接口：' + label,
    '错误：' + code,
    '摘要：' + JSON.stringify(summary || {}).slice(0, 1200),
  ].join('\n'));
}

async function 发送余额过低(accountKey, usable, threshold, summary = {}) {
  const c = 获取通知配置();
  if (!c.failure || !c.lowBalance) return { ok: false, skipped: true, reason: 'low_balance_notify_disabled' };
  const key = 'balance:' + accountKey;
  if (!冷却允许(key, c.cooldownMs)) return { ok: false, skipped: true, reason: 'cooldown' };
  return 发送文本([
    '【xs中转站】账号积分余额过低',
    '时间：' + new Date().toLocaleString(),
    '账号：' + accountKey,
    '可用积分：' + usable,
    '阈值：' + threshold,
    '汇总：' + JSON.stringify(summary || {}).slice(0, 1200),
  ].join('\n'));
}

async function 发送测试() {
  return 发送文本('【xs中转站】企业微信通知测试\n时间：' + new Date().toLocaleString());
}

function 获取状态() {
  const c = 获取通知配置();
  return {
    enabled: c.enabled,
    configured: !!c.webhookUrl,
    modelChange: c.modelChange,
    failure: c.failure,
    accountFailure: c.accountFailure,
    upstreamFailure: c.upstreamFailure,
    lowBalance: c.lowBalance,
    lowBalanceThreshold: c.lowBalanceThreshold,
    cooldownMs: c.cooldownMs,
  };
}

module.exports = {
  获取通知配置,
  获取状态,
  已配置,
  发送文本,
  发送测试,
  发送模型变化,
  发送账号异常,
  发送上游异常,
  发送余额过低,
};
