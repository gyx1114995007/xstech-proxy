
const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const 请求转发 = require('./请求转发');
const fs = require('fs');
const path = require('path');

const token文件路径 = path.join(__dirname, '..', 配置.xstech.账号Token文件路径 || '账号token.json');
const 账号列表文件路径 = path.join(__dirname, '..', 配置.xstech.账号列表文件路径 || '账号列表.json');

function 解析jwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch { return null; }
}

function 读Token文件() {
  try {
    if (!fs.existsSync(token文件路径)) return { accounts: {} };
    const data = JSON.parse(fs.readFileSync(token文件路径, 'utf-8'));
    if (!data || typeof data !== 'object') return { accounts: {} };
    if (!data.accounts || typeof data.accounts !== 'object') data.accounts = {};
    return data;
  } catch (err) {
    日志.warn('账号池', '读取 token 文件失败: ' + (err.message || ''));
    return { accounts: {} };
  }
}

function 构建Token文件数据() {
  const accounts = {};
  for (const 账号 of 账号列表) {
    if (!账号.token) continue;
    accounts[账号.key] = {
      key: 账号.key,
      index: 账号.index,
      account: 账号.账号,
      token: 账号.token,
      exp: 账号.exp,
      最后刷新: 账号.最后刷新,
      updatedAt: new Date().toISOString(),
    };
  }
  return { accounts };
}

let 写文件队列 = Promise.resolve();

function 原子写Token文件(data) {
  const tmp = token文件路径 + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, token文件路径);
}

function 标准化账号列表(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(x => ({
      account: String((x && x.account) || '').trim(),
      password: String((x && x.password) || ''),
      enabled: x && x.enabled === false ? false : true,
    }))
    .filter(x => x.account && x.password);
}

function 读账号列表文件() {
  try {
    if (!fs.existsSync(账号列表文件路径)) return null;
    const data = JSON.parse(fs.readFileSync(账号列表文件路径, 'utf-8'));
    const list = 标准化账号列表(Array.isArray(data) ? data : data.accounts);
    return list.length ? list : null;
  } catch (err) {
    日志.warn('账号池', '读取账号列表文件失败: ' + (err.message || ''));
    return null;
  }
}

function 写账号列表文件() {
  const data = {
    updatedAt: new Date().toISOString(),

    accounts: 账号列表.map(a => ({ account: a.账号, password: a.密码, enabled: a.enabled !== false })),

  };
  const tmp = 账号列表文件路径 + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, 账号列表文件路径);
}

function 初始化账号列表文件() {
  if (fs.existsSync(账号列表文件路径)) return;
  try {
    写账号列表文件();
    日志.info('账号池', '账号列表已初始化写入本地文件: ' + path.basename(账号列表文件路径));
  } catch (err) {
    日志.warn('账号池', '初始化账号列表文件失败: ' + (err.message || ''));
  }
}

function 排队写Token文件() {
  写文件队列 = 写文件队列
    .catch(() => {})
    .then(() => {
      try {
        token文件缓存 = 构建Token文件数据();
        原子写Token文件(token文件缓存);
      } catch (err) {
        日志.warn('账号池', '写入 token 文件失败: ' + (err.message || ''));
      }
    });
  return 写文件队列;
}

let token文件缓存 = { accounts: {} };

function 是Token失效错误(err) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status));
  if (status === 401 || status === 403) return true;

  const data = err && err.response && err.response.data;
  const msg = [
    err && err.message,
    typeof data === 'string' ? data : '',
    data && (data.message || data.msg || data.error || data.err),
  ].filter(Boolean).join(' ').toLowerCase();

  return /token|jwt|unauthori[sz]ed|forbidden|登录|登陆|认证|鉴权|过期|失效/.test(msg);
}

class 账号状态 {

  constructor(账号, 密码, key, index, enabled = true) {
    this.key = key;
    this.index = index;
    this.账号 = 账号;
    this.密码 = 密码;
    this.enabled = enabled !== false;
    this.token = null;
    this.exp = 0;
    this.最后刷新 = 0;
    this.使用次数 = 0;
    this.登录中 = false;

    this.healthScore = 100;
    this.连续失败次数 = 0;
    this.最近失败时间 = 0;
    this.最近失败原因 = '';
    this.最近成功时间 = 0;
    this.临时暂停至 = 0;
  }

  get 临时暂停中() {
    return this.临时暂停至 && this.临时暂停至 > Date.now();
  }

  记录成功() {
    this.连续失败次数 = 0;
    this.最近成功时间 = Date.now();
    this.healthScore = Math.min(100, Number(this.healthScore || 0) + 10);
    this.临时暂停至 = 0;
  }

  记录失败(err, options = {}) {
    const reason = (err && (err.safeMessage || err.publicMessage || err.message || err.code)) || 'unknown';
    this.连续失败次数 += 1;
    this.最近失败时间 = Date.now();
    this.最近失败原因 = String(reason).slice(0, 300);
    this.healthScore = Math.max(0, Number(this.healthScore || 100) - 20);

    const threshold = options.threshold || 3;
    const pauseMs = options.pauseMs || 5 * 60 * 1000;
    if (this.连续失败次数 >= threshold) {
      this.临时暂停至 = Date.now() + pauseMs;
      日志.warn('账号池', this.key + ' 连续失败 ' + this.连续失败次数 + ' 次，临时暂停至 ' + new Date(this.临时暂停至).toISOString() + '，原因: ' + this.最近失败原因);
      try {
        const 企业微信通知 = require('./企业微信通知');
        if (企业微信通知.发送账号异常) {
          企业微信通知.发送账号异常(this.key, this.最近失败原因, this.获取健康状态()).catch(() => {});
        }
      } catch {}
    }
  }

  获取健康状态() {
    return {
      score: this.healthScore,
      consecutiveFailures: this.连续失败次数,
      lastFailureAt: this.最近失败时间 ? new Date(this.最近失败时间).toISOString() : null,
      lastFailureReason: this.最近失败原因 || '',
      lastSuccessAt: this.最近成功时间 ? new Date(this.最近成功时间).toISOString() : null,
      pausedUntil: this.临时暂停至 ? new Date(this.临时暂停至).toISOString() : null,
      paused: !!this.临时暂停中,
    };
  }

  get 有效() {
    if (!this.token) return false;
    return this.exp > Math.floor(Date.now() / 1000) + 配置.token提前刷新秒;
  }

  从持久化恢复(saved) {
    if (!saved || saved.account !== this.账号 || !saved.token) return false;
    const payload = 解析jwt(saved.token);
    const exp = payload && payload.exp ? payload.exp : Number(saved.exp || 0);
    if (!exp) return false;

    this.token = saved.token;
    this.exp = exp;
    this.最后刷新 = saved.最后刷新 || 0;

    if (this.有效) {
      日志.info('账号池', this.key + ' token 已从文件恢复，有效至 ' + new Date(this.exp * 1000).toISOString());
      return true;
    }

    日志.warn('账号池', this.key + ' 持久化 token 已过期或即将过期');
    return false;
  }

  async 刷新(强制 = false) {
    if (this.登录中) {
      while (this.登录中) await new Promise(r => setTimeout(r, 100));
      if (!强制 && this.有效) return;
    }

    if (!强制 && this.有效) return;

    this.登录中 = true;
    try {
      const data = await 请求转发.登录(this.账号, this.密码);
      this.token = data.token;
      const payload = 解析jwt(this.token);
      this.exp = payload ? payload.exp : Math.floor(Date.now() / 1000) + 3600;
      this.最后刷新 = Date.now();
      await 排队写Token文件();
      日志.info('账号池', this.key + ' ' + this.账号 + ' 登录成功，token 已持久化');
    } catch (err) {
      日志.error('账号池', this.key + ' 登录失败: ' + (err.message || err));
      throw err;
    } finally {
      this.登录中 = false;
    }
  }
}

function 创建账号状态列表() {
  const fromFile = 读账号列表文件();
  const source = fromFile || 标准化账号列表(配置.xstech.账号列表);
  return source.map(({ account, password, enabled }, index) => new 账号状态(account, password, 'acc_' + index, index, enabled));
}

const 账号列表 = 创建账号状态列表();
let 当前序号 = 0;

function 重建账号索引() {
  账号列表.forEach((a, i) => {
    a.index = i;
    a.key = 'acc_' + i;
  });
  if (账号列表.length > 0) 当前序号 = 当前序号 % 账号列表.length;
  else 当前序号 = 0;
}

function 加载持久化Token() {
  token文件缓存 = 读Token文件();
  for (const 账号 of 账号列表) {
    const saved = token文件缓存.accounts && token文件缓存.accounts[账号.key];
    账号.从持久化恢复(saved);
  }
}

function 获取启用账号列表() {
  return 账号列表.filter(a => a.enabled !== false);
}

function 获取可用健康账号列表() {
  return 获取启用账号列表().filter(a => !a.临时暂停中);
}

function 获取账号(accountKey) {
  if (accountKey) {
    const found = 账号列表.find(a => a.key === accountKey);
    if (!found) throw new Error('未知账号: ' + accountKey);
    if (found.enabled === false) throw new Error('账号已禁用: ' + accountKey);
    return found;
  }

  const enabled = 获取启用账号列表();
  if (!enabled.length) throw new Error('没有可用启用账号');

  const available = 获取可用健康账号列表();
  const pool = available.length ? available : enabled;
  if (!available.length) 日志.warn('账号池', '所有启用账号都处于临时暂停状态，降级使用启用账号池');

  const 账号 = pool[当前序号 % pool.length];
  当前序号++;
  return 账号;
}

function 获取账号包含禁用(accountKey) {
  const found = 账号列表.find(a => a.key === accountKey);
  if (found) return found;
  throw new Error('未知账号: ' + accountKey);
}

function 启用账号数() {
  return 账号列表.filter(a => a.enabled !== false).length;
}

async function 选择账号() {
  const 账号 = 获取账号();
  await 账号.刷新();
  账号.使用次数++;
  return { key: 账号.key, index: 账号.index, account: 账号.账号, token: 账号.token, exp: 账号.exp };
}

async function getToken(accountKey) {
  const 账号 = 获取账号(accountKey);
  await 账号.刷新();
  账号.使用次数++;
  return 账号.token;
}

async function 刷新Token(accountKey) {
  const 账号 = 获取账号(accountKey);
  await 账号.刷新(true);
  账号.使用次数++;
  账号.记录成功();
  return 账号.token;
}

async function 带Token重试(accountKey, fn, options = {}) {
  const 最大重试 = options.maxRetries === undefined ? 1 : options.maxRetries;
  const 账号 = 获取账号(accountKey);
  let token = await getToken(accountKey);

  for (let i = 0; i <= 最大重试; i++) {
    try {
      const result = await fn(token);
      账号.记录成功();
      return result;
    } catch (err) {
      if (i < 最大重试 && 是Token失效错误(err)) {
        日志.warn('账号池', accountKey + ' token 可能失效，强制刷新后重试: ' + (err.message || err));
        await 刷新Token(accountKey);
        token = await getToken(accountKey);
        continue;
      }
      账号.记录失败(err, options.health || {});
      throw err;
    }
  }
}

function 获取全部账号() {
  return 账号列表.map(a => ({
    key: a.key,
    index: a.index,
    account: a.账号,
    token有效: a.有效,
    exp: a.exp,

    使用次数: a.使用次数,
    登录中: !!a.登录中,
    enabled: a.enabled !== false,
    health: a.获取健康状态(),

  }));
}

async function 增加账号(account, password, options = {}) {
  account = String(account || '').trim();
  password = String(password || '');
  if (!account || !password) throw new Error('账号和密码不能为空');
  if (账号列表.some(a => a.账号 === account)) throw new Error('账号已存在');

  const idx = 账号列表.length;

  const 新账号 = new 账号状态(account, password, 'acc_' + idx, idx, options.enabled !== false);

  账号列表.push(新账号);
  重建账号索引();
  写账号列表文件();
  日志.info('账号池', '已增加账号: ' + 新账号.key + ' ' + account);

  if (options.login !== false) {
    await 新账号.刷新(true);
  } else {
    await 排队写Token文件();
  }

  return {
    key: 新账号.key,
    index: 新账号.index,
    account: 新账号.账号,
    token有效: 新账号.有效,
    exp: 新账号.exp,

    使用次数: 新账号.使用次数,
    enabled: 新账号.enabled !== false,
  };
}

async function 删除账号(accountKey) {
  if (账号列表.length <= 1) throw new Error('至少保留一个账号');
  const idx = 账号列表.findIndex(a => a.key === accountKey);
  if (idx < 0) throw new Error('未知账号: ' + accountKey);
  if (账号列表[idx].enabled !== false && 启用账号数() <= 1) throw new Error('至少保留一个启用账号');

  const removed = 账号列表.splice(idx, 1)[0];
  重建账号索引();

  token文件缓存 = 构建Token文件数据();
  原子写Token文件(token文件缓存);
  写账号列表文件();

  日志.warn('账号池', '已删除账号: ' + removed.key + ' ' + removed.账号);
  return { key: removed.key, account: removed.账号 };
}

async function 更新账号(accountKey, patch = {}) {
  const 账号 = 获取账号包含禁用(accountKey);
  const oldAccount = 账号.账号;

  if (patch.account !== undefined) {
    const nextAccount = String(patch.account || '').trim();
    if (!nextAccount) throw new Error('账号不能为空');
    if (账号列表.some(a => a !== 账号 && a.账号 === nextAccount)) throw new Error('账号已存在');
    账号.账号 = nextAccount;
  }

  if (patch.password !== undefined) {
    const nextPassword = String(patch.password || '');
    if (!nextPassword) throw new Error('密码不能为空');
    账号.密码 = nextPassword;
    账号.token = null;
    账号.exp = 0;
    账号.最后刷新 = 0;
  }

  if (patch.enabled !== undefined) {
    const nextEnabled = patch.enabled !== false;
    if (!nextEnabled && 账号.enabled !== false && 启用账号数() <= 1) {
      throw new Error('至少保留一个启用账号');
    }
    账号.enabled = nextEnabled;
  }

  写账号列表文件();
  await 排队写Token文件();

  if (patch.login === true) {
    await 账号.刷新(true);
  }

  日志.info('账号池', '已更新账号: ' + accountKey + ' ' + oldAccount + ' -> ' + 账号.账号 + ' enabled=' + (账号.enabled !== false));
  return {
    key: 账号.key,
    index: 账号.index,
    account: 账号.账号,
    token有效: 账号.有效,
    exp: 账号.exp,
    使用次数: 账号.使用次数,
    enabled: 账号.enabled !== false,
  };
}

function token剩余秒(账号) {

  if (!账号 || !账号.token || !账号.exp) return null;
  return 账号.exp - Math.floor(Date.now() / 1000);
}

function 需要后台刷新(账号) {
  const left = token剩余秒(账号);
  if (left === null) return false;
  return left <= 配置.token提前刷新秒;
}

let token自动刷新定时器 = null;
let token自动刷新运行中 = false;

async function 后台刷新即将过期Token() {
  if (token自动刷新运行中) return;
  token自动刷新运行中 = true;
  try {
    for (const 账号 of 账号列表) {
      if (!需要后台刷新(账号)) continue;
      const left = token剩余秒(账号);
      try {
        日志.info('账号池', 账号.key + ' token 将在 ' + left + ' 秒后过期，后台自动刷新');
        await 账号.刷新(true);
      } catch (err) {
        日志.warn('账号池', 账号.key + ' 后台自动刷新 token 失败: ' + (err.message || err));
      }
    }
  } finally {
    token自动刷新运行中 = false;
  }
}

function 启动Token自动刷新() {
  if (token自动刷新定时器) clearInterval(token自动刷新定时器);
  const 间隔 = Math.max(5, 配置.token刷新检查间隔秒 || 60) * 1000;
  token自动刷新定时器 = setInterval(后台刷新即将过期Token, 间隔);
  if (typeof token自动刷新定时器.unref === 'function') token自动刷新定时器.unref();
  日志.info('账号池', 'token 自动刷新检查已启动，间隔 ' + (间隔 / 1000) + ' 秒，提前刷新窗口 ' + 配置.token提前刷新秒 + ' 秒');
}

function 重启Token自动刷新() {
  启动Token自动刷新();
  return {
    ok: true,
    intervalSec: Math.max(5, 配置.token刷新检查间隔秒 || 60),
    refreshBeforeSec: 配置.token提前刷新秒,
  };
}

async function 初始化() {
  初始化账号列表文件();
  加载持久化Token();

  for (const 账号 of 账号列表) {
    if (账号.有效) {
      日志.info('账号池', 账号.key + ' 使用持久化 token，无需登录');
    } else if (账号.token) {
      日志.warn('账号池', 账号.key + ' 持久化 token 已过期或进入提前刷新窗口，将由后台或首次使用刷新');
    } else {
      日志.warn('账号池', 账号.key + ' 无可用持久化 token，将在首次使用时登录刷新');
    }
  }

  启动Token自动刷新();
}

module.exports = {
  getToken,
  刷新Token,
  带Token重试,
  选择账号,
  获取全部账号,

  增加账号,
  删除账号,
  更新账号,
  初始化,

  启动Token自动刷新,
  重启Token自动刷新,
  后台刷新即将过期Token,

  是Token失效错误,
};
