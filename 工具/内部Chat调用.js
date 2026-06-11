const axios = require('axios');
const 配置 = require('../启动/配置');

function 获取基础地址() {
  const port = 配置.端口 || process.env.PORT || 3000;
  return 'http://127.0.0.1:' + port;
}

function 提取授权头(headers = {}) {
  const auth = headers.Authorization || headers.authorization || '';
  if (auth) return auth;
  const anthropicKey = headers['x-api-key'] || headers['X-API-Key'];
  if (typeof anthropicKey === 'string' && anthropicKey.trim()) return 'Bearer ' + anthropicKey.trim();
  return '';
}

async function 调用ChatCompletions(chatBody, headers = {}, options = {}) {
  const base = options.baseUrl || 获取基础地址();
  const authorization = 提取授权头(headers) || ('Bearer ' + 配置.apiKey);
  const res = await axios.post(base + '/v1/chat/completions', {
    ...(chatBody || {}),
    stream: true,
  }, {
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'X-Internal-Protocol-Bridge': options.source || 'protocol-bridge',
    },
    responseType: 'stream',
    timeout: options.timeoutMs || 配置.上游流超时毫秒 || 180000,
    signal: options.signal,
    validateStatus: () => true,
    proxy: false,
  });
  if (res.status < 200 || res.status >= 300) {
    let text = '';
    try {
      for await (const chunk of res.data) text += chunk.toString('utf8');
    } catch {}
    const err = new Error('内部 Chat 调用失败: HTTP ' + res.status);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.data;
}

module.exports = {
  获取基础地址,
  调用ChatCompletions,
};