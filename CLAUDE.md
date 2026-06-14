# CLAUDE.md — AI 协作规则手册

> **项目：** xs中转站 · xstech OpenAI 兼容代理  
> **受众：** AI（Claude/Codex/其他）下次会话  
> **用途：** 项目规则、架构速查、红线警示

---

## 项目边界规则

### ✅ 允许的操作

- 修改 `启动/`、`工具/`、`服务层/`、`路由/`、`中间件/` 下的业务代码
- 新增路由、工具模块、服务层模块
- 修改 `public/control-panel.html` 控制面板
- 修改配置文件：`.env`、`运行配置.json`
- 修改规则文件：`误判词.json`、`模型流错误规则.json`
- 更新文档：`README.md`、`项目进度.md`、`docs/`

### ❌ 禁止的操作

- **禁止修改会话池数据结构**：`会话池.json` 的 `{ 账号会话: { accountKey: { model: [{ id, 创建时间 }] } } }` 结构是稳定的，不要改
- **禁止破坏账号池 Token 管理**：`账号token.json` 由系统自动维护，不要手动改
- **禁止删除关键 JSONL 文件**：`事件日志.jsonl`、`运行配置历史.jsonl`、`响应历史.jsonl`、`Responses文件上下文.jsonl` 是运行时数据，不能删除
- **禁止在生产环境直接测试危险操作**：删除账号、清空会话池、重置配置等操作必须先在本地验证

---

## 核心架构速查

### 数据流

```
客户端请求
  ↓
鉴权拦截（Bearer API Key）
  ↓
路由层（/v1/chat/completions | /v1/responses | /v1/messages）
  ↓
注入器（误判词预替换 + 工具调用提示词注入）
  ↓
会话池（分配/复用会话，支持跨模型切换）
  ↓
账号池（带Token重试，自动登录/刷新）
  ↓
请求转发（xstech上游API调用）
  ↓
流式转换（xstech SSE → OpenAI/Claude SSE）
  ↓
客户端响应
```

### 模块职责

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| **启动** | 配置加载、服务启动 | `启动/配置.js`、`启动/服务启动.js` |
| **路由** | API端点、请求处理 | `路由/对话补全.js`、`路由/responses接口.js`、`路由/claude消息接口.js` |
| **服务层** | 账号池、会话池、请求转发、模型映射 | `服务层/账号池.js`、`服务层/会话池.js`、`服务层/请求转发.js` |
| **工具** | 协议转换、流式解析、误判检测 | `工具/流式转换.js`、`工具/误判检测.js`、`工具/Claude转Chat.js` |
| **中间件** | 鉴权拦截 | `中间件/鉴权拦截.js` |

---

## 环境变量速查

### 必需变量

```env
API_KEY=sk-your-secret-key-here          # 中转站API Key
XSTECH_ACCOUNTS='[{"account":"...","password":"..."}]'  # xstech账号列表
```

### 可选变量

```env
PORT=3000                                 # 服务端口
HOST=0.0.0.0                              # 监听地址
XSTECH_BASE_URL=https://xstech.one       # xstech基础URL
XSTECH_APP_VERSION=3.1.0                  # xstech应用版本
XSTECH_SEND_FILE_FLAGS=false              # 是否发送useImages/useFiles字段

# 会话池配置
SESSION_POOL_MIN=50                       # 会话池最小上限
SESSION_POOL_MAX=1000                     # 会话池最大上限
SESSION_SYNC_MINUTES=30                   # 会话同步间隔（分钟）
SESSION_CACHE_SYNC_MINUTES=10             # 缓存同步间隔（分钟）

# Token刷新配置
TOKEN_REFRESH_BEFORE_SEC=300              # Token提前刷新窗口（秒）
TOKEN_REFRESH_CHECK_INTERVAL_SEC=60       # Token检查间隔（秒）

# 模型刷新
MODEL_REFRESH_INTERVAL_SEC=1800           # 模型刷新间隔（秒）

# 文件提取范围
OPENAI_CHAT_FILE_SCOPE=last_user          # OpenAI Chat文件提取范围：last_user | all
RESPONSES_INPUT_FILE_SCOPE=last_user      # Responses文件提取范围：last_user | all

# Responses文件上下文
RESPONSES_FILE_CONTEXT_MODE=auto          # 文件上下文重放模式：auto | always | never
RESPONSES_FILE_CONTEXT_TTL_MS=3600000     # 文件上下文TTL（毫秒）

# 日志
LOG_LEVEL=INFO                            # 日志级别：DEBUG | INFO | WARN | ERROR
```

---

## 关键命令速查

### 服务管理

```bash
# 启动服务
npm start                    # 或 node index.js

# 停止服务
pkill -9 -f 'node index.js'

# 重启服务
pkill -9 -f 'node index.js' ; sleep 2 ; nohup node index.js > /tmp/xs-proxy.out 2>&1 &

# 查看日志
tail -f /tmp/xs-proxy.out

# 健康检查
curl http://localhost:3000/health
```

### 测试验证

```bash
# 语法检查
node -c 服务层/会话池.js
find 启动 工具 中间件 服务层 路由 scripts -name '*.js' -exec node -c {} \;

# 自动化smoke test
npm run smoke

# 单元测试（如果有）
npm test
```

### Git操作

```bash
# 查看状态
git status

# 提交变更
git add -A
git commit -m "feat: 功能描述"

# 推送到GitHub
git push origin master

# 查看最近提交
git log --oneline -5
```

---

## 会话池关键规则

### 会话对象缓存机制

**重要：** 会话池现在有完整的缓存机制，**必须**使用缓存API，不要直接构造会话对象。

```javascript
// ✅ 正确：获取完整会话对象
const 完整会话 = await 会话池.获取完整会话对象(accountKey, sessionId);
完整会话.model = newModel;  // 修改字段
await 请求转发.更新会话(token, 完整会话);
会话池.更新缓存(sessionId, 完整会话);  // 更新缓存

// ❌ 错误：直接构造不完整对象
await 请求转发.更新会话(token, { 
  id: sessionId, 
  model: newModel 
  // 缺少 created、uid、updated 等必需字段！
});
```

### 会话池配置

- 会话按**模型**分池：`池[accountKey][model] = [会话1, 会话2, ...]`
- 会话归还时**保持当前模型不变**
- 下游传了 temperature/presence_penalty/frequency_penalty 时，归还后恢复默认参数
- `contextCount` 固定保持 `0`

### 缓存同步

- **启动时**：异步全量同步，预热缓存
- **运行时**：每次 `获取会话()` 时检查是否需要定期同步（默认10分钟）
- **智能同步**：只更新 `updated` 字段有变化的会话
- **手动操作**：可调用 `会话池.清空缓存()` 强制刷新

---

## 协议转换策略

### 核心原则

**不重构现有 `/v1/chat/completions` 核心执行链路**。

所有新接口（Responses、Claude Messages）都作为**协议翻译层**：

```
外部协议请求
  → 翻译成 OpenAI Chat Completions 请求
  → 内部调用现有 /v1/chat/completions
  → 解析 Chat SSE
  → 翻译回外部协议响应格式
```

### 文件处理统一规则

1. **data URL**：直接进入 xstech `files[].data`
2. **http/https URL**：中转层下载后转成 data URL
3. **OpenAI file_id**：明确返回 `unsupported_file_id`
4. **文件提取范围**：默认 `last_user`，避免重复识别历史图片

---

## 误判词规避

### 规避方式

在误判词字符间插入**零宽空格** `U+200B`

### 触发条件

**唯一触发条件：** `code=1` 且 `err` 包含 `您的提交内容包含不允许的文本`

其他 `code=1`（如 `上游异常提示(HttpCode:429)`）**不是**误判词。

### 检测流程

1. 第一块返回误判错误
2. 触发 `工具/误判检测.js`
3. 四级递进检测：重叠分段 → 细分段 → 句级 → 词级
4. 找到误判词后写入 `误判词.json`
5. 对原始 text 做零宽空格规避
6. 主请求静默重试

---

## 踩坑警示

### ⚠️ 会话更新必须传完整对象

**症状**：xstech API返回 400/500，提示缺少必需字段

**原因**：`PUT /api/chat/session/{id}` 需要完整的会话对象（id, created, uid, name, model, ...）

**修复**：先调用 `会话池.获取完整会话对象()`，修改字段，再更新

### ⚠️ 配置保存用深度合并

**症状**：前端保存部分配置后，其他配置丢失

**原因**：浅合并 `{ ...当前配置, ...patch }` 会覆盖整个嵌套对象

**修复**：`服务层/运行配置.js` 已实现深度合并，不要改回浅合并

### ⚠️ xstech 文件请求不包含 useImages/useFiles

**症状**：`deepseek-v4-flash` 上传图片时返回 524/ETIMEDOUT

**原因**：默认不发送 `useImages/useFiles` 字段，避免误触发不稳定视觉链路

**配置**：如需恢复旧行为，设置 `XSTECH_SEND_FILE_FLAGS=true`

### ⚠️ 正则表达式歧义

**症状**：`i is not defined` 错误

**原因**：正则 `/^data:image\\//i` 的 `/i` 被错误解析为标志位

**修复**：使用 `startsWith('data:image/')` 代替正则

---

## 深入文档指针表

| 主题 | 位置 |
|------|------|
| **项目完整开发历史** | `项目进度.md`（2444行，完整记忆档案） |
| **架构说明** | `docs/architecture.md` |
| **API接入指南** | `docs/integration-guide.md` |
| **运维手册** | `docs/runbook.md` |
| **xstech上游API参考** | `api-docs/api.md` |
| **代码示例** | `scripts/smoke-test.js` |

---

## 下次会话检查清单

在开始修改代码前，快速检查：

- [ ] 是否需要修改会话对象？→ 使用 `获取完整会话对象()`
- [ ] 是否需要保存配置？→ 确认使用深度合并
- [ ] 是否新增路由？→ 在 `启动/服务启动.js` 注册
- [ ] 是否修改环境变量？→ 更新 `.env.example` 和本文档
- [ ] 是否修改核心逻辑？→ 先运行 `npm run smoke` 回归测试
- [ ] 是否重大功能更新？→ 在 `项目进度.md` 添加新节点
