
const express = require('express');
const 模型映射 = require('../服务层/模型映射');
const 日志 = require('../工具/日志');
const OpenAI错误 = require('../工具/OpenAI错误');
const router = express.Router();
router.get('/models', async (req, res) => {
  try {
    const models = 模型映射.getModels();
    日志.info('模型列表', '返回 ' + models.length + ' 个模型');
    res.json({ object: 'list', data: models });
  } catch (err) {
    日志.error('模型列表', '获取失败: ' + err.message);
    OpenAI错误.返回错误(res, 500, {
      message: '获取模型列表失败',
      type: 'server_error',
      code: 'model_list_failed',
    });
  }
});
module.exports = router;
