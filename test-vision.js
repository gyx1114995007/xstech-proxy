const 运行配置 = require('./服务层/运行配置');
运行配置.初始化();
const 视觉辅助 = require('./工具/视觉辅助');

const testFiles = [{
  mimeType: 'image/png',
  name: 'test.png',
  data: 'data:image/png;base64,iVBORw0...'
}];

const result = 视觉辅助.需要视觉辅助('openai-gpt-oss-120b', {imageInput: false}, testFiles);
console.log('需要视觉辅助:', result);
console.log('配置:', 运行配置.获取配置().visionAssist);
