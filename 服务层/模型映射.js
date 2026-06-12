const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');

const 账号池 = require('./账号池');
const 请求转发 = require('./请求转发');

const 企业微信通知 = require('./企业微信通知');
const 事件中心 = require('../工具/事件中心');

const fs = require('fs');
const path = require('path');

const 映射文件路径 = path.join(__dirname, '..', 配置.模型映射文件路径 || '模型映射.json');
const 价格文件路径 = path.join(__dirname, '..', 配置.模型价格文件路径 || '模型价格.json');
const 价格历史文件路径 = path.join(__dirname, '..', '模型价格变化历史.jsonl');

const 手动映射 = {
  'gpt-5.5': 'openai::gpt-5.5', 'gpt-5.4': 'openai::gpt-5.4', 'gpt-5.4-file': 'openai::gpt-5.4-file',
  'gpt-oss-120b': 'openai::openai/gpt-oss-120b', 'claude-opus-4-8': 'anthropic::claude-opus-4-8',
  'claude-opus-4-7': 'anthropic::claude-opus-4-7', 'claude-opus-4-6': 'anthropic::claude-opus-4-6',
  'claude-sonnet-4-6': 'anthropic::claude-sonnet-4-6', 'gemini-3.5-flash': 'google::gemini-3.5-flash',
  'gemini-3.1-pro': 'google::gemini-3.1-pro-preview', 'grok-4.3': 'Grok::grok-4.3-high',
  'grok-4.2': 'Grok::grok-4.20', 'grok-4.20-multi-agent-xhigh': 'Grok::grok-4.20-multi-agent-xhigh',
  'llama-4-scout': 'Llama::meta-llama/llama-4-scout-17b-16e-instruct',
  'deepseek-v4-flash': 'deepseek::deepseek-v4-flash', 'deepseek-v4-pro': 'deepseek::deepseek-v4-pro',
  'qwen-3.7-max': 'Qwen::qwen3.7-max-preview-thinking', 'qwen-3.7-plus': 'Qwen::qwen3.7-plus-preview-thinking',
  'kimi-k2.6': 'Kimi::kimi-k2.6', 'minimax-m2.7': 'MiniMax::MiniMax-M2.7',
  'doubao-seed-2.0-pro': 'doubao::doubao-seed-2-0-pro', 'glm-5.1': 'zhipu::GLM-5.1',
  'glm-5': 'zhipu::glm-5', 'mimo-v2.5-pro': 'Xiaomi::mimo-v2.5-pro', 'gpt-voice': 'realtime::gpt-realtime-mini',
};

let 动态映射 = {};
let 反向映射 = {};
let 模型列表缓存 = null;
let 最后刷新时间 = 0;
let 缓存来源 = 'empty';

let 模型价格缓存 = null;
let 价格最后刷新时间 = 0;
let 最近价格变化 = { 新增: [], 下线: [], 积分变化: [] };

function 读JSON(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    日志.warn('模型映射', '读取 JSON 失败 ' + file + ': ' + (err.message || ''));
    return null;
  }
}

function 写JSON(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    日志.warn('模型映射', '写入 JSON 失败 ' + file + ': ' + (err.message || ''));
  }
}

function 应用映射缓存(data, source = 'file') {
  if (!data) return false;
  const map = data.动态映射 || data.mapping || {};
  const reverse = data.反向映射 || data.reverseMapping || {};
  const models = data.模型列表 || data.models || [];
  if (!map || Object.keys(map).length === 0 || !Array.isArray(models) || models.length === 0) return false;

  动态映射 = { ...map };
  反向映射 = { ...reverse };
  模型列表缓存 = models.slice();
  最后刷新时间 = data.updatedAtMs || Date.parse(data.updatedAt || '') || Date.now();
  缓存来源 = source;
  日志.info('模型映射', '已从' + (source === 'file' ? '本地文件' : source) + '恢复 ' + 模型列表缓存.length + ' 个模型');
  return true;
}

function 应用价格缓存(data = 读JSON(价格文件路径)) {
  if (!data) return false;
  const list = data.模型价格 || data.prices || [];
  if (!Array.isArray(list) || list.length === 0) return false;
  模型价格缓存 = list.slice();
  价格最后刷新时间 = data.updatedAtMs || Date.parse(data.updatedAt || '') || Date.now();
  最近价格变化 = data.变化 || { 新增: [], 下线: [], 积分变化: [] };
  日志.info('模型价格', '已从本地文件恢复 ' + 模型价格缓存.length + ' 个模型价格');
  return true;
}

function 使用手动映射兜底() {
  动态映射 = { ...手动映射 };
  反向映射 = {};
  const now = Math.floor(Date.now() / 1000);
  const 兜底 = [];
  for (const [id, value] of Object.entries(手动映射)) {
    反向映射[value] = id;
    兜底.push({ id, object: 'model', created: now, owned_by: value.split('::')[0] || 'xstech' });
  }
  模型列表缓存 = 兜底;
  最后刷新时间 = Date.now();
  缓存来源 = 'manual';
  日志.warn('模型映射', '使用手动映射兜底，共 ' + 兜底.length + ' 个模型');
}

function 提取id(value) {
  const parts = String(value || '').split('::');
  return parts[parts.length - 1]
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\//g, '-');
}

function 提取积分(raw) {
  if (!raw) return null;
  if (raw.integral !== undefined && raw.integral !== null) return String(raw.integral);
  if (raw.attr && raw.attr.integral !== undefined && raw.attr.integral !== null) return String(raw.attr.integral);
  return null;
}

function 构建价格项({ id, value, provider, raw }) {
  const attr = raw && raw.attr ? raw.attr : {};
  return {
    id,
    label: raw && raw.label ? raw.label : id,
    value,
    provider,
    integral: 提取积分(raw),
    capabilities: attr.capabilities || {},
    rawIntegral: raw && raw.integral !== undefined ? raw.integral : undefined,
    attrIntegral: attr.integral !== undefined ? attr.integral : undefined,
  };
}

function 对比价格变化(oldList, newList) {
  const oldMap = new Map((oldList || []).map(x => [String(x.id), x]));
  const newMap = new Map((newList || []).map(x => [String(x.id), x]));
  const 新增 = [];
  const 下线 = [];
  const 积分变化 = [];

  for (const item of newList || []) {
    const old = oldMap.get(String(item.id));
    if (!old) {
      新增.push(item);
    } else if (String(old.integral || '') !== String(item.integral || '')) {
      积分变化.push({
        id: item.id,
        label: item.label,
        value: item.value,
        provider: item.provider,
        oldIntegral: old.integral,
        newIntegral: item.integral,
      });
    }
  }

  for (const item of oldList || []) {
    if (!newMap.has(String(item.id))) 下线.push(item);
  }

  return { 新增, 下线, 积分变化 };
}

function 追加价格变化历史(changes) {
  try {
    const item = {
      time: new Date().toISOString(),
      added: changes.新增 || [],
      removed: changes.下线 || [],
      priceChanged: changes.积分变化 || [],
    };
    fs.appendFileSync(价格历史文件路径, JSON.stringify(item) + '\n', 'utf-8');
  } catch (err) {
    日志.warn('模型价格', '写入价格变化历史失败: ' + (err.message || ''));
  }
}

function 读取价格变化历史(limit = 50) {
  limit = Math.max(1, Math.min(500, Number(limit || 50)));
  try {
    if (!fs.existsSync(价格历史文件路径)) return [];
    return fs.readFileSync(价格历史文件路径, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      })
      .reverse();
  } catch {
    return [];
  }
}

function 获取价格历史状态() {
  try {
    if (!fs.existsSync(价格历史文件路径)) return { file: '模型价格变化历史.jsonl', exists: false, size: 0, updatedAt: null };
    const st = fs.statSync(价格历史文件路径);
    return { file: '模型价格变化历史.jsonl', exists: true, size: st.size, updatedAt: st.mtime.toISOString() };
  } catch {
    return { file: '模型价格变化历史.jsonl', exists: false, size: 0, updatedAt: null };
  }
}

function 写入模型价格(价格列表) {

  const old = 读JSON(价格文件路径);
  const oldList = old && Array.isArray(old.模型价格) ? old.模型价格 : [];
  最近价格变化 = 对比价格变化(oldList, 价格列表);

  模型价格缓存 = 价格列表.slice();
  价格最后刷新时间 = Date.now();

  写JSON(价格文件路径, {
    version: 1,
    updatedAt: new Date(价格最后刷新时间).toISOString(),
    updatedAtMs: 价格最后刷新时间,
    count: 价格列表.length,
    变化: 最近价格变化,
    模型价格: 模型价格缓存,
  });

  const changeCount = 最近价格变化.新增.length + 最近价格变化.下线.length + 最近价格变化.积分变化.length;

  if (changeCount > 0) {

    日志.warn('模型价格', '检测到模型价格/上下线变化：新增 ' + 最近价格变化.新增.length + '，下线 ' + 最近价格变化.下线.length + '，积分变化 ' + 最近价格变化.积分变化.length);

    追加价格变化历史(最近价格变化);
    事件中心.记录事件('model_price_changed', '模型价格/上下线变化', {
      added: 最近价格变化.新增.length,
      removed: 最近价格变化.下线.length,
      priceChanged: 最近价格变化.积分变化.length,
      changes: 最近价格变化,
    }, 'WARN');

    企业微信通知.发送模型变化(最近价格变化).catch(err => {

      日志.warn('模型价格', '企业微信模型变化通知失败: ' + (err.message || err));
    });
  } else {

    日志.info('模型价格', '模型价格已同步，无变化，共 ' + 价格列表.length + ' 个模型');
  }
}

async function 刷新() {
  try {
    const account = await 账号池.选择账号();
    const data = await 账号池.带Token重试(account.key, token => 请求转发.获取模型列表(token));
    const models = data.models || [];
    const 新动态映射 = {};
    const 新反向映射 = {};
    const 模型列表数据 = [];
    const 模型价格数据 = [];
    const 已用id = new Set();
    const created = Math.floor(Date.now() / 1000);

    for (const m of models) {
      const value = m.value;
      if (!value) continue;
      const provider = String(value).split('::')[0] || 'xstech';
      let id = 提取id(value);
      if (!id) continue;
      if (已用id.has(id)) id = provider.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + id;
      已用id.add(id);

      新动态映射[id] = value;
      新反向映射[value] = id;
      模型列表数据.push({ id, object: 'model', created, owned_by: provider });
      模型价格数据.push(构建价格项({ id, value, provider, raw: m }));
    }

    if (模型列表数据.length === 0) throw new Error('模型列表为空');

    动态映射 = 新动态映射;
    反向映射 = 新反向映射;
    模型列表缓存 = 模型列表数据;
    最后刷新时间 = Date.now();
    缓存来源 = 'remote';

    写JSON(映射文件路径, {
      version: 1,
      updatedAt: new Date(最后刷新时间).toISOString(),
      updatedAtMs: 最后刷新时间,
      count: 模型列表数据.length,
      动态映射,
      反向映射,
      模型列表: 模型列表缓存,
    });

    写入模型价格(模型价格数据);

    日志.info('模型映射', '刷新完成: ' + 模型列表数据.length + ' 个模型，已写入本地缓存');
  } catch (err) {
    日志.error('模型映射', '刷新失败: ' + (err.message || ''));

    if (Object.keys(动态映射).length > 0 && Array.isArray(模型列表缓存) && 模型列表缓存.length > 0) {
      日志.warn('模型映射', '刷新失败，继续使用当前缓存，来源=' + 缓存来源 + '，模型数=' + 模型列表缓存.length);
      return;
    }

    if (应用映射缓存(读JSON(映射文件路径), 'file')) {
      日志.warn('模型映射', '刷新失败，已回退到本地模型映射缓存');
      return;
    }

    使用手动映射兜底();
  }
}

let 自动刷新定时器 = null;

function 启动自动刷新() {
  if (自动刷新定时器) clearInterval(自动刷新定时器);
  const 间隔秒 = Math.max(30, Number(配置.模型刷新间隔秒 || 1800));
  自动刷新定时器 = setInterval(刷新, 间隔秒 * 1000);
  if (typeof 自动刷新定时器.unref === 'function') 自动刷新定时器.unref();
  日志.info('模型映射', '模型自动刷新定时器已启动，间隔 ' + 间隔秒 + ' 秒');
}

function 重启自动刷新() {
  启动自动刷新();
  return { ok: true, intervalSec: Math.max(30, Number(配置.模型刷新间隔秒 || 1800)) };
}

async function 初始化(options = {}) {
  const { backgroundRefresh = true } = options;
  const hasCache = 应用映射缓存(读JSON(映射文件路径), 'file');
  应用价格缓存();

  if (!hasCache || Object.keys(动态映射).length === 0 || !Array.isArray(模型列表缓存) || 模型列表缓存.length === 0) {
    使用手动映射兜底();
  }

  启动自动刷新();

  if (backgroundRefresh) {
    刷新().catch(err => {
      日志.warn('模型映射', '后台首次刷新失败: ' + (err.message || err));
    });
  } else {
    await 刷新();
  }
}

function toXstechModel(openaiName) {
  if (动态映射[openaiName]) return 动态映射[openaiName];
  if (手动映射[openaiName]) return 手动映射[openaiName];
  if (openaiName && openaiName.includes('::')) return openaiName;
  if (openaiName === 'automatic' || openaiName === 'default') return 动态映射['gpt-5.5'] || 手动映射['gpt-5.5'];
  return null;
}

function getModels() {
  return 模型列表缓存 || [];
}

function getModelPrices() {
  return 模型价格缓存 || [];
}

function getModelCapabilities(xstechModel) {
  if (!xstechModel) return {};
  
  // 从价格缓存中查找模型能力
  const priceItem = (模型价格缓存 || []).find(p => p.value === xstechModel || p.id === xstechModel);
  if (priceItem && priceItem.capabilities) {
    return priceItem.capabilities;
  }
  
  // 默认返回空对象
  return {};
}

function 获取价格状态() {
  return {
    count: Array.isArray(模型价格缓存) ? 模型价格缓存.length : 0,
    updatedAt: 价格最后刷新时间 ? new Date(价格最后刷新时间).toISOString() : null,
    file: 配置.模型价格文件路径 || '模型价格.json',
    changes: {
      added: 最近价格变化.新增.length,
      removed: 最近价格变化.下线.length,
      priceChanged: 最近价格变化.积分变化.length,
    },
  };
}

function 获取状态() {
  return {
    count: Array.isArray(模型列表缓存) ? 模型列表缓存.length : 0,
    source: 缓存来源,
    updatedAt: 最后刷新时间 ? new Date(最后刷新时间).toISOString() : null,
    file: 配置.模型映射文件路径 || '模型映射.json',
    price: 获取价格状态(),
  };
}

module.exports = { 初始化, 刷新, 启动自动刷新, 重启自动刷新, toXstechModel, getModels, getModelPrices, getModelCapabilities, 读取价格变化历史, 获取价格历史状态, 获取状态, 获取价格状态 };
