const express = require('express');
const { claudeToChat } = require('../工具/Claude转Chat');
const { 调用ChatCompletions } = require('../工具/内部Chat调用');
const { 解析ChatSSE } = require('../工具/ChatSSE解析');
const Claude = require('../工具/Chat转Claude');
const 日志 = require('../工具/日志');
const { 清理不可见字符, 深度清理不可见字符 } = require('../工具/文本清理');

const router = express.Router();

function anthroErrorBody(message, type = 'api_error', extra = {}) {
  const error = { type, message: message || 'Claude Messages 请求失败' };
  if (extra.code) error.code = extra.code;
  if (extra.param) error.param = extra.param;
  if (extra.detail !== undefined) error.detail = extra.detail;
  return { type: 'error', error };
}

function 返回Claude错误(res, status, opts = {}) {
  const type = opts.type || (status >= 500 ? 'api_error' : 'invalid_request_error');
  return res.status(status).json(anthroErrorBody(opts.message, type, opts));
}

function 写ClaudeSSE错误(res, error) {
  res.write('event: error\n');
  res.write('data: ' + JSON.stringify(anthroErrorBody(error && error.message, error && error.type || 'api_error', error || {})) + '\n\n');
}


function 请求是否流式(body) {
  return body && body.stream === true;
}

router.post('/messages', async (req, res) => {
  const body = req.body || {};
  const id = Claude.新消息ID();
  const abortController = new AbortController();
  let 下游断开 = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      下游断开 = true;
      abortController.abort();
    }
  });

  try {
    const chatBody = await claudeToChat(body);
    日志.info('Claude接口', 'Claude Messages → Chat model=' + chatBody.model + ' stream=' + !!body.stream + ' messages=' + (Array.isArray(body.messages) ? body.messages.length : 0) + ' files=' + ((chatBody._responsesFiles || []).length));
    const chatStream = await 调用ChatCompletions(chatBody, req.headers, { source: 'claude-messages', signal: abortController.signal });

    if (请求是否流式(body)) {
      Claude.写Claude流开始(res, { id, model: chatBody.model });
      let textStarted = false;
      const openToolIndexes = new Set();
      let lastToolIndex = -1;

      const state = await 解析ChatSSE(chatStream, {
        onTextDelta: async (delta) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          const cleanDelta = 清理不可见字符(delta);
          if (!cleanDelta) return;
          if (!textStarted) {
            Claude.写Claude文本开始(res, { index: 0 });
            textStarted = true;
          }
          Claude.写Claude文本增量(res, cleanDelta, { index: 0 });
        },
        onToolCallStart: async (_toolCall, current) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          const index = (textStarted ? 1 : 0) + (current.index || 0);
          
          // 如果有上一个工具，先关闭它
          if (lastToolIndex >= 0 && lastToolIndex !== index) {
            Claude.写ClaudeTool结束(res, { index: lastToolIndex });
            openToolIndexes.delete(lastToolIndex);
          }
          
          openToolIndexes.add(index);
          lastToolIndex = index;
          Claude.写ClaudeToolStart(res, current, { index });
        },
        onToolCallDelta: async (toolCall, current) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          const index = (textStarted ? 1 : 0) + (current.index || 0);
          const delta = toolCall && toolCall.function && typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : '';
          Claude.写ClaudeToolDelta(res, delta, { index });
        },
        onError: async (error) => {
          if (!res.destroyed && !res.writableEnded) {
            写ClaudeSSE错误(res, error);
          }
        },
      });

      if (!下游断开 && !res.destroyed && !res.writableEnded) {
        日志.info('Claude接口', 'textStarted=' + textStarted + ' openTools=' + Array.from(openToolIndexes).join(',') + ' stateTool=' + (state.toolCalls||[]).length);
        if (textStarted) Claude.写Claude文本结束(res, { index: 0 });
        for (const index of openToolIndexes) Claude.写ClaudeTool结束(res, { index });
        Claude.写Claude流结束(res, {
          usage: state.usage,
          finishReason: state.finishReason,
          toolCalls: state.toolCalls,
        });
      }
      return;
    }

    const state = await 解析ChatSSE(chatStream);
    if (state.finishReason === 'error') {
      return 返回Claude错误(res, 500, {
        message: 'Claude Messages 内部 Chat 调用返回错误',
        type: 'api_error',
        code: 'claude_chat_error',
      });
    }

    res.json(深度清理不可见字符(Claude.构造完整消息({
      id,
      model: chatBody.model,
      text: state.content,
      toolCalls: state.toolCalls,
      usage: state.usage,
      finishReason: state.finishReason,
    })));
  } catch (err) {
    if (下游断开) return;
    if (err.code === 'ERR_CANCELED' || err.code === 'ABORT_ERR') return;
    if (String(err.message || '').includes('cancel')) return;
    const status = err.status || err.statusCode || (err.param || /^missing_|^invalid_|^unsupported_/.test(String(err.code || '')) ? 400 : 500);
    if (!res.headersSent) {
      返回Claude错误(res, status, {
        message: err.message || 'Claude Messages 请求失败',
        type: status >= 500 ? 'api_error' : 'invalid_request_error',
        code: err.code || 'claude_messages_failed',
        param: err.param,
        detail: err.body,
      });
    }
  }
});

module.exports = router;
