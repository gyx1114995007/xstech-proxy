const express = require('express');
const path = require('path');
const 配置 = require('./配置');
const 日志 = require('../工具/日志');
const OpenAI错误 = require('../工具/OpenAI错误');
日志.info('服务启动', '正在加载...');
const 鉴权拦截 = require('../中间件/鉴权拦截');
const 模型列表路由 = require('../路由/模型列表');
const 对话补全路由 = require('../路由/对话补全');
const Responses接口路由 = require('../路由/responses接口');
const Claude消息接口路由 = require('../路由/claude消息接口');
const 调试状态路由 = require('../路由/调试状态');
const 会话同步 = require('../服务层/会话同步');
const 自动签到 = require('../服务层/自动签到');
会话同步.启动();
自动签到.启动();
const 服务启动时间 = Date.now();
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => { 日志.info('HTTP', req.method + ' ' + req.path); next(); });
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'xs-openai-proxy',
    uptimeSec: Math.floor((Date.now() - 服务启动时间) / 1000),
    now: new Date().toISOString(),
  });
});
app.get('/panel', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'control-panel.html'));
});
app.use(鉴权拦截);
app.use('/debug', 调试状态路由);
app.use('/v1', 模型列表路由);
app.use('/v1', 对话补全路由);
app.use('/v1', Responses接口路由);
app.use('/v1', Claude消息接口路由);
app.use((req, res) => {
  OpenAI错误.返回错误(res, 404, {
    message: '未找到',
    type: 'invalid_request_error',
    code: 'not_found',
  });
});
app.use((err, req, res, _next) => {
  日志.error('HTTP', err.message);
  OpenAI错误.返回错误(res, 500, {
    message: '服务器错误',
    type: 'server_error',
    code: 'internal_error',
  });
});
const server = app.listen(配置.端口, 配置.主机, () => {
  日志.info('服务启动', '服务已启动 http://' + 配置.主机 + ':' + 配置.端口);
});

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    日志.error('服务启动', '端口已被占用: ' + 配置.主机 + ':' + 配置.端口 + '。请先停止旧进程，或修改 PORT 环境变量。');
    日志.error('服务启动', '排查命令: ss -ltnp | grep :' + 配置.端口 + ' 或 lsof -i :' + 配置.端口);
  } else {
    日志.error('服务启动', '监听端口失败: ' + (err && err.message || err));
  }
});

module.exports = { app, server, startedAt: 服务启动时间 };
