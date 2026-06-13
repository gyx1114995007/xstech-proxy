const express = require('express');
const 日志 = require('../工具/日志');
const 账号池 = require('../服务层/账号池');
const 会话池 = require('../服务层/会话池');
const 模型映射 = require('../服务层/模型映射');
const 请求转发 = require('../服务层/请求转发');
const 注入器 = require('../服务层/注入器');
const 误判检测 = require('../工具/误判检测');
const { 转换流, 格式化chunk } = require('../工具/流式转换');
const OpenAI错误 = require('../工具/OpenAI错误');
const 运行指标 = require('../工具/运行指标');
const 链路追踪 = require('../工具/链路追踪');
const { 校验模型文件能力 } = require('../工具/模型能力校验');
const 视觉辅助 = require('../工具/视觉辅助');
const router = express.Router();

function 是取消错误(err) {
  return !!err && (
    err.name === 'CanceledError' ||
    err.code === 'ERR_CANCELED' ||
    /aborted|canceled|cancelled/i.test(err.message || '')
  );
}

router.post('/chat/completions', async (req, res) => {
  let sessionId = null, 当前模型 = null, 是否脏 = false, 当前账号 = null;
  let abortController = null;
  let 下游已断开 = false;
  let 请求已完成 = false;
  let 请求指标 = null;
  let 请求追踪 = null;
  let 请求结果 = 'success';
  let 请求失败原因 = '';
  try {
    const body = req.body || {};
    请求追踪 = 链路追踪.创建({
      source: req.headers['x-xs-source'] || req.headers['x-source'] || 'chat',
      route: '/v1/chat/completions',
      stream: body.stream !== false,
    });
    const openaiModel = body.model;
    if (!openaiModel) {
      return OpenAI错误.返回错误(res, 400, {
        message: '缺少 model',
        type: 'invalid_request_error',
        code: 'missing_model',
        param: 'model',
      });
    }
    if (请求追踪) 请求追踪.setMeta({ model: openaiModel });
    const xstechModel = 模型映射.toXstechModel(openaiModel);
    if (!xstechModel) {
      return OpenAI错误.返回错误(res, 400, {
        message: '不支持的模型',
        type: 'invalid_request_error',
        code: 'model_not_supported',
        param: 'model',
      });
    }

    请求指标 = 运行指标.开始请求({ model: openaiModel });

    // 视觉辅助跳过标记检查（在注入之前）
    const skipVisionAssist = body._skipVisionAssist === true;
    if (skipVisionAssist) {
      日志.debug('对话补全', '跳过视觉辅助处理（内部调用）');
    }

    const 注入结果 = await 注入器.注入(body);
    let userText = 注入结果.text;
    const upstreamFiles = Array.isArray(body._upstreamFiles) ? body._upstreamFiles
      : Array.isArray(body._responsesFiles) ? body._responsesFiles
      : Array.isArray(注入结果.files) ? 注入结果.files
      : [];
    const toolNonce = 注入结果.toolNonce;
    
    // 调试日志
    日志.info('对话补全', `[DEBUG] body._upstreamFiles=${body._upstreamFiles?.length}, body._responsesFiles=${body._responsesFiles?.length}, 注入结果.files=${注入结果.files?.length}, upstreamFiles=${upstreamFiles.length}`);
    if (upstreamFiles.length > 0) {
      日志.info('对话补全', `[DEBUG] 第一个文件: ${JSON.stringify({name: upstreamFiles[0].name, mimeType: upstreamFiles[0].mimeType || upstreamFiles[0].mime_type})}`);
    }
    
    if (请求追踪) 请求追踪.setMeta({ xstechModel, filesCount: upstreamFiles.length });
    
    // 视觉辅助处理：为不支持图片的模型提供视觉能力（在文件能力校验之前）
    if (!skipVisionAssist) {
      const modelCaps = 模型映射.getModelCapabilities(xstechModel);
      const 视觉辅助请求 = {
        messages: body.messages || [],
        _responsesFiles: upstreamFiles,
      };
      try {
        const 处理后请求 = await 视觉辅助.处理视觉辅助(视觉辅助请求, openaiModel, modelCaps);
        // 🔑 判断视觉辅助是否生效：检查 _responsesFiles 是否被清空
        const 视觉辅助已生效 = (处理后请求._responsesFiles || []).length === 0 && upstreamFiles.length > 0;
        
        if (视觉辅助已生效) {
          // 视觉辅助已生效，更新消息和文件
          // 🔑 关键修复：重新注入时强制清空文件列表，避免注入器从 body._responsesFiles 重复提取文件
          const 重新注入 = await 注入器.注入({ 
            ...body, 
            messages: 处理后请求.messages,
            _responsesFiles: [],  // 强制覆盖为空数组
            _upstreamFiles: []    // 也清空这个
          });
          userText = 重新注入.text;
          upstreamFiles.length = 0;
          upstreamFiles.push(...(处理后请求._responsesFiles || []));
          if (请求追踪) 请求追踪.setMeta({ filesCount: upstreamFiles.length, visionAssist: true });
          日志.info('对话补全', '[视觉辅助] 已启用，文件数: ' + upstreamFiles.length);
        }
      } catch (visionErr) {
        日志.error('对话补全', '[视觉辅助] 失败: ' + (visionErr.message || visionErr));
        // 视觉辅助失败时，继续原流程（会被后续文件校验拒绝）
      }
    }
    
    // 校验模型文件能力（在视觉辅助处理之后）
    校验模型文件能力(openaiModel, upstreamFiles);
    
    日志.info('对话补全', '模型:' + openaiModel + ' -> ' + xstechModel + ' stream=' + (body.stream !== false) + ' files=' + upstreamFiles.length);

    abortController = new AbortController();
    const 中止上游 = (来源) => {
      if (请求已完成 || 下游已断开) return;
      下游已断开 = true;
      日志.warn('对话补全', 来源 + '，正在中止上游 xstech 流，当前会话正常归还');
      try { abortController.abort(); } catch {}
    };
    res.on('close', () => {
      if (!res.writableEnded) 中止上游('下游连接已关闭');
    });
    req.on('aborted', () => 中止上游('下游请求已中断'));

    当前账号 = await 账号池.选择账号();
    if (请求指标) 请求指标.accountKey = 当前账号.key;
    if (请求追踪) 请求追踪.setMeta({ accountKey: 当前账号.key });
    const 会话 = await 会话池.获取会话(当前账号.key, xstechModel);
    sessionId = 会话.id; 当前模型 = 会话.model;
    if (请求追踪) 请求追踪.setMeta({ sessionId, xstechModel: 当前模型 });
    日志.info('对话补全', '[' + 当前账号.key + '] 会话 ' + sessionId + ' 已锁定 (' + 当前模型 + ')');

    const t = body.temperature, p = body.presence_penalty, f = body.frequency_penalty;
    if (t !== undefined || p !== undefined || f !== undefined) {
      await 账号池.带Token重试(当前账号.key, token => 请求转发.更新会话(token, { id: 会话.id, model: 当前模型, contextCount: 0, prompt: '', webSearch: false, temperature: t ?? 0, presencePenalty: p ?? 0, frequencyPenalty: f ?? 0 }));
      是否脏 = true;
    }

    日志.记录请求('model=' + openaiModel + ' text=' + userText.slice(0, 300));

    if (body.stream === false) {
      const 聚合结果 = await 聚合自修复(openaiModel, xstechModel, 当前账号, userText, sessionId, toolNonce, abortController.signal, upstreamFiles, 请求追踪);
      请求结果 = 聚合结果.result || 'success';
      if (请求结果 === 'canceled') return;
      if (请求结果 === 'failed') {
        return OpenAI错误.返回错误(res, 聚合结果.status || 500, {
          message: 聚合结果.error?.message || '请求失败',
          type: 聚合结果.error?.type || 'server_error',
          code: 聚合结果.error?.code || 'upstream_request_failed',
        });
      }
      return res.json(构造Chat聚合响应(openaiModel, 聚合结果.state));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const originalWrite = res.write.bind(res);
    let firstWriteDone = false;
    res.write = function(chunk, encoding, callback) {
      if (!firstWriteDone && 请求追踪 && 请求追踪.markDownstreamWrite) {
        firstWriteDone = true;
        请求追踪.markDownstreamWrite();
      }
      return originalWrite(chunk, encoding, callback);
    };
    
    请求结果 = await 流式自修复(openaiModel, xstechModel, 当前账号, userText, sessionId, res, toolNonce, abortController.signal, upstreamFiles, 请求追踪) || 'success';
    if (!下游已断开 && !res.destroyed && !res.writableEnded) res.end();
  } catch (err) {
    if (下游已断开 || (abortController && abortController.signal.aborted) || 是取消错误(err)) {
      请求结果 = 'canceled';
      请求失败原因 = err.message || '下游断开';
      日志.info('对话补全', '请求已取消/下游已断开: ' + (err.message || ''));
      return;
    }
    请求结果 = 'failed';
    请求失败原因 = err.message || '外层异常';
    日志.error('对话补全', '外层异常: ' + (err.message || JSON.stringify(err).slice(0, 200)));
    const message = OpenAI错误.安全错误消息(err, '内部服务异常');
    const status = err.status || err.statusCode || (err.param || /^missing_|^invalid_|^unsupported_|^too_many_|^file_too_large|^model_/.test(String(err.code || '')) ? 400 : 500);
    if (!res.headersSent) {
      return OpenAI错误.返回错误(res, status, {
        message,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
        code: err.code || (status >= 500 ? 'internal_error' : 'invalid_request'),
        param: err.param,
      });
    }
    try {
      OpenAI错误.写SSE错误(res, {
        message,
        type: 'server_error',
        code: 'internal_error',
      });
      res.end();
    } catch {}
  } finally {
    请求已完成 = true;
    if (下游已断开 && 请求结果 === 'success') 请求结果 = 'canceled';
    if (请求追踪 && 请求追踪.end) {
      请求追踪.end(请求结果);
    }
    运行指标.结束请求(请求指标, 请求结果, { sessionId, reason: 请求失败原因 });
    if (sessionId) {
      await 会话池.归还会话(当前账号 && 当前账号.key, sessionId, 当前模型, 是否脏);
    }
  }
});

/**
 * 真流式 + 静默修复
 * - 正常流：边收 xstech SSE 边转 OpenAI 格式边发下游
 * - 误判错误（code=1+"不允许的文本"）：不写下游，后台检测+修复+重试
 * - 其他错误：写入下游
 */
async function 流式自修复(openaiModel, xstechModel, 当前账号, userText, sessionId, res, toolNonce = '', signal = null, files = [], trace = null) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal && signal.aborted) return 'canceled';
    let needFix = false;
    try {
      const response = await 账号池.带Token重试(当前账号.key, token => 请求转发.对话补全(token, { text: userText, sessionId, files }, { signal, trace, attempt }));
      await 转换流(openaiModel, response.data, (chunk) => {
        if ((signal && signal.aborted) || res.destroyed || res.writableEnded) return;
        if (chunk.error) {
          // 🔑 内容误判不写下游，触发静默修复；其他模型流错误按 OpenAI 错误格式下发
          if (chunk.error.type === 'content_censor' || (chunk.error.message && chunk.error.message.includes('不允许的文本'))) {
            needFix = true;
          } else {
            try { res.write(格式化chunk(chunk)); } catch (e) {
              if (e.code !== 'EPIPE' && e.code !== 'ERR_STREAM_DESTROYED') throw e;
            }
          }
        } else {
          try { res.write(格式化chunk(chunk)); } catch (e) {
            if (e.code !== 'EPIPE' && e.code !== 'ERR_STREAM_DESTROYED') throw e;
          }
        }
      }, { toolNonce, trace });

      if (signal && signal.aborted) return 'canceled';
      if (!needFix) return 'success';

      if (attempt >= MAX_RETRIES) {
        OpenAI错误.写SSE错误(res, {
          message: '内容含有不允许的文本',
          type: 'content_filter',
          code: 'content_censor',
        });
        return 'failed';
      }

      日志.warn('对话补全', '误判检测 (第' + (attempt + 1) + '次)');
      const fixed = await 误判检测.检测并修复(userText, null, xstechModel);
      if (fixed) {
        userText = fixed;
        日志.info('对话补全', '已修复，重试');
        continue;
      }

      OpenAI错误.写SSE错误(res, {
        message: '内容含有不允许的文本',
        type: 'content_filter',
        code: 'content_censor',
      });
      return 'failed';
    } catch (err) {
      if ((signal && signal.aborted) || 是取消错误(err)) {
        日志.info('对话补全', '上游 xstech 流已中止: ' + (err.message || ''));
        return 'canceled';
      }
      日志.error('对话补全', '请求异常[' + attempt + ']: ' + (err.message || ''));
      if (attempt >= MAX_RETRIES) {
        if (!res.destroyed && !res.writableEnded) {
          try {
            OpenAI错误.写SSE错误(res, {
              message: OpenAI错误.安全错误消息(err, '请求失败'),
              type: 'server_error',
              code: 'upstream_request_failed',
            });
          } catch {}
        }
        return 'failed';
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return 'failed';
}

function 聚合Chunk到State(state, chunk) {
  if (chunk.error) {
    state.error = chunk.error;
    return;
  }
  if (chunk.id && !state.id) state.id = chunk.id;
  if (chunk.model && !state.model) state.model = chunk.model;
  if (chunk.done) {
    state.finishReason = chunk.finish_reason || state.finishReason || 'stop';
    return;
  }
  const delta = chunk.delta || {};
  if (typeof delta.content === 'string') state.content += delta.content;
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = Number.isInteger(tc.index) ? tc.index : 0;
      if (!state.toolCalls[idx]) {
        state.toolCalls[idx] = {
          id: tc.id || ('call_' + idx),
          type: tc.type || 'function',
          function: { name: '', arguments: '' },
        };
      }
      const cur = state.toolCalls[idx];
      if (tc.id) cur.id = tc.id;
      if (tc.type) cur.type = tc.type;
      if (tc.function) {
        if (tc.function.name) cur.function.name = tc.function.name;
        if (typeof tc.function.arguments === 'string') cur.function.arguments += tc.function.arguments;
      }
    }
  }
}

function 构造Chat聚合响应(model, state = {}) {
  const toolCalls = (state.toolCalls || []).filter(Boolean);
  const message = { role: 'assistant', content: state.content || '' };
  if (toolCalls.length) {
    message.content = null;
    message.tool_calls = toolCalls;
  }
  return {
    id: state.id || ('chatcmpl-' + Date.now()),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: state.model || model,
    choices: [{
      index: 0,
      message,
      finish_reason: state.finishReason || (toolCalls.length ? 'tool_calls' : 'stop'),
    }],
    usage: state.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function 聚合自修复(openaiModel, xstechModel, 当前账号, userText, sessionId, toolNonce = '', signal = null, files = [], trace = null) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal && signal.aborted) return { result: 'canceled' };
    let needFix = false;
    const state = { content: '', toolCalls: [], finishReason: null, id: null, model: openaiModel, usage: null, error: null };
    try {
      const response = await 账号池.带Token重试(当前账号.key, token => 请求转发.对话补全(token, { text: userText, sessionId, files }, { signal, trace, attempt }));
      await 转换流(openaiModel, response.data, (chunk) => {
        if (signal && signal.aborted) return;
        if (chunk.error) {
          if (chunk.error.type === 'content_censor' || (chunk.error.message && chunk.error.message.includes('不允许的文本'))) {
            needFix = true;
          } else {
            state.error = chunk.error;
          }
          return;
        }
        聚合Chunk到State(state, chunk);
      }, { toolNonce, trace });

      if (signal && signal.aborted) return { result: 'canceled' };
      if (state.error) return { result: 'failed', status: 500, error: state.error };
      if (!needFix) return { result: 'success', state };

      if (attempt >= MAX_RETRIES) {
        return { result: 'failed', status: 400, error: { message: '内容含有不允许的文本', type: 'content_filter', code: 'content_censor' } };
      }

      日志.warn('对话补全', '非流式误判检测 (第' + (attempt + 1) + '次)');
      const fixed = await 误判检测.检测并修复(userText, null, xstechModel);
      if (fixed) {
        userText = fixed;
        日志.info('对话补全', '非流式已修复，重试');
        continue;
      }
      return { result: 'failed', status: 400, error: { message: '内容含有不允许的文本', type: 'content_filter', code: 'content_censor' } };
    } catch (err) {
      if ((signal && signal.aborted) || 是取消错误(err)) {
        日志.info('对话补全', '非流式上游 xstech 流已中止: ' + (err.message || ''));
        return { result: 'canceled' };
      }
      日志.error('对话补全', '非流式请求异常[' + attempt + ']: ' + (err.message || ''));
      if (attempt >= MAX_RETRIES) {
        return { result: 'failed', status: err.status || 500, error: { message: OpenAI错误.安全错误消息(err, '请求失败'), type: 'server_error', code: err.code || 'upstream_request_failed' } };
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { result: 'failed', status: 500, error: { message: '请求失败', type: 'server_error', code: 'upstream_request_failed' } };
}

module.exports = router;