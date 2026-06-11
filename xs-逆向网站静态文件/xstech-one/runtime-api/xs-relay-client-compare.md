# xs-relay 与 XSTECH 原生 ask 桥接逻辑对照

更新时间：2026-05-16
参考来源：
- `xs-relay-reverse/xstech-one/assets-ask-CDJLsZpH.js`
- `xs-relay-reverse/xstech-one/assets-chat-BdBm9oku.js`

## 一、XSTECH 原生 ask 桥接函数实锤

原生桥接函数位于：
- `assets-ask-CDJLsZpH.js`

其中导出的聊天请求函数核心行为为：

1. 使用 `fetch + response.body.getReader()` 读取 SSE
2. 自己实现 SSE 解析器，支持：
   - `data:`
   - `event:`
   - `id:`
   - `retry:`
3. 请求默认地址：
   - `/chat/completions`
4. 请求头实锤：
   - `Authorization`
   - `X-APP-VERSION`
   - 默认 `Content-Type: application/json`
5. `taskId` 来源：
   - `response.headers['X-Chat-Task-Id']`
6. 核心桥接语义：
   - `code === 0 && typeof data === 'string'` → 追加正文
   - `code === 0 && typeof data === 'object'` → 作为 patch 对象回调
   - `code !== 0` → 视为错误并结束
   - `[DONE]` → 正常完成

## 二、XSTECH 原生回调参数语义

原生回调等价于：

```ts
callback(text, isErr, isDone, taskId, patchObject)
```

含义：
- `text`：累计后的完整 AI 文本，不是单纯 delta
- `isErr`：是否错误
- `isDone`：是否完成
- `taskId`：来自响应头 `X-Chat-Task-Id`
- `patchObject`：对象型补丁（可能包含 `aiText/useTokens/promptTokens/completionTokens/contextTokens/userStop` 等）

## 三、xs-relay 已做的等价迁移

### 1. 上游解析器
文件：`src/upstream/client.ts`

已改为：
- `sendUpstreamChat()` 返回 `taskId`
- `parseUpstreamSSE(reader, taskIdFromHeader?)` 支持 header taskId 回退
- `type === 'object'` 不再只当 meta，而是产出：

```ts
{ type: 'patch', patch, usage, taskId }
```

### 2. 路由层消费 patch
文件：`src/routes/api/chat.ts`

已改为：
- 流式模式识别 `patch.aiText`
- 将 `patch.aiText` 与当前 `accumulated` 对比，计算 suffix
- 把 suffix 再翻译成下游 delta 发给第三方客户端
- 非流式模式聚合时也认 `patch.aiText`
- `usage` 从 patch 中同步更新

## 四、为什么这能修“第三方比 xs 页面短”

此前 relay 问题在于：
- object data 被过度简化为 meta
- 第三方客户端只收到 string chunk 的翻译结果
- xs 原生页面还能继续吃 object patch，并更新最终 `aiText`
- relay 没把这部分补回去，就会比 xs 页面短

现在 relay 会：
- 识别 object patch
- 如果 patch 中有完整 `aiText`
- 计算相对于当前 accumulated 的新增 suffix
- 再把这段 suffix 继续以第三方协议 delta 发出去

这样更贴近 xs 原生页面最终可见内容。

## 五、当前仍可继续完善的点

1. patch 除 `aiText` 外的更多字段是否要下发到第三方协议：
   - `userStop`
   - `contextTokens`
   - `promptTokens`
   - `completionTokens`
   - `useTokens`
   - `logs`
   - `replies`
2. `thinking` 当前仍沿用 relay 自己的 `<think>` 解析器，尚未完全证明与 xs HTTP 文本流 100% 一致
3. 仍建议做一次第三方客户端实测，验证：
   - OpenAI Chat
   - OpenAI Responses
   - Claude Messages
   在长回复场景下是否不再提前截断
