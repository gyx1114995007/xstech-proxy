# xs中转站 · xstech OpenAI 兼容代理

`xs中转站` 是一个将 `xstech.one` 上游能力适配为 OpenAI / Claude 兼容 API 的 Node.js 服务，当前支持 OpenAI Chat Completions 老接口、OpenAI Responses 新接口，以及 Claude Messages 基础接口。

## 当前版本

- 版本：`0.4.0`
- 阶段：全面优化与增强版，新增链路追踪、工具参数细粒度流式、误判检测优化、控制面板增强、零宽字符乱码修复、防崩溃机制、Claude接口思考展示与工具调用修复等多项核心功能
- 默认端口：`3000`

## 已支持接口

### OpenAI Chat Completions

```text
POST /v1/chat/completions
GET  /v1/models
```

支持能力：

- 文本对话
- 流式与非流式返回
- OpenAI 消息格式转换
- 图片 / 文件输入提取并转发到 xstech `files`
- tool calls 基础兼容
- OpenAI 风格错误输出

### OpenAI Responses API

```text
POST   /v1/responses
GET    /v1/responses/:id
DELETE /v1/responses/:id
```

支持能力：

- `input: string`
- `input: message[]`
- `instructions`
- `previous_response_id` 上下文恢复
- `function_call` / `function_call_output` 兼容
- `input_image` / `input_file` 转 xstech 文件格式
- 流式与非流式 Responses 输出

### Claude Messages API

```text
POST /v1/messages
```

支持能力：

- Claude `messages` 文本输入
- Claude `image` base64 / url 输入转 xstech `files`
- Claude `document` / `file` base64 / url 输入转 xstech `files`
- Claude `tool_result` 转内部 Chat `tool` 消息
- Claude 请求中的 `tool_use` 历史块转内部 Chat `tool_calls`
- `system` 转系统消息
- `max_tokens` / `temperature` / `top_p` / `stop_sequences` 基础参数透传
- Claude `tools` / `tool_choice` 到 OpenAI Chat tools 的基础转换
- Anthropic 风格错误结构：`{ "type": "error", "error": { ... } }`
- 非流式 Claude `message` 输出
- 流式 Claude SSE 输出：
  - `message_start`
  - `content_block_start`
  - `content_block_delta`
  - `content_block_stop`
  - `message_delta`
  - `message_stop`
- 基础 `tool_use` 输出映射
- 自动剥离上游 `<think>...</think>` 思考片段，避免污染 Claude 文本块

## xstech 文件请求适配说明

根据 xstech 前端真实抓包，带文件请求的 `/api/chat/completions` body 默认只发送：

```json
{
  "text": "...",
  "sessionId": "...",
  "files": [],
  "thinking": false,
  "webSearch": false
}
```

因此本项目默认不额外注入：

- `useImages`
- `useFiles`

这样可避免部分模型（如 `deepseek-v4-flash`）误触发上游不稳定视觉链路。若确需恢复旧行为，可设置：

```env
XSTECH_SEND_FILE_FLAGS=true
```

## 快速开始

```bash
npm install
npm start
```

服务启动后：

```text
http://127.0.0.1:3000/health
http://127.0.0.1:3000/panel
```

## 环境变量

参考 `.env.example`：

```env
PORT=3000
HOST=0.0.0.0
API_KEY=sk-your-secret-key-here
XSTECH_ACCOUNTS='[{"account":"your@email.com","password":"your-password"}]'
XSTECH_BASE_URL=https://xstech.one
XSTECH_APP_VERSION=3.1.0
XSTECH_SEND_FILE_FLAGS=false
```

## 回归测试

```bash
npm run smoke
```

当前 smoke 覆盖：

- `/health`
- `/panel`
- `/debug/status`
- `/debug/config`
- `/debug/files/health`
- `/debug/deploy/status`
- `/debug/metrics/trend`
- `/debug/events/stats`
- `/debug/logs/recent`
- `/v1/models`
- `/v1/responses` 参数错误
- `/v1/responses/:id` not found
- `/v1/messages` 参数错误
- Claude 转换层多模态与 `tool_result` 回归

最近回归结果：

```text
服务端 JS 语法检查：通过
npm run smoke：14/14 通过
/v1/chat/completions：deepseek-v4-flash 文本非流式 200
/v1/responses：deepseek-v4-flash 文本非流式 200
/v1/messages：deepseek-v4-flash 文本非流式 200，Claude message 输出正常
/v1/messages stream=true：Claude SSE 事件包含 message_start/content_block_delta/message_stop
deepseek-v4-flash 带图：已确认可正常回复，行为与 xstech 前端一致
```

## 主要目录

```text
启动/       配置加载
路由/       OpenAI / Claude 兼容接口与调试接口
服务层/     账号池、会话池、请求转发、模型映射等
工具/       协议转换、SSE 解析、日志、Responses 存储、Claude 转换等
scripts/    自动化 smoke test
api-docs/   抓包与接口参考
```

## 已知限制

- OpenAI `file_id` 暂不支持，文件输入建议使用 data URL 或 http/https URL。
- OpenAI 内置工具如 `file_search` / `computer_use` / `web_search_preview` 暂不等价实现。
- `deepseek-v4-flash` 在 xstech 前端可上传图片但通常不识别图片内容；本项目默认对齐该行为。
- Claude Messages 已支持图片/文件输入与 `tool_result` 基础回合映射；复杂真实 Claude SDK 多工具连续调用、细粒度流式工具参数兼容仍建议继续观察。
