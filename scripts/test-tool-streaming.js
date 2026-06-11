const { 工具调用流解析器 } = require('../工具/工具调用流解析器');

console.log('=== 工具调用流式解析测试 ===\n');

const nonce = 'test123';
const parser = new 工具调用流解析器(nonce);

// 模拟上游逐步发送工具调用
const chunks = [
  '这是文本 ',
  '<tool_call:test123 name="read_file">',
  '{"path":',
  '"/tmp/',
  'test.txt"',
  ',"encod',
  'ing":"utf-8"}',
  '</tool_call:test123>',
  ' 继续文本'
];

let totalEvents = 0;
let toolDeltaCount = 0;
let toolDeltaBytes = 0;

chunks.forEach((chunk, i) => {
  console.log(`\n--- Chunk ${i + 1}: "${chunk}" ---`);
  const events = parser.push(chunk);
  events.forEach(event => {
    totalEvents++;
    if (event.type === 'delta') {
      console.log(`  [文本] "${event.text}"`);
    } else if (event.type === 'tool_start') {
      console.log(`  [工具开始] name=${event.name} id=${event.id} index=${event.index}`);
    } else if (event.type === 'tool_delta') {
      toolDeltaCount++;
      toolDeltaBytes += Buffer.byteLength(event.arguments);
      console.log(`  [工具参数增量] index=${event.index} args="${event.arguments}"`);
    } else if (event.type === 'tool_done') {
      console.log(`  [工具结束] index=${event.index}`);
    }
  });
});

const finalEvents = parser.end();
if (finalEvents.length > 0) {
  console.log('\n--- Final flush ---');
  finalEvents.forEach(event => {
    console.log(`  [${event.type}] ${JSON.stringify(event).slice(0, 100)}`);
  });
}

console.log('\n=== 统计 ===');
console.log(`总事件数: ${totalEvents}`);
console.log(`工具参数增量次数: ${toolDeltaCount}`);
console.log(`工具参数总字节: ${toolDeltaBytes}`);
console.log(`预期结果: 参数增量次数 > 1 表示实现了细粒度流式\n`);

if (toolDeltaCount > 1) {
  console.log('✓ 细粒度流式工作正常');
  process.exit(0);
} else {
  console.log('✗ 仍然是一次性下发');
  process.exit(1);
}
