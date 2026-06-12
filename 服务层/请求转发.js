const axios = require('axios');
const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const BASE = 配置.xstech.基础地址;
const APP_VERSION = 配置.xstech.应用版本;

function 通用头(token) {
  return { Accept: 'application/json, text/plain, */*', 'X-APP-VERSION': APP_VERSION, Authorization: token };
}
function post头(token) {
  return { ...通用头(token), 'Content-Type': 'application/json' };
}

function 睡眠(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function 获取上游配置() {
  return {
    requestTimeoutMs: 配置.上游请求超时毫秒 || 15000,
    streamTimeoutMs: 配置.上游流超时毫秒 || 180000,
    retryTimes: 配置.上游重试次数 === undefined ? 1 : 配置.上游重试次数,
    retryDelayMs: 配置.上游重试延迟毫秒 === undefined ? 800 : 配置.上游重试延迟毫秒,
  };
}

function 上游错误摘要(err) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status));
  const code = err && (err.code || (err.cause && err.cause.code));
  const name = err && err.name;
  const message = err && err.message;
  return {
    name,
    message,
    code,
    status,
    causeCode: err && err.cause && err.cause.code,
    axiosCode: err && err.isAxiosError ? err.code : undefined,
  };
}

function 是否可重试上游错误(err) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status));
  const code = String((err && (err.code || (err.cause && err.cause.code))) || '');
  if (status >= 500 && status < 600) return true;
  return /ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(code) ||
    (err && err.name === 'AggregateError');
}

function 创建上游错误(label, err, fallbackStatus) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status)) || fallbackStatus;
  const summary = 上游错误摘要(err);
  const code = summary.code || summary.causeCode || summary.axiosCode || '';
  const rawMessage = err && err.message ? String(err.message) : '';
  const e = new Error(label + (code ? ': ' + code : '') + (status ? ' HTTP ' + status : '') + (rawMessage ? ' · ' + rawMessage.slice(0, 300) : ''));
  e.status = status;
  e.upstream = summary;
  e.upstreamRaw = err && err.upstream;
  e.safeMessage = label + (code ? '（' + code + '）' : '');
  e.publicMessage = e.safeMessage;
  e.code = code || (err && err.code);
  return e;
}

async function 上游请求(label, axiosConfig, options = {}) {
  const c = 获取上游配置();
  const maxRetries = options.retries === undefined ? c.retryTimes : options.retries;
  const timeout = options.timeout === undefined ? c.requestTimeoutMs : options.timeout;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios({
        timeout,
        validateStatus: () => true,
        ...axiosConfig,
      });

      if (res.status < 200 || res.status >= 300) {
        const err = new Error(label + ': HTTP ' + res.status);
        err.status = res.status;
        err.response = res;
        err.upstream = typeof res.data === 'object' ? res.data : String(res.data || '').slice(0, 300);
        throw err;
      }

      if (res.data && typeof res.data === 'object' && res.data.code !== undefined && res.data.code !== 0) {
        const err = new Error(label + ': code=' + res.data.code + ' ' + (res.data.msg || res.data.message || ''));
        err.upstream = res.data;
        throw err;
      }

      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !是否可重试上游错误(err)) break;
      日志.warn('请求转发', label + ' 上游失败，准备重试 ' + (attempt + 1) + '/' + maxRetries + ': ' + JSON.stringify(上游错误摘要(err)));
      await 睡眠(c.retryDelayMs * (attempt + 1));
    }
  }

  const finalErr = 创建上游错误(label + '失败', lastErr);
  try {
    const 企业微信通知 = require('./企业微信通知');
    if (企业微信通知.发送上游异常) {
      企业微信通知.发送上游异常(label, finalErr.upstream || 上游错误摘要(lastErr)).catch(() => {});
    }
  } catch {}
  throw finalErr;
}

function 是图片DataURL(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('data:image/');
}

function 是图片文件项(file) {
  if (!file || typeof file !== 'object') return false;
  if (file.type === 'image' || file.type === 'input_image' || file.type === 'image_url') return true;
  if (file.image_url) return true;
  return 是图片DataURL(file.data);
}

const 请求转发 = {
  async 登录(account, password) {
    const res = await 上游请求('登录', {
      method: 'post',
      url: BASE + '/api/user/login',
      data: { account, password, code: '', captcha: '', invite: '', agreement: true, captchaId: '' },
      headers: post头(''),
    });
    return res.data.data;
  },
  async 获取模型列表(token) {
    const res = await 上游请求('获取模型列表', {
      method: 'get',
      url: BASE + '/api/chat/tmpl',
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 获取会话列表(token, page = 1) {
const res = await 上游请求('获取会话列表', {
method: 'get',
url: BASE + '/api/chat/session?page=' + encodeURIComponent(page),
headers: 通用头(token),
});
return res.data.data;
},
async 获取会话详情(token, sessionId) {
const res = await 上游请求('获取会话详情', {
method: 'get',
url: BASE + '/api/chat/session/' + encodeURIComponent(sessionId),
headers: 通用头(token),
});
return res.data.data;
},
async 创建会话(token, model) {
    const body = { model, plugins: [], mcp: [], webSearch: false };
    const res = await 上游请求('创建会话', {
      method: 'post',
      url: BASE + '/api/chat/session',
      data: body,
      headers: post头(token),
    });
    return res.data.data;
  },
  async 更新会话(token, 会话对象) {
    const res = await 上游请求('更新会话', {
      method: 'put',
      url: BASE + '/api/chat/session/' + encodeURIComponent(会话对象.id),
      data: 会话对象,
      headers: post头(token),
    });
    return res.data.data;
  },
  async 清空上下文(token, sessionId) {
    const res = await 上游请求('清空上下文', {
      method: 'post',
      url: BASE + '/api/chat/context-clear/' + encodeURIComponent(sessionId),
      data: {},
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 删除会话(token, sessionId) {
    const res = await 上游请求('删除会话', {
      method: 'delete',
      url: BASE + '/api/chat/session/' + encodeURIComponent(sessionId),
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 批量删除会话(token, ids) {
    const list = (ids || []).filter(id => id !== undefined && id !== null);
    if (list.length === 0) return null;
    const query = list.map(id => 'ids[]=' + encodeURIComponent(String(id))).join('&');
    const res = await 上游请求('批量删除会话', {
      method: 'delete',
      url: BASE + '/api/chat/session/batch?' + query,
      headers: 通用头(token),
    });
    return res.data.data;
  },

  async 获取签到记录(token, year, month) {
    const res = await 上游请求('获取签到记录', {
      method: 'get',
      url: BASE + '/api/gift_sign?year=' + encodeURIComponent(year) + '&month=' + encodeURIComponent(month),
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 签到打卡(token) {
    const res = await 上游请求('签到打卡', {
      method: 'post',
      url: BASE + '/api/gift_sign',
      data: {},
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 获取积分套餐商品(token) {
    const res = await 上游请求('获取积分套餐商品', {
      method: 'get',
      url: BASE + '/api/product',
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 创建积分订单(token, { method, productId, openid = {} }) {
    const res = await 上游请求('创建积分订单', {
      method: 'post',
      url: BASE + '/api/order/buy',
      data: { method, productId, openid },
      headers: post头(token),
    });
    return res.data.data;
  },
  async 取消积分订单(token, orderNo) {
    const res = await 上游请求('取消积分订单', {
      method: 'post',
      url: BASE + '/api/order/pay/cancel/' + encodeURIComponent(orderNo),
      data: {},
      headers: 通用头(token),
    });
    return res.data.data;
  },
  async 获取用户积分计划(token, page = 1) {
    const res = await 上游请求('获取用户积分计划', {
      method: 'get',
      url: BASE + '/api/user_plan?page=' + encodeURIComponent(page),
      headers: 通用头(token),
    });
    return res.data.data;
  },

  async 对话补全(token, { text, sessionId, files = [], thinking = false, webSearch = false }, options = {}) {
    const safeFiles = Array.isArray(files) ? files : [];
    const useImages = safeFiles.some(是图片文件项);
    const useFiles = safeFiles.length > 0;
    const body = { text, sessionId, files: safeFiles, thinking, webSearch };
    if (配置.xstech.发送文件开关字段) {
      body.useImages = useImages;
      body.useFiles = useFiles;
    }
    const c = 获取上游配置();

    日志.info('请求转发', '[xstech] body=' + JSON.stringify({
      text: String(text || '').slice(0, 100),
      sessionId,
      filesCount: safeFiles.length,
      fileNames: safeFiles.map(f => f && f.name).filter(Boolean).slice(0, 8),
      firstFileDataPrefix: safeFiles[0] && typeof safeFiles[0].data === 'string' ? safeFiles[0].data.slice(0, 40) : undefined,
      sendFileFlags: !!配置.xstech.发送文件开关字段,
      useImages: 配置.xstech.发送文件开关字段 ? useImages : undefined,
      useFiles: 配置.xstech.发送文件开关字段 ? useFiles : undefined,
    }));
    try {
      if (options.trace && options.trace.markUpstreamRequest) {
        options.trace.markUpstreamRequest({
          attempt: options.attempt || 0,
          sessionId,
          filesCount: safeFiles.length,
        });
      }
      const res = await axios.post(BASE + '/api/chat/completions', body, {
        headers: { ...post头(token), Accept: 'text/event-stream' },
        responseType: 'stream',
        timeout: c.streamTimeoutMs,
        signal: options.signal,
        validateStatus: () => true,
      });
      if (res.status < 200 || res.status >= 300) {
        const err = new Error('对话补全: HTTP ' + res.status);
        err.status = res.status;
        err.response = res;
        throw 创建上游错误('对话补全失败', err, res.status);
      }
      return res;
    } catch (err) {
      if (err && (err.name === 'CanceledError' || err.code === 'ERR_CANCELED')) throw err;
      throw 创建上游错误('对话补全失败', err);
    }
  },
};

module.exports = 请求转发;
