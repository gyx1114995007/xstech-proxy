
const fs = require('fs');
const path = require('path');
const 配置 = require('../启动/配置');

const 文件路径 = path.join(__dirname, '..', process.env.RUNTIME_CONFIG_FILE || '运行配置.json');
const 历史文件路径 = path.join(__dirname, '..', '运行配置历史.jsonl');

const 默认配置 = {
modelRefreshIntervalSec: 配置.模型刷新间隔秒 || 1800,
sessionSyncIntervalMin: Math.max(1, Math.round((配置.会话池.同步间隔秒 || 1800) / 60)),
tokenRefreshCheckIntervalSec: 配置.token刷新检查间隔秒 || 60,
tokenRefreshBeforeSec: 配置.token提前刷新秒 || 300,
autoSignEnabled: true,
autoSignIntervalHours: 24,
autoSignInitialDelaySec: 15,

logLevel: 配置.日志级别 || 'INFO',
censorProbeModel: '',
notifyEnabled: false,
weworkWebhookUrl: process.env.WEWORK_WEBHOOK_URL || '',
notifyModelChange: true,
notifyFailure: true,
notifyAccountFailure: true,
notifyUpstreamFailure: true,
notifyLowBalance: true,
lowBalanceThreshold: 50000,
notifyCooldownMs: 10 * 60 * 1000,

upstreamRequestTimeoutMs: 15000,
upstreamStreamTimeoutMs: 180000,
upstreamRetryTimes: 1,
upstreamRetryDelayMs: 800,

visionAssist: {
  enabled: false,
  model: 'openai::gpt-4-turbo',
  mode: 'explicit',
  prompt: '请详细描述这张图片的内容，包括：主要物体和场景、颜色位置数量等细节、图片中的文字（如果有）、整体氛围和风格。用简洁准确的语言描述。',
  injectPosition: 'separate',
  showInResponse: true,
},
};
let 当前配置 = { ...默认配置 };
let updatedAt = null;

function clampNumber(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function 标准化(input = {}) {
  const out = { ...默认配置, ...当前配置, ...input };

  out.modelRefreshIntervalSec = Math.round(clampNumber(out.modelRefreshIntervalSec, 默认配置.modelRefreshIntervalSec, 30, 86400));
  out.sessionSyncIntervalMin = Math.round(clampNumber(out.sessionSyncIntervalMin, 默认配置.sessionSyncIntervalMin, 1, 1440));
  out.tokenRefreshCheckIntervalSec = Math.round(clampNumber(out.tokenRefreshCheckIntervalSec, 默认配置.tokenRefreshCheckIntervalSec, 5, 86400));
  out.tokenRefreshBeforeSec = Math.round(clampNumber(out.tokenRefreshBeforeSec, 默认配置.tokenRefreshBeforeSec, 0, 86400));
  out.autoSignEnabled = out.autoSignEnabled !== false;
  out.autoSignIntervalHours = clampNumber(out.autoSignIntervalHours, 默认配置.autoSignIntervalHours, 1, 720);
  out.autoSignInitialDelaySec = Math.round(clampNumber(out.autoSignInitialDelaySec, 默认配置.autoSignInitialDelaySec, 0, 3600));

  out.logLevel = String(out.logLevel || 默认配置.logLevel || 'INFO').toUpperCase();

  if (!['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(out.logLevel)) out.logLevel = 默认配置.logLevel || 'INFO';

  out.notifyEnabled = out.notifyEnabled === true;
  out.weworkWebhookUrl = String(out.weworkWebhookUrl || '').trim();
  out.notifyModelChange = out.notifyModelChange !== false;
  out.notifyFailure = out.notifyFailure !== false;
  out.notifyAccountFailure = out.notifyAccountFailure !== false;
  out.notifyUpstreamFailure = out.notifyUpstreamFailure !== false;
  out.notifyLowBalance = out.notifyLowBalance !== false;
  out.lowBalanceThreshold = Math.round(clampNumber(out.lowBalanceThreshold, 默认配置.lowBalanceThreshold, 0, 10000000000));
  out.notifyCooldownMs = Math.round(clampNumber(out.notifyCooldownMs, 默认配置.notifyCooldownMs, 60000, 86400000));

  out.upstreamRequestTimeoutMs = Math.round(clampNumber(out.upstreamRequestTimeoutMs, 默认配置.upstreamRequestTimeoutMs, 3000, 120000));
  out.upstreamStreamTimeoutMs = Math.round(clampNumber(out.upstreamStreamTimeoutMs, 默认配置.upstreamStreamTimeoutMs, 30000, 900000));
  out.upstreamRetryTimes = Math.round(clampNumber(out.upstreamRetryTimes, 默认配置.upstreamRetryTimes, 0, 5));
  out.upstreamRetryDelayMs = Math.round(clampNumber(out.upstreamRetryDelayMs, 默认配置.upstreamRetryDelayMs, 0, 30000));

  out.censorProbeModel = String(out.censorProbeModel || '').trim();

  return out;
}
function 应用到配置对象() {
  配置.模型刷新间隔秒 = 当前配置.modelRefreshIntervalSec;
  配置.会话池.同步间隔秒 = 当前配置.sessionSyncIntervalMin * 60;
  配置.token刷新检查间隔秒 = 当前配置.tokenRefreshCheckIntervalSec;
  配置.token提前刷新秒 = 当前配置.tokenRefreshBeforeSec;
  配置.日志级别 = 当前配置.logLevel;
  配置.误判检测探测模型 = 当前配置.censorProbeModel;
  配置.自动签到 = {
    启用: 当前配置.autoSignEnabled,
    间隔小时: 当前配置.autoSignIntervalHours,
    初始延迟秒: 当前配置.autoSignInitialDelaySec,
  };
  配置.上游请求超时毫秒 = 当前配置.upstreamRequestTimeoutMs;
  配置.上游流超时毫秒 = 当前配置.upstreamStreamTimeoutMs;
  配置.上游重试次数 = 当前配置.upstreamRetryTimes;
  配置.上游重试延迟毫秒 = 当前配置.upstreamRetryDelayMs;
}

function 读文件() {
  try {
    if (!fs.existsSync(文件路径)) return null;
    const data = JSON.parse(fs.readFileSync(文件路径, 'utf-8'));
    return data && typeof data === 'object' ? (data.config || data) : null;
  } catch {
    return null;
  }
}

function 写文件() {
  updatedAt = new Date().toISOString();
  const data = {
    version: 1,
    updatedAt,
    config: 当前配置,
  };
  const tmp = 文件路径 + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, 文件路径);
}

function 差异键(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return Array.from(keys).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

function 记录历史(action, before, after, extra = {}) {
  const row = {
    time: new Date().toISOString(),
    action,
    changedKeys: 差异键(before, after),
    before,
    after,
    ...extra,
  };
  fs.appendFileSync(历史文件路径, JSON.stringify(row) + '\n', 'utf-8');
  return row;
}

function 读取历史(limit = 50) {
  limit = Math.max(1, Math.min(500, Number(limit) || 50));
  if (!fs.existsSync(历史文件路径)) return [];
  const lines = fs.readFileSync(历史文件路径, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map(line => {
    try { return JSON.parse(line); }
    catch { return { raw: line }; }
  }).reverse();
}

function 初始化() {
  const fileConfig = 读文件();
  当前配置 = 标准化(fileConfig || 默认配置);
  应用到配置对象();

  if (!fs.existsSync(文件路径)) {
    写文件();
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(文件路径, 'utf-8'));
      updatedAt = raw.updatedAt || null;
    } catch {}
  }

  return 获取状态();
}

function 更新(patch = {}, meta = {}) {
  const before = 获取配置();
  当前配置 = 标准化({ ...当前配置, ...patch });
  应用到配置对象();
  写文件();
  记录历史('update', before, 获取配置(), meta);
  return 获取状态();
}

function 恢复默认(meta = {}) {
  const before = 获取配置();
  当前配置 = 标准化(默认配置);
  应用到配置对象();
  写文件();
  记录历史('reset', before, 获取配置(), meta);
  return 获取状态();
}

function 获取配置() {
  return { ...当前配置 };
}

function 获取状态() {
  return {
    file: path.basename(文件路径),
    path: 文件路径,
    historyFile: path.basename(历史文件路径),
    updatedAt,
    config: 获取配置(),
    effective: {
      modelRefreshIntervalSec: 配置.模型刷新间隔秒,
      sessionSyncIntervalSec: 配置.会话池.同步间隔秒,
      tokenRefreshCheckIntervalSec: 配置.token刷新检查间隔秒,
      tokenRefreshBeforeSec: 配置.token提前刷新秒,
      autoSign: 配置.自动签到 || null,

      logLevel: 配置.日志级别,
      notify: {
        enabled: 当前配置.notifyEnabled,
        configured: !!当前配置.weworkWebhookUrl,
        modelChange: 当前配置.notifyModelChange,
        failure: 当前配置.notifyFailure,
        accountFailure: 当前配置.notifyAccountFailure,
        upstreamFailure: 当前配置.notifyUpstreamFailure,
        lowBalance: 当前配置.notifyLowBalance,
        lowBalanceThreshold: 当前配置.lowBalanceThreshold,
        cooldownMs: 当前配置.notifyCooldownMs,
      },
      upstream: {
        requestTimeoutMs: 当前配置.upstreamRequestTimeoutMs,
        streamTimeoutMs: 当前配置.upstreamStreamTimeoutMs,
        retryTimes: 当前配置.upstreamRetryTimes,
        retryDelayMs: 当前配置.upstreamRetryDelayMs,
      },
    },
  };
}
module.exports = {
  初始化,
  更新,
  恢复默认,
  读取历史,
  获取配置,
  获取状态,
  应用到配置对象,
};
