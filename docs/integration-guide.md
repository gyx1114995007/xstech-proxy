# 接入指南

> **受众**：下游开发者、集成方  
> **用途**：快速接入xs中转站API

---

## 快速开始

### 1. 获取API Key

联系管理员获取 API Key，格式为 `sk-xxx`

### 2. 配置Base URL

```
生产环境：https://nimbushub.zeabur.app
本地环境：http://localhost:3000
```

### 3. 发起第一个请求

```bash
curl https://nimbushub.zeabur.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## API端点速查

### OpenAI Chat Completions

```
POST /v1/chat/completions
GET  /v1/models
```

### OpenAI Responses API

```
POST   /v1/responses
GET    /v1/responses/:id
DELETE /v1/responses/:id
```

### Claude Messages API

```
POST /v1/messages
```

### 调试接口

```
GET /health           # 健康检查
GET /panel            # 控制面板（需鉴权）
GET /v1/models        # 可用模型列表
```

---

## 常用模型

| OpenAI名称 | 说明 |
|-----------|------|
| `gpt-4` | GPT-4 |
| `gpt-4-turbo` | GPT-4 Turbo |
| `gpt-3.5-turbo` | GPT-3.5 Turbo |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |
| `deepseek-v4-flash` | DeepSeek V4 Flash |

完整列表见 `GET /v1/models` 响应。

---

## 错误码

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未授权（API Key无效） |
| 403 | 禁止访问 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
| 502 | 上游服务错误 |
| 504 | 网关超时 |

### 常见错误

| code | message | 原因 | 解决方案 |
|------|---------|------|---------|
| `invalid_api_key` | Invalid API key | API Key无效 | 检查API Key是否正确 |
| `model_not_found` | Model not found | 模型不存在 | 使用 `/v1/models` 查询可用模型 |
| `context_length_exceeded` | Context length exceeded | 上下文过长 | 减少消息数量或内容长度 |
| `rate_limit_exceeded` | Rate limit exceeded | 请求过于频繁 | 降低请求频率 |
| `upstream_error` | Upstream service error | 上游服务错误 | 稍后重试 |
| `session_pool_full` | Session pool full | 会话池已满 | 稍后重试 |

---

## 常见问题

### Q: 支持哪些模型？

A: 通过 `GET /v1/models` 查询实时可用模型列表。

### Q: 是否支持图片输入？

A: 支持。在 `messages[].content` 中使用 `type: 'image_url'`，支持 data URL 和 http/https URL。

### Q: 是否支持工具调用？

A: 支持。使用 `tools` 参数传递工具定义，模型会返回 `tool_calls`。

### Q: 流式输出如何处理？

A: 设置 `stream: true`，响应为 SSE 格式。每行以 `data:` 开头，最后一行为 `data: [DONE]`。

### Q: 如何保持上下文？

A: 
- **Chat Completions**：在 `messages` 数组中包含历史消息
- **Responses API**：使用 `previous_response_id` 引用上一轮响应

### Q: 是否支持OpenAI SDK？

A: 完全支持。设置 `openai.api_base` 为xs中转站地址即可。

```python
import openai
openai.api_key = "sk-your-api-key"
openai.api_base = "https://nimbushub.zeabur.app/v1"
```

---

## 限制

- **文件数量**：最多8个
- **单文件大小**：最大10MB
- **会话上限**：单账号1000个
- **不支持**：OpenAI `file_id`、内置工具（file_search/computer_use）

---

## 技术支持

- **GitHub**：https://github.com/gyx1114995007/xstech-proxy
- **控制面板**：https://nimbushub.zeabur.app/panel
- **健康检查**：https://nimbushub.zeabur.app/health