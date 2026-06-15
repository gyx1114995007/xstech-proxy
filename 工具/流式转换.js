const 日志 = require('./日志');
const { 工具调用流解析器 } = require('./工具调用流解析器');
const { 分类模型流错误, 转OpenAI错误 } = require('./模型流错误分类');
const 运行指标 = require('./运行指标');
function genChunkId() { return 'chatcmpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }

async function 转换流(model, stream, pushChat, options = {}) {
  const toolParser = options.toolNonce ? new 工具调用流解析器(options.toolNonce) : null;
  const trace = options.trace || null;
  const chunkId = genChunkId();
  let buffer = '', accumulated = '', chunkCount = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let sawToolCall = false;
    let processing = Promise.resolve();

    async function emitText(text, kind) {
      if (!text) return;
      const cleanText = String(text).replace(/\u200B/g, '');
      if (!cleanText) return;
      if (!toolParser) {
        await pushChat({ done: false, id: chunkId, model, delta: { content: cleanText } });
        日志.记录下发((kind || 'delta') + '(' + cleanText.length + '): "' + cleanText.slice(0, 200) + '"');
        return;
      }
      await emitToolEvents(toolParser.push(cleanText));
    }

    async function emitToolEvents(events) {
      for (const event of events) {
        if (trace && trace.markToolEvent && (event.type === 'tool_start' || event.type === 'tool_delta')) {
          trace.markToolEvent(event);
        }
        if (event.type === 'delta') {
          if (event.text) {
            await pushChat({ done: false, id: chunkId, model, delta: { content: event.text } });
            日志.记录下发('toolText(' + event.text.length + '): "' + event.text.slice(0, 200) + '"');
          }
        } else if (event.type === 'tool_start') {
          sawToolCall = true;
          await pushChat({ done: false, id: chunkId, model, delta: { tool_calls: [{ index: event.index, id: event.id, type: 'function', function: { name: event.name, arguments: '' } }] } });
          日志.记录下发('tool_start[' + event.index + ']: ' + event.name);
        } else if (event.type === 'tool_delta') {
          await pushChat({ done: false, id: chunkId, model, delta: { tool_calls: [{ index: event.index, function: { arguments: event.arguments || '' } }] } });
          日志.记录下发('tool_delta[' + event.index + '](' + String(event.arguments || '').length + ')');
        }
      }
    }

    async function flushToolParser() {
      if (toolParser) await emitToolEvents(toolParser.end());
    }

    function cleanup() {
      stream.removeAllListeners('data');
      stream.removeAllListeners('end');
      stream.removeAllListeners('error');
    }

    async function finish(handler) {
      if (settled) return false;
      settled = true;
      cleanup();
      try {
        await handler();
        resolve();
      } catch (err) {
        reject(err);
      }
      return true;
    }

    async function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();

      if (trace && trace.markUpstreamData && chunkCount === 0) {
        trace.markUpstreamData();
      }

      if (dataStr === '[DONE]') {
        await finish(async () => {
          日志.info('流式转换', '流结束，共' + chunkCount + '个数据块');
          日志.记录原始('[DONE]');
          await flushToolParser();
          await pushChat({ done: true, id: chunkId, model, finish_reason: sawToolCall ? 'tool_calls' : 'stop' });
        });
        return;
      }

      let xstechChunk;
      try { xstechChunk = JSON.parse(dataStr); } catch {
        日志.记录原始('[非JSON] ' + dataStr.slice(0, 200));
        return;
      }

      chunkCount++;
      日志.记录原始('#' + chunkCount + ' ' + trimmed);

      const code = xstechChunk.code;
      if (code !== 0) {
        await finish(async () => {
          const 分类 = 分类模型流错误({
            code,
            err: xstechChunk.err,
            msg: xstechChunk.msg,
            data: xstechChunk.data,
          });
          const error = 转OpenAI错误({
            ...分类,
            code: 分类.code,
            xstechCode: code,
            xstechErr: xstechChunk.err || xstechChunk.msg || '',
          }, model);

          日志.error('流式转换', '模型流错误 type=' + error.type + ' code=' + code + ' err=' + (xstechChunk.err || ''));
          日志.记录原始('[模型流错误] type=' + error.type + ' code=' + code + ' data=' + JSON.stringify(xstechChunk.data) + ' err=' + (xstechChunk.err || ''));
          运行指标.记录模型流错误({
            model,
            type: error.type,
            code: error.code,
            message: 分类.message,
            xstechCode: code,
            xstechErr: xstechChunk.err || xstechChunk.msg || '',
          });
          await pushChat({ id: chunkId, model, error });
        });
        return;
      }

      if (typeof xstechChunk.data === 'string') {
        if (xstechChunk.data.length > 0) {
          accumulated += xstechChunk.data;
          await emitText(xstechChunk.data, 'delta');
          日志.记录下发('delta(' + xstechChunk.data.length + '): "' + xstechChunk.data.slice(0, 200) + '"');
        }
      } else if (typeof xstechChunk.data === 'object' && xstechChunk.data) {
        if (xstechChunk.data.aiText && xstechChunk.data.aiText.length > accumulated.length) {
          const suffix = xstechChunk.data.aiText.slice(accumulated.length);
          accumulated = xstechChunk.data.aiText;
          if (suffix) {
            await emitText(suffix, 'patchSuffix');
            日志.记录下发('patchSuffix(' + suffix.length + '): "' + suffix.slice(0, 200) + '"');
          }
        }
      }
    }

    async function processChunk(chunk) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (settled) return;
        await processLine(line);
      }
    }

    stream.on('data', (chunk) => {
      processing = processing.then(() => processChunk(chunk)).catch((err) => {
        if (!settled) {
          finish(async () => {
            日志.error('流式转换', '流处理错误: ' + err.message);
            await pushChat({ id: chunkId, model, error: { message: err.message } });
          }).then(() => reject(err)).catch(reject);
        }
      });
    });

    stream.on('end', () => {
      processing.then(async () => {
        if (settled) return;
        const remaining = buffer;
        buffer = '';
        if (remaining && remaining.trim()) {
          日志.debug('流式转换', '处理流结束残留buffer，长度=' + remaining.length);
          await processLine(remaining);
        }
        if (settled) return;
        await finish(async () => {
          日志.info('流式转换', '流正常结束，累积' + accumulated.length + '字符');
          await flushToolParser();
          await pushChat({ done: true, id: chunkId, model, finish_reason: sawToolCall ? 'tool_calls' : 'stop' });
        });
      }).catch((err) => {
        if (!settled) {
          finish(async () => {
            日志.error('流式转换', '流结束处理错误: ' + err.message);
            await pushChat({ id: chunkId, model, error: { message: err.message } });
          }).then(() => reject(err)).catch(reject);
        }
      });
    });

    stream.on('error', (err) => {
      if (settled) return;
      finish(async () => {
        日志.error('流式转换', '流错误: ' + err.message);
        await pushChat({ id: chunkId, model, error: { message: err.message } });
      }).then(() => reject(err)).catch(reject);
    });
  });
}

function 格式化chunk(chunk) {
  if (chunk.error) {
    日志.记录下发('[ERROR] ' + JSON.stringify(chunk.error));
    return 'data: {"error":' + JSON.stringify(chunk.error) + '}\n\n';
  }
  if (chunk.done) {
    const d = JSON.stringify({ id: chunk.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: chunk.model, choices: [{ index: 0, delta: {}, finish_reason: chunk.finish_reason || 'stop' }] });
    日志.记录下发('[DONE]');
    return 'data: ' + d + '\n\ndata: [DONE]\n\n';
  }
  const d = JSON.stringify({ id: chunk.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: chunk.model, choices: [{ index: 0, delta: chunk.delta || {}, finish_reason: null }] });
  return 'data: ' + d + '\n\n';
}

module.exports = { 转换流, 格式化chunk };
