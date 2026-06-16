const fs = require('fs');
const path = require('path');

/**
 * 安全读取JSON文件
 * @param {string} 文件路径 - 文件完整路径
 * @param {*} 默认值 - 读取失败时的默认返回值
 * @returns {*} 解析后的JSON对象或默认值
 */
function 安全读取JSON(文件路径, 默认值 = null) {
  try {
    if (!fs.existsSync(文件路径)) return 默认值;
    const content = fs.readFileSync(文件路径, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[通用] 读取JSON文件失败 ${文件路径}:`, err.message);
    return 默认值;
  }
}

/**
 * 安全写入JSON文件
 * @param {string} 文件路径 - 文件完整路径
 * @param {*} 数据 - 要写入的数据
 * @param {boolean} 格式化 - 是否格式化输出（默认true）
 * @returns {boolean} 写入是否成功
 */
function 安全写入JSON(文件路径, 数据, 格式化 = true) {
  try {
    const content = 格式化 ? JSON.stringify(数据, null, 2) : JSON.stringify(数据);
    // 确保目录存在
    const dir = path.dirname(文件路径);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(文件路径, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`[通用] 写入JSON文件失败 ${文件路径}:`, err.message);
    return false;
  }
}

/**
 * 安全解析JSON字符串
 * @param {string} 文本 - JSON字符串
 * @param {*} 默认值 - 解析失败时的默认返回值
 * @returns {*} 解析后的对象或默认值
 */
function 安全解析JSON(文本, 默认值 = null) {
  try {
    return JSON.parse(文本);
  } catch {
    return 默认值;
  }
}

/**
 * 安全执行异步函数，自动捕获错误
 * @param {Function} fn - 异步函数
 * @param {string} 操作名称 - 用于错误日志
 * @returns {Promise<[error, result]>} [错误, 结果]元组
 */
async function 安全执行(fn, 操作名称 = '操作') {
  try {
    const result = await fn();
    return [null, result];
  } catch (err) {
    console.error(`[通用] ${操作名称}失败:`, err.message);
    return [err, null];
  }
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function 延迟(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试执行函数
 * @param {Function} fn - 要执行的函数
 * @param {number} 最大次数 - 最大重试次数
 * @param {number} 延迟毫秒 - 重试间隔
 * @returns {Promise<*>} 函数执行结果
 */
async function 重试执行(fn, 最大次数 = 3, 延迟毫秒 = 1000) {
  let lastError;
  for (let i = 0; i < 最大次数; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < 最大次数 - 1) {
        await 延迟(延迟毫秒);
      }
    }
  }
  throw lastError;
}

/**
 * 确保目录存在
 * @param {string} 目录路径 - 目录完整路径
 */
function 确保目录存在(目录路径) {
  if (!fs.existsSync(目录路径)) {
    fs.mkdirSync(目录路径, { recursive: true });
  }
}

/**
 * 格式化字节大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的字符串
 */
function 格式化字节(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = {
  安全读取JSON,
  安全写入JSON,
  安全解析JSON,
  安全执行,
  延迟,
  重试执行,
  确保目录存在,
  格式化字节,
};
