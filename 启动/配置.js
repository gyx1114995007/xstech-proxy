require('dotenv').config();
const fs = require('fs');
const path = require('path');

function 加载运行配置() {
  try {
    const 文件路径 = path.join(__dirname, '..', '运行配置.json');
    if (fs.existsSync(文件路径)) {
      const data = JSON.parse(fs.readFileSync(文件路径, 'utf-8'));
      return data.config || {};
    }
  } catch {}
  return {};
}

const 运行配置 = 加载运行配置();
const 运行布尔 = (key, fallback = false) => {
  if (typeof 运行配置[key] === 'boolean') return 运行配置[key];
  return fallback;
};
const 运行字符串 = (key, fallback = '') => {
  const value = 运行配置[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
};
const 运行数字 = (key, fallback) => {
  const value = Number(运行配置[key]);
  return Number.isFinite(value) ? value : fallback;
};

const 配置 = {
  端口: parseInt(process.env.PORT, 10) || 3000,
  主机: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || 'default',
  xstech: {
    基础地址: process.env.XSTECH_BASE_URL || 'https://xstech.one',
    应用版本: process.env.XSTECH_APP_VERSION || '3.1.0',
    账号Token文件路径: process.env.ACCOUNT_TOKEN_FILE || '账号token.json',
    账号列表文件路径: process.env.ACCOUNT_LIST_FILE || '账号列表.json',
    账号列表: JSON.parse(process.env.XSTECH_ACCOUNTS || '[{"account":"","password":""}]'),
    // xs 前端抓包的 /api/chat/completions 带文件请求只包含 files/thinking/webSearch，
    // 默认不额外注入 useImages/useFiles，避免误触发不稳定的视觉链路。
    // 如需恢复旧行为，可设置 XSTECH_SEND_FILE_FLAGS=true。
    发送文件开关字段: 运行布尔('sendFileFlags', String(process.env.XSTECH_SEND_FILE_FLAGS || '').toLowerCase() === 'true'),
  },
  会话池: {
    池大小下限: parseInt(process.env.SESSION_POOL_MIN, 10) || 50,
    池大小上限: parseInt(process.env.SESSION_POOL_MAX, 10) || 1000,
    云端上限: parseInt(process.env.CLOUD_SESSION_MAX || process.env.SESSION_POOL_MAX || '1000', 10),
    同步间隔秒: parseInt(process.env.SESSION_SYNC_MINUTES || '30', 10) * 60,
    缓存同步间隔: 运行数字('sessionCacheSyncIntervalMin', parseInt(process.env.SESSION_CACHE_SYNC_MINUTES || '10', 10)) * 60 * 1000, // 缓存全量同步间隔（毫秒），默认10分钟
    文件路径: '会话池.json',
    默认配置: { contextCount: 0, temperature: 0, presencePenalty: 0, frequencyPenalty: 0, prompt: '', webSearch: false },
  },
  模型刷新间隔秒: parseInt(process.env.MODEL_REFRESH_INTERVAL_SEC, 10) || 1800,
  模型映射文件路径: process.env.MODEL_MAPPING_FILE || '模型映射.json',
  模型价格文件路径: process.env.MODEL_PRICE_FILE || '模型价格.json',
  responses文件上下文: {
    mode: 运行字符串('responsesFileContextMode', process.env.RESPONSES_FILE_CONTEXT_MODE || 'auto'),
    ttlMs: 运行数字('responsesFileContextTtlMs', parseInt(process.env.RESPONSES_FILE_CONTEXT_TTL_MS || '3600000', 10)),
  },
  openai文件提取: {
    // last_user：默认只提取最后一条用户输入里的图片/文件，避免全量上下文客户端反复触发上游识别。
    // all：严格提取完整历史中的所有图片/文件；仍受转换层限制：最多 8 个文件，单文件最大 10MB。
    chatScope: 运行字符串('openaiChatFileScope', process.env.OPENAI_CHAT_FILE_SCOPE || 'last_user'),
    responsesScope: 运行字符串('responsesInputFileScope', process.env.RESPONSES_INPUT_FILE_SCOPE || 'last_user'),
  },
  token提前刷新秒: parseInt(process.env.TOKEN_REFRESH_BEFORE_SEC, 10) || 300,
  token刷新检查间隔秒: parseInt(process.env.TOKEN_REFRESH_CHECK_INTERVAL_SEC, 10) || 60,
  日志级别: process.env.LOG_LEVEL || 运行配置.logLevel || 'INFO',
  误判检测探测模型: 运行配置.censorProbeModel || '',
};
if (!配置.xstech.账号列表.length || !配置.xstech.账号列表[0].account) {
  throw new Error('[配置] 错误');
}
module.exports = 配置;
