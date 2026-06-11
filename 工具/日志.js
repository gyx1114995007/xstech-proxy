const 配置 = require('../启动/配置');
const fs = require('fs');
const path = require('path');

const 级别权重 = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

let 当前级别 = String(配置.日志级别 || 'INFO').toUpperCase();
let 当前级别权重 = 级别权重[当前级别] || 0;

const 颜色 = { DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', 重置: '\x1b[0m', 灰色: '\x1b[90m' };
const 日志目录 = path.join(__dirname, '..', 'logs');

function 时间戳() {
  const now = new Date();
  const Y = now.getFullYear(), M = String(now.getMonth() + 1).padStart(2, '0'), D = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0'), s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return { ts: Y + '-' + M + '-' + D + ' ' + h + ':' + m + ':' + s + '.' + ms, date: Y + '-' + M + '-' + D };
}

function 输出到终端(级别, 模块名, 消息) {
  const { ts } = 时间戳();

  const line = '[' + 级别.padEnd(5) + '] [' + 模块名 + '] ' + 消息;

  console.log(颜色.灰色 + '[' + ts + ']' + 颜色.重置 + ' ' + 颜色[级别] + '[' + 级别.padEnd(5) + ']' + 颜色.重置 + ' ' + 颜色.灰色 + '[' + 模块名 + ']' + 颜色.重置 + ' ' + 消息);
  输出到文件('运行', 'runtime', line);
}

function 输出到文件(子目录, 文件名, 内容) {
  try {
    const { date, ts } = 时间戳();
    const dir = path.join(日志目录, 子目录, date);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, date + '-' + 文件名 + '.log'), '[' + ts + '] ' + 内容 + '\n', 'utf-8');
  } catch {}
}

function 设置级别(level) {
  const next = String(level || 'INFO').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(级别权重, next)) return 当前级别;
  当前级别 = next;
  当前级别权重 = 级别权重[next];
  配置.日志级别 = next;
  return 当前级别;
}

function 获取级别() {
  return 当前级别;
}

const log = {
  设置级别,
  获取级别,
  info(模块名, 消息) { if (当前级别权重 > 1) return; 输出到终端('INFO', 模块名, 消息); },

  warn(模块名, 消息) { if (当前级别权重 > 2) return; 输出到终端('WARN', 模块名, 消息); },
  error(模块名, 消息) { if (当前级别权重 > 3) return; 输出到终端('ERROR', 模块名, 消息); },

  debug(模块名, 消息) { if (当前级别权重 > 0) return; 输出到终端('DEBUG', 模块名, 消息); },
  separator(模块名) { if (当前级别权重 > 0) return; const { ts } = 时间戳(); console.log(颜色.灰色 + '[' + ts + ']' + 颜色.重置 + ' ' + 颜色.灰色 + '--- ' + 模块名 + ' ---' + 颜色.重置); },
  // 文件日志（分类）
  记录原始(消息) { 输出到文件('会话', 'raw', 消息); },
  记录下发(消息) { 输出到文件('下发', 'forward', 消息); },
  记录请求(消息) { 输出到文件('请求', 'request', 消息); },
  记录误判(消息) { 输出到文件('误判', 'censor', 消息); },
  记录链路(消息) { 输出到文件('链路', 'trace', 消息); },
};
module.exports = log;
