const express = require('express');
const { responsesToChat } = require('../工具/Responses转Chat');
const { 调用ChatCompletions } = require('../工具/内部Chat调用');
const { 解析ChatSSE } = require('../工具/ChatSSE解析');
const Responses = require('../工具/Chat转Responses');
const Responses存储 = require('../工具/Responses存储');
const OpenAI错误 = require('../工具/OpenAI错误');
const 日志 = require('../工具/日志');
const Responses文件上下文 = require('../工具/Responses文件上下文');
const { 校验模型文件能力 } = require('../工具/模型能力校验');

const router = express.Router();

function 请求是否流式(body) {
  return body && body.stream === true;
}

router.post('/responses', async (req, res) => {
  const body = req.body || {};
  const id = Responses.新响应ID();
  const model = body.model || '';
  const abortController = new AbortController();
  let 下游断开 = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      下游断开 = true;
      abortController.abort();
    }
  });

  try {
    const previousMessages = body.previous_response_id ? Responses存储.构建上下文链(body.previous_response_id) : [];
    const chatBody = await responsesToChat(body, { previousMessages });
    const currentFiles = Array.isArray(chatBody._responsesFiles) ? chatBody._responsesFiles : [];
    const replay = body.previous_response_id ? Responses文件上下文.选择重放文件(body, currentFiles) : { files: [], reason: 'no_previous' };
    const finalFiles = currentFiles.length ? currentFiles : (Array.isArray(replay.files) ? replay.files : []);
    if (finalFiles.length) chatBody._responsesFiles = finalFiles.map(f => ({ name: f.name, data: f.data }));
    校验模型文件能力(chatBody.model, chatBody._responsesFiles || []);
    日志.info('Responses接口', 'Responses → Chat model=' + chatBody.model + ' stream=' + !!body.stream + (body.previous_response_id ? ' previous=' + body.previous_response_id + ' ctxMessages=' + previousMessages.length + ' replayFiles=' + (replay.files ? replay.files.length : 0) + ' replayReason=' + replay.reason : '') + ' files=' + ((chatBody._responsesFiles || []).length));
    const chatStream = await 调用ChatCompletions(chatBody, req.headers, { source: 'responses', signal: abortController.signal });

    if (请求是否流式(body)) {
      Responses.写Responses流开始(res, { id, model: chatBody.model });
      let textStarted = false;
      await 解析ChatSSE(chatStream, {
        onTextDelta: async (delta) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          if (!textStarted) { Responses.写Responses文本开始(res, { id }); textStarted = true; }
          Responses.写Responses文本增量(res, delta, { id });
        },
        onToolCallStart: async (toolCall, current, _json, state) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          const outputIndex = (textStarted ? 1 : 0) + (current.index || 0);
          Responses.写ResponsesToolStart(res, toolCall, current, { id, outputIndex });
        },
        onToolCallDelta: async (toolCall, current) => {
          if (下游断开 || res.destroyed || res.writableEnded) return;
          const outputIndex = (textStarted ? 1 : 0) + (current.index || 0);
          Responses.写ResponsesToolDelta(res, toolCall, current, { id, outputIndex });
        },
        onError: async (error) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write('event: response.failed\n');
            res.write('data: ' + JSON.stringify({ type: 'response.failed', error }) + '\n\n');
          }
        },
      }).then(state => {
        if (!下游断开 && !res.destroyed && !res.writableEnded) {
          const record = Responses.构造完整响应({
            id,
            model: chatBody.model,
            text: state.content,
            toolCalls: state.toolCalls,
            usage: state.usage,
            finishReason: state.finishReason,
            metadata: body.metadata,
            previousResponseId: body.previous_response_id,
          });
          Responses存储.追加记录(record);
          if (Array.isArray(chatBody._responsesFiles) && chatBody._responsesFiles.length) {
            Responses文件上下文.保存(id, chatBody._responsesFiles);
          }
          Responses.写Responses流结束(res, {
            id,
            model: chatBody.model,
            text: state.content,
            toolCalls: state.toolCalls,
            usage: state.usage,
            finishReason: state.finishReason,
            textStarted,
          });
        }
      });
      return;
    }

    const state = await 解析ChatSSE(chatStream);
    if (state.finishReason === 'error') {
      return OpenAI错误.返回错误(res, 500, {
        message: 'Responses 内部 Chat 调用返回错误',
        type: 'server_error',
        code: 'responses_chat_error',
      });
    }
    const response = Responses.构造完整响应({
      id,
      model: chatBody.model,
      text: state.content,
      toolCalls: state.toolCalls,
      usage: state.usage,
      finishReason: state.finishReason,
      metadata: body.metadata,
      previousResponseId: body.previous_response_id,
    });
    Responses存储.追加记录(response);
    if (Array.isArray(chatBody._responsesFiles) && chatBody._responsesFiles.length) {
      Responses文件上下文.保存(id, chatBody._responsesFiles);
    }
    res.json(response);
  } catch (err) {
    if (下游断开 || err.code === 'ERR_CANCELED') return;
    const status = err.status || err.statusCode || (err.param || /^missing_|^invalid_|^unsupported_/.test(String(err.code || '')) ? 400 : 500);
    OpenAI错误.返回错误(res, status, {
      message: err.message || 'Responses 请求失败',
      type: status >= 500 ? 'server_error' : 'invalid_request_error',
      code: err.code || 'responses_failed',
      param: err.param,
      detail: err.body,
    });
  }
});

router.get('/responses/:id', async (req, res) => {
  const id = req.params.id;
  const found = Responses存储.获取(id);
  if (!found || found.deleted) {
    return OpenAI错误.返回错误(res, 404, {
      message: 'Response not found',
      type: 'invalid_request_error',
      code: 'response_not_found',
      param: 'response_id',
    });
  }
  res.json(found);
});

router.delete('/responses/:id', async (req, res) => {
  const id = req.params.id;
  res.json(Responses存储.删除(id));
});

// Responses 存储状态暂不暴露到 /v1，避免污染 OpenAI 兼容接口。

module.exports = router;