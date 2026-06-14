const { 工具调用流解析器 } = require('./工具/工具调用流解析器');

const nonce = 'test123';
const parser = new 工具调用流解析器(nonce);

// 模拟 xs 返回的内容：思考 + 答案
const text = '<think>1+1等于2</think>\n\n2';

const events = parser.push(text);
const endEvents = parser.end();

console.log('=== 推送事件 ===');
events.forEach(e => console.log(JSON.stringify(e)));

console.log('\n=== 结束事件 ===');
endEvents.forEach(e => console.log(JSON.stringify(e)));

const allText = events.filter(e => e.type === 'delta').map(e => e.text).join('');
const endText = endEvents.filter(e => e.type === 'delta').map(e => e.text).join('');

console.log('\n=== 结果 ===');
console.log('推送阶段输出:', JSON.stringify(allText));
console.log('结束阶段输出:', JSON.stringify(endText));
console.log('总输出:', JSON.stringify(allText + endText));
