const 日志 = require('./日志');
const 运行配置 = require('../服务层/运行配置');
const { 调用ChatCompletions } = require('./内部Chat调用');
const { 解析ChatSSE } = require('./ChatSSE解析');

/**
 * 视觉辅助模块
 * 为不支持图片的模型提供视觉能力
 */

// 统计数据
let 统计数据 = {
  总调用次数: 0,
  成功次数: 0,
  失败次数: 0,
  总耗时: 0,
  总图片数: 0,
  最近调用时间: null,
};

// 识别历史（最多保留100条）
let 识别历史 = [];
const 最大历史记录数 = 100;

/**
 * 记录识别统计
 */
function 记录识别统计(success, duration, imageCount) {
  统计数据.总调用次数++;
  if (success) {
    统计数据.成功次数++;
  } else {
    统计数据.失败次数++;
  }
  统计数据.总耗时 += duration;
  统计数据.总图片数 += imageCount;
  统计数据.最近调用时间 = new Date().toISOString();
}

/**
 * 添加识别历史
 */
function 添加识别历史(record) {
  识别历史.unshift(record);
  if (识别历史.length > 最大历史记录数) {
    识别历史 = 识别历史.slice(0, 最大历史记录数);
  }
}

/**
 * 获取统计数据
 */
function 获取统计() {
  return {
    ...统计数据,
    平均耗时: 统计数据.总调用次数 > 0 ? Math.round(统计数据.总耗时 / 统计数据.总调用次数) : 0,
    成功率: 统计数据.总调用次数 > 0 ? Math.round((统计数据.成功次数 / 统计数据.总调用次数) * 100) : 0,
  };
}

/**
 * 获取识别历史
 */
function 获取历史(limit = 20) {
  return 识别历史.slice(0, limit);
}

/**
 * 清空统计
 */
function 清空统计() {
  统计数据 = {
    总调用次数: 0,
    成功次数: 0,
    失败次数: 0,
    总耗时: 0,
    总图片数: 0,
    最近调用时间: null,
  };
  识别历史 = [];
}

/**
 * 检查模型是否需要视觉辅助
 * @param {Object} modelCaps - 模型能力对象 {imageInput: boolean}
 * @param {Array} files - 文件列表
 * @returns {boolean}
 */
function 需要视觉辅助(modelCaps, files) {
  const 配置 = 运行配置.获取配置();
  if (!配置.visionAssist || !配置.visionAssist.enabled) return false;
  if (!files || files.length === 0) return false;
  if (modelCaps && modelCaps.imageInput) return false; // 模型本身支持图片
  
  // 检查是否有图片文件
  const hasImages = files.some(f => {
    const mime = f.mimeType || f.mime_type || '';
    return mime.startsWith('image/');
  });
  
  return hasImages;
}

/**
 * 调用视觉模型识别图片
 * @param {Array} files - 文件列表
 * @param {string} userQuestion - 用户原始问题
 * @returns {Promise<string>} 识别结果文本
 */
async function 识别图片(files, userQuestion = '') {
  const 配置 = 运行配置.获取配置();
  const visionConfig = 配置.visionAssist || {};
  const visionModel = visionConfig.model || 'openai::gpt-4-turbo';
  const maxImagesPerCall = visionConfig.maxImagesPerCall || 8;
  
  日志.info('视觉辅助', `使用模型 ${visionModel} 识别 ${files.length} 个文件，单次最多 ${maxImagesPerCall} 张`);
  
  // 如果图片数量超过单次限制，分批识别
  if (files.length > maxImagesPerCall) {
    return await 分批识别(files, visionModel, visionConfig, userQuestion, maxImagesPerCall);
  }
  
  // 单次识别
  return await 单次识别(files, visionModel, visionConfig, userQuestion);
}

/**
 * 单次识别（不超过maxImagesPerCall张图片）
 */
async function 单次识别(files, visionModel, visionConfig, userQuestion) {
  let prompt = visionConfig.prompt || '请详细描述这张图片的内容。';
  
  // 多图片时优化提示词
  if (files.length > 1) {
    prompt = `请分别描述这${files.length}张图片的内容，格式如下：
第1张图片：[详细描述]
第2张图片：[详细描述]
...

如果图片之间有关联，请在最后说明。

原始提示：${prompt}`;
  }
  
  // 构造识别请求
  const messages = [{
    role: 'user',
    content: prompt + (userQuestion ? `\n\n用户问题：${userQuestion}` : '')
  }];
  
  const body = {
    model: visionModel,
    messages,
    stream: true,
    max_tokens: 1000 + (files.length * 300), // 根据图片数量动态调整
    temperature: 0.3,
    _responsesFiles: files, // 内部文件传递
  };
  
  try {
    const startTime = Date.now();
    const stream = await 调用ChatCompletions(body, {}, { source: 'vision-assist' });
    const state = await 解析ChatSSE(stream);
    const duration = Date.now() - startTime;
    
    日志.info('视觉辅助', `识别完成，耗时 ${duration}ms，结果长度 ${state.content?.length || 0} 字符`);
    
    // 记录统计
    记录识别统计(true, duration, files.length);
    
    // 添加历史记录
    添加识别历史({
      时间: new Date().toISOString(),
      模型: visionModel,
      图片数: files.length,
      文件名: files.map(f => f.name || f.filename || '未知').join(', '),
      耗时: duration,
      成功: true,
      结果摘要: (state.content || '').slice(0, 100) + (state.content?.length > 100 ? '...' : ''),
      完整结果: state.content || '',
    });
    
    return state.content || '[图片识别失败]';
  } catch (err) {
    日志.error('视觉辅助', '识别失败: ' + (err.message || err));
    记录识别统计(false, 0, files.length);
    
    // 添加失败记录
    添加识别历史({
      时间: new Date().toISOString(),
      模型: visionModel,
      图片数: files.length,
      文件名: files.map(f => f.name || f.filename || '未知').join(', '),
      耗时: 0,
      成功: false,
      错误: err.message || '未知错误',
    });
    
    throw err; // 抛出错误供分批识别处理
  }
}

/**
 * 分批识别并聚合结果
 */
async function 分批识别(files, visionModel, visionConfig, userQuestion, maxImagesPerCall) {
  日志.info('视觉辅助', `图片数量 ${files.length} 超过单次限制 ${maxImagesPerCall}，启动分批识别`);
  
  const batches = [];
  for (let i = 0; i < files.length; i += maxImagesPerCall) {
    batches.push(files.slice(i, i + maxImagesPerCall));
  }
  
  日志.info('视觉辅助', `分为 ${batches.length} 批，每批最多 ${maxImagesPerCall} 张`);
  
  const results = [];
  let totalDuration = 0;
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchStart = i * maxImagesPerCall;
    
    try {
      日志.info('视觉辅助', `开始识别第 ${i + 1}/${batches.length} 批（图片 ${batchStart + 1}-${batchStart + batch.length}）`);
      
      const result = await 单次识别(batch, visionModel, visionConfig, i === 0 ? userQuestion : '');
      
      // 添加批次标记
      results.push(`\n【第${i + 1}批：图片${batchStart + 1}-${batchStart + batch.length}】\n${result}`);
      successCount++;
      
    } catch (err) {
      日志.error('视觉辅助', `第 ${i + 1} 批识别失败: ${err.message}`);
      results.push(`\n【第${i + 1}批：图片${batchStart + 1}-${batchStart + batch.length} - 识别失败】\n错误: ${err.message}`);
      failCount++;
    }
  }
  
  // 聚合结果
  const finalResult = `【分批识别结果】共 ${files.length} 张图片，分 ${batches.length} 批识别，成功 ${successCount} 批，失败 ${failCount} 批\n` + results.join('\n');
  
  日志.info('视觉辅助', `分批识别完成，成功 ${successCount}/${batches.length} 批`);
  
  return finalResult;
}

/**
 * 将识别结果注入到消息中
 * @param {Array} messages - 原始消息列表
 * @param {string} 识别结果 - 视觉识别结果
 * @param {Object} config - 配置对象
 * @returns {Array} 处理后的消息列表
 */
function 注入识别结果(messages, 识别结果, config) {
  if (!messages || !Array.isArray(messages)) return messages;
  if (!识别结果) return messages;
  
  const mode = config.mode || 'explicit';
  const position = config.injectPosition || 'separate';
  const showInResponse = config.showInResponse !== false;
  
  const prefix = showInResponse ? '[图片识别辅助] ' : '';
  const 注入内容 = prefix + 识别结果;
  
  if (position === 'separate') {
    // 作为单独的用户消息插入（在最后一条用户消息之前）
    const newMessages = [...messages];
    let lastUserIndex = -1;
    for (let i = newMessages.length - 1; i >= 0; i--) {
      if (newMessages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    
    if (lastUserIndex >= 0) {
      newMessages.splice(lastUserIndex, 0, {
        role: 'user',
        content: 注入内容
      });
    } else {
      // 没有用户消息，追加到最后
      newMessages.push({
        role: 'user',
        content: 注入内容
      });
    }
    
    return newMessages;
  } else if (position === 'append') {
    // 追加到最后一条用户消息
    const newMessages = [...messages];
    for (let i = newMessages.length - 1; i >= 0; i--) {
      if (newMessages[i].role === 'user') {
        const msg = newMessages[i];
        if (typeof msg.content === 'string') {
          msg.content = msg.content + '\n\n' + 注入内容;
        } else if (Array.isArray(msg.content)) {
          msg.content.push({ type: 'text', text: '\n\n' + 注入内容 });
        }
        break;
      }
    }
    return newMessages;
  } else if (position === 'system') {
    // 作为系统消息插入到开头
    return [
      { role: 'system', content: 注入内容 },
      ...messages
    ];
  }
  
  return messages;
}

/**
 * 移除消息中的图片内容
 * @param {Array} messages - 消息列表
 * @returns {Array} 移除图片后的消息列表
 */
function 移除图片内容(messages) {
  if (!messages || !Array.isArray(messages)) return messages;
  
  return messages.map(msg => {
    if (!msg.content) return msg;
    
    if (Array.isArray(msg.content)) {
      // 多模态内容，过滤掉图片
      const filtered = msg.content.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const type = item.type || '';
        return type !== 'image' && type !== 'image_url' && type !== 'input_image';
      });
      
      // 如果过滤后为空，保留一个占位文本
      if (filtered.length === 0) {
        return { ...msg, content: '[图片]' };
      }
      
      return { ...msg, content: filtered };
    }
    
    return msg;
  });
}

/**
 * 主处理函数：为不支持图片的模型添加视觉辅助
 * @param {Object} request - 请求对象
 * @param {Object} modelCaps - 模型能力
 * @returns {Promise<Object>} 处理后的请求对象
 */
async function 处理视觉辅助(request, modelCaps) {
  const files = request._responsesFiles || [];
  
  if (!需要视觉辅助(modelCaps, files)) {
    return request;
  }
  
  日志.info('视觉辅助', '检测到不支持图片的模型，启用视觉辅助');
  
  const 配置 = 运行配置.获取配置();
  const visionConfig = 配置.visionAssist || {};
  
  // 提取用户最后的问题
  let userQuestion = '';
  const messages = request.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      if (typeof content === 'string') {
        userQuestion = content;
      } else if (Array.isArray(content)) {
        const textParts = content.filter(c => c.type === 'text').map(c => c.text);
        userQuestion = textParts.join(' ');
      }
      break;
    }
  }
  
  // 调用视觉模型识别
  const 识别结果 = await 识别图片(files, userQuestion);
  
  // 注入识别结果到消息
  request.messages = 注入识别结果(request.messages, 识别结果, visionConfig);
  
  // 移除图片内容（避免发送给不支持的模型）
  request.messages = 移除图片内容(request.messages);
  request._responsesFiles = [];
  
  日志.debug('视觉辅助', '已注入识别结果并移除图片，消息数: ' + request.messages.length);
  
  return request;
}

module.exports = {
  需要视觉辅助,
  识别图片,
  注入识别结果,
  移除图片内容,
  处理视觉辅助,
  获取统计,
  获取历史,
  清空统计,
};