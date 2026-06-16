
const 日志 = require('./工具/日志');
日志.separator('启动');
const 配置 = require('./启动/配置');
const { 验证并报告 } = require('./工具/配置验证');

// 启动时验证配置
if (!验证并报告(配置)) {
  console.error('[启动] 配置验证失败，服务终止');
  process.exit(1);
}

const 运行配置 = require('./服务层/运行配置');
运行配置.初始化();
if (日志.设置级别) 日志.设置级别(配置.日志级别);

process.on('uncaughtException', (err) => {
  日志.error('全局', '未捕获异常: ' + (err.message || String(err)).slice(0, 500));
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    日志.warn('全局', '连接异常（下游或上游断开），继续运行');
  } else {
    日志.error('全局', '严重错误，进程将退出');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  日志.error('全局', '未处理的Promise拒绝: ' + (reason?.message || String(reason)).slice(0, 500));
});
async function 启动() {
  try {
    const 账号池 = require('./服务层/账号池');

    await 账号池.初始化();
    const 模型映射 = require('./服务层/模型映射');
    await 模型映射.初始化({ backgroundRefresh: true });
    const 会话同步 = require('./服务层/会话同步');
    require('./启动/服务启动');

    会话同步.同步云端到本地().catch(err => {
      日志.warn('入口', '后台会话同步失败: ' + (err.message || err));
    });
  } catch (err) { 日志.error('入口', '启动失败: ' + err.message); process.exit(1); }
}
启动();
