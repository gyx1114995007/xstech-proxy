const { 工具调用流解析器 } = require('../工具/工具调用流解析器');

console.log('=== 长工具调用流式测试（模拟编程客户端） ===\n');

const nonce = 'abc123';
const parser = new 工具调用流解析器(nonce);

// 模拟一个 edit_file 工具调用，包含长代码
const longCode = `function processData(items) {
  const results = [];
  for (const item of items) {
    if (item.status === 'active') {
      const processed = {
        id: item.id,
        name: item.name,
        timestamp: Date.now(),
        metadata: {
          type: item.type || 'default',
          category: item.category,
          tags: item.tags || []
        }
      };
      results.push(processed);
    }
  }
  return results;
}`;

// 构造完整的工具调用JSON
const toolCall = {
  path: "/src/utils/processor.js",
  old: "// old code here",
  new: longCode
};

const toolCallJson = JSON.stringify(toolCall, null, 2);
console.log(`工具调用JSON长度: ${toolCallJson.length} 字节\n`);

// 将工具调用分成小块模拟流式传输（每块10-30字符）
const fullText = `一些前置文本 <tool_call:abc123 name="edit_file">${toolCallJson}</tool_call:abc123> 后续文本`;

const chunks = [];
let pos = 0;
const chunkSizes = [15, 25, 30, 20, 25, 30, 28, 22, 30, 25, 30, 20, 30, 25, 30, 28, 30, 25, 30, 20];
let sizeIdx = 0;

while (pos < fullText.length) {
  const size = chunkSizes[sizeIdx++ % chunkSizes.length];
  chunks.push(fullText.slice(pos, pos + size));
  pos += size;
}

console.log(`分成 ${chunks.length} 个chunk进行流式传输\n`);

let toolDeltaCount = 0;
let toolDeltaBytes = 0;
let lastDeltaTime = Date.now();
const deltaIntervals = [];

chunks.forEach((chunk, i) => {
  const events = parser.push(chunk);
  events.forEach(event => {
    if (event.type === 'tool_delta') {
      const now = Date.now();
      const interval = now - lastDeltaTime;
      lastDeltaTime = now;
      toolDeltaCount++;
      toolDeltaBytes += Buffer.byteLength(event.arguments);
      deltaIntervals.push(interval);
      console.log(`[Delta ${toolDeltaCount}] ${event.arguments.length} 字节 (间隔 ${interval}ms)`);
      console.log(`  内容片段: ${event.arguments.slice(0, 60).replace(/\n/g, '\\n')}...`);
    } else if (event.type === 'tool_start') {
      console.log(`\n[工具开始] ${event.name}\n`);
      lastDeltaTime = Date.now();
    } else if (event.type === 'tool_done') {
      console.log(`\n[工具结束]\n`);
    }
  });
});

const finalEvents = parser.end();
finalEvents.forEach(event => {
  if (event.type === 'tool_delta') {
    toolDeltaCount++;
    toolDeltaBytes += Buffer.byteLength(event.arguments);
    console.log(`[Final Delta] ${event.arguments.length} 字节`);
  }
});

console.log('\n=== 统计结果 ===');
console.log(`总chunk数: ${chunks.length}`);
console.log(`参数增量次数: ${toolDeltaCount}`);
console.log(`参数总字节: ${toolDeltaBytes}`);
console.log(`JSON原始长度: ${toolCallJson.length}`);
console.log(`平均每次增量: ${Math.round(toolDeltaBytes / toolDeltaCount)} 字节`);
console.log(`增量频率: ${toolDeltaCount}次 / ${chunks.length}个chunk = ${(toolDeltaCount / chunks.length * 100).toFixed(1)}%`);

if (toolDeltaCount >= 5) {
  console.log('\n✓ 细粒度流式效果良好（多次增量传输）');
  console.log('✓ 编程客户端可以实时看到代码片段');
  process.exit(0);
} else {
  console.log('\n✗ 流式颗粒度不足');
  process.exit(1);
}
