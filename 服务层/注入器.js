const 误判检测 = require('../工具/误判检测');
const { openAIChatToUnified } = require('../工具/OpenAI聊天请求规范化');
const { buildUpstreamText } = require('../工具/上游请求构建器');
const { 转换Chat消息文件 } = require('../工具/Chat文件转换');

async function 注入(原始请求体) {
  const request = openAIChatToUnified(原始请求体, 原始请求体.model || '');
  const text = 误判检测.预替换(buildUpstreamText(request));
  const toolNonce = request.extra && typeof request.extra.relayToolCallNonce === 'string'
    ? request.extra.relayToolCallNonce
    : '';
  const files = await 转换Chat消息文件(Array.isArray(原始请求体.messages) ? 原始请求体.messages : [], {
    maxCount: 8,
    maxBytes: 10 * 1024 * 1024,
  });
  return { text, toolNonce, files };
}

module.exports = { 注入 };