
const 配置 = require('../启动/配置');
const 日志 = require('../工具/日志');
const OpenAI错误 = require('../工具/OpenAI错误');

function 提取APIKey(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return { key: authHeader.slice(7), source: 'authorization' };
  const anthropicKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
  if (typeof anthropicKey === 'string' && anthropicKey.trim()) return { key: anthropicKey.trim(), source: 'x-api-key' };
  return { key: '', source: '' };
}

function 鉴权拦截(req, res, next) {
  const { key, source } = 提取APIKey(req);
  if (!key) {
    日志.warn('鉴权', '缺少 Authorization 或 x-api-key');
    return OpenAI错误.返回错误(res, 401, {
      message: '请设置 Authorization: Bearer <key> 或 x-api-key: <key>',
      type: 'authentication_error',
      code: 'missing_authorization',
    });
  }
  if (key !== 配置.apiKey) {
    日志.warn('鉴权', 'Key 无效 source=' + source);
    return OpenAI错误.返回错误(res, 403, {
      message: 'API Key 无效',
      type: 'authentication_error',
      code: 'invalid_api_key',
    });
  }
  next();
}
module.exports = 鉴权拦截;
