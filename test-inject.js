const 注入器 = require('./服务层/注入器');

const body = {
  model: 'openai-gpt-oss-120b',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '这是什么图片？' },
        { 
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        }
      ]
    }
  ]
};

注入器.注入(body).then(result => {
  console.log('提取的文件数:', result.files.length);
  console.log('文件详情:', JSON.stringify(result.files, null, 2));
}).catch(err => {
  console.error('注入失败:', err.message);
});
