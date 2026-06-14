# 架构说明

> **受众**：开发者、维护者  
> **用途**：理解系统设计、数据流、核心机制

---

## 系统概览

xs中转站是一个将 xstech.one 上游能力适配为标准 OpenAI/Claude 兼容 API 的 Node.js 中间层服务。

### 核心价值

- **协议标准化**：将 xstech 私有协议转换为业界标准的 OpenAI/Claude API
- **会话管理**：自动化会话池管理，支持跨模型复用
- **误判规避**：自动检测并规避上游内容审核误判
- **多账号支持**：账号池管理，自动 Token 刷新

---

## 数据流

### 请求处理流程

```
客户端
  ↓ Bearer Token
[鉴权拦截] ← API_KEY 验证
  ↓
[路由层] ← /v1/chat/completions | /v1/responses | /v1/messages
  ↓
[注入器]
  ├─ 误判词预替换（零宽空格）
  ├─ 工具调用提示词注入（nonce + XML）
  └─ 文件提取转换（data URL）
  ↓
[会话池]
  ├─ 优先复用空闲会话
  ├─ 跨模型切换（获取完整会话对象 → 修改 model → 更新）
  ├─ 会话对象缓存（Map<sessionId, {data, cachedAt}>）
  └─ 无空闲时创建新会话
  ↓
[账号池]
  ├─ 轮询选择账号
  ├─ Token 过期自动刷新
  └─ 失败重试（最多3次）
  ↓
[请求转发] ← POST /api/chat/completions
  ↓
xstech.one 上游
  ↓ SSE 流式响应
[流式转换]
  ├─ 解析 xstech SSE
  ├─ 转换为 OpenAI/Claude SSE
  ├─ 工具调用识别（nonce XML → tool_calls）
  ├─ 误判检测（第一块 code=1 → 四级递进检测）
  └─ 思考内容过滤（Claude <think> 标签）
  ↓
客户端
```

### 会话对象缓存机制

```
会话池缓存 Map
  ├─ Key: sessionId (String)
  └─ Value: {
       data: 完整会话对象 {
         id, created, updated, uid, name, model,
         temperature, contextCount, ...
       },
       cachedAt: 时间戳
     }

缓存更新时机：
  1. 创建新会话 → 立即缓存
  2. 模型切换 → 更新缓存
  3. 归还重置 → 更新缓存
  4. 启动时 → 异步全量同步（预热）
  5. 运行时 → 定期同步（10分钟，智能增量更新）
```

---

## 模块职责

### 启动层（`启动/`）

**配置.js**
- 加载环境变量（.env）
- 定义默认配置
- 导出统一配置对象

**服务启动.js**
- 初始化 Express 应用
- 注册中间件、路由
- 启动 HTTP 服务器
- 启动后台任务（账号池、会话同步、模型刷新、自动签到）

### 路由层（`路由/`）

**对话补全.js** - `/v1/chat/completions`
- OpenAI Chat Completions 主接口
- 支持 stream=true/false
- 文件能力校验
- 图片/文件输入提取
- 临时修改参数（获取完整会话 → 修改 → 更新 → 刷新缓存）

**responses接口.js** - `/v1/responses`
- OpenAI Responses API
- 协议翻译层：Responses → Chat → 解析 → Responses
- previous_response_id 上下文链
- function_call 工具回合
- 文件上下文短期保存

**claude消息接口.js** - `/v1/messages`
- Claude Messages API
- 协议翻译层：Claude → Chat → 解析 → Claude
- 思考内容过滤（<think> 标签）
- tool_use/tool_result 映射

**调试状态.js** - `/debug/*`
- 控制面板后端接口
- 账号管理、会话管理、配置管理
- 运维接口、日志查询、事件中心

### 服务层（`服务层/`）

**账号池.js**
- 多账号管理
- 自动登录
- Token 刷新（提前5分钟）
- 健康评分（连续失败计数）
- 带 Token 重试（最多3次）

**会话池.js**
- 按账号、模型分池
- 会话分配与归还
- 跨模型切换（缓存 + API）
- **会话对象缓存机制**：
  - 获取完整会话对象()
  - 更新缓存()
  - 全量同步会话配置()
  - 检查并执行定期同步()
- 动态扩容（50 → 1000）
- 云端同步（30分钟）

**请求转发.js**
- 封装所有 xstech 上游 API 调用
- 统一超时/重试策略
- 错误摘要
- API列表：
  - 对话补全、创建会话、更新会话、获取会话列表、获取会话详情
  - 登录、刷新Token、获取用户信息
  - 模型列表、签到、积分商品、订单管理

**模型映射.js**
- OpenAI 模型名称 ↔ xstech 模型 value
- 模型能力缓存（imageInput, anyFile）
- 自动刷新（30分钟）
- 本地缓存（模型映射.json, 模型价格.json）

**运行配置.js**
- 持久化运行配置（运行配置.json）
- **深度合并**更新（不覆盖嵌套对象）
- 配置变更历史（运行配置历史.jsonl）
- 运行时应用（无需重启）

**会话同步.js**
- 定时同步云端会话到本地池（30分钟）
- 清理云端孤立会话
- 上限管理（1000个）

**注入器.js**
- 误判词预替换（零宽空格）
- 工具调用提示词注入（nonce + 伪XML）
- OpenAI 请求规范化
- 文件提取（_responsesFiles, _upstreamFiles）

### 工具层（`工具/`）

**流式转换.js**
- xstech SSE → OpenAI SSE
- 工具调用流解析（nonce XML → delta.tool_calls）
- finish_reason 映射

**Claude转Chat.js / Chat转Claude.js**
- Claude Messages ↔ Chat Completions 协议转换
- 思考内容过滤
- tool_use/tool_result 映射

**Responses转Chat.js / Chat转Responses.js**
- Responses ↔ Chat Completions 协议转换
- function_call 映射
- previous_response_id 上下文链

**误判检测.js**
- 四级递进检测：重叠分段 → 细分段 → 句级 → 词级
- 独立会话探测（不污染主会话）
- 自动保存规则（误判词.json）

**ChatSSE解析.js**
- 解析 Chat Completions SSE
- 聚合 delta 文本与 tool_calls
- 支持 stream=false 聚合返回

**工具调用流解析器.js**
- nonce 伪XML解析
- 识别开始标签、增量、结束标签
- JSON 边界安全检测

**Responses存储.js**
- 响应本地存储（响应历史.jsonl）
- 内存索引（快速查询）
- 上下文链构建

**模型能力校验.js**
- 文件能力前置校验
- 图片：imageInput=true 或 anyFile=true
- 普通文件：anyFile=true
- 文件数量、大小限制

**日志.js**
- 终端流程日志（带颜色）
- 分类文件日志（会话/下发/误判/请求）
- 日志级别（DEBUG/INFO/WARN/ERROR）
- 运行时切换级别

**事件中心.js**
- 事件记录（事件日志.jsonl）
- 事件类型：config_update, account_add, model_price_change, order_created, ...
- 事件筛选、统计

### 中间件（`中间件/`）

**鉴权拦截.js**
- Bearer Token 验证
- API_KEY 校验
- 401/403 错误响应

---

## 核心机制

### 会话对象缓存

**问题**：每次操作会话（切换模型、重置参数）都需要调用 API 获取完整会话对象（500ms），遍历分页列表效率低。

**解决**：
```javascript
// 缓存结构
const 会话对象缓存 = new Map(); // sessionId -> { data, cachedAt }

// 获取会话对象（优先缓存）
async function 获取完整会话对象(accountKey, sessionId) {
  if (会话对象缓存.has(sessionId)) {
    return 会话对象缓存.get(sessionId).data; // 命中缓存，0ms
  }
  const 完整会话 = await 请求转发.获取会话详情(token, sessionId); // 未命中，500ms
  更新缓存(sessionId, 完整会话);
  return 完整会话;
}

// 全量同步（智能增量更新）
async function 全量同步会话配置(accountKey) {
  // 遍历所有分页
  for (let page = 1; page <= totalPages; page++) {
    for (const sess of pageData.records) {
      const cached = 会话对象缓存.get(sess.id);
      // 只更新有变化的会话（基于 updated 字段）
      if (!cached || cached.data.updated !== sess.updated) {
        会话对象缓存.set(sess.id, { data: sess, cachedAt: Date.now() });
      }
    }
  }
}
```

**性能提升**：
- API调用量：-80%
- 会话操作耗时：500ms → 0ms（缓存命中）

### 配置深度合并

**问题**：前端保存部分配置时，浅合并 `{ ...当前配置, ...patch }` 会覆盖整个嵌套对象。

**解决**：
```javascript
function 深度合并(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = 深度合并(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function 更新(patch = {}, meta = {}) {
  当前配置 = 标准化(深度合并(当前配置, patch)); // 深度合并
  写文件();
  记录历史('update', before, 获取配置(), meta);
  return 获取状态();
}
```

### 误判词规避

**触发条件**：第一块 SSE 返回 `code=1` 且 `err` 包含 `您的提交内容包含不允许的文本`

**检测流程**：
1. 重叠分段（50%重叠，每段100字）
2. 细分段（每段20字）
3. 句级（按标点切分）
4. 词级（中文按字，英文按token，双字组合探测）

**规避方式**：在误判词字符间插入零宽空格 `U+200B`

**下次请求**：注入器预替换已知误判词，0 额外请求

### 协议翻译层

**设计原则**：不重构现有 `/v1/chat/completions` 核心链路。

**实现方式**：
```
外部协议请求（Responses/Claude）
  → 翻译成 Chat Completions 请求
  → 内部调用 /v1/chat/completions
  → 解析 Chat SSE
  → 翻译回外部协议响应
```

**优势**：
- 复用账号池、会话池、模型映射、误判检测
- 降低新接口风险
- 对外支持 stream=false，内部统一 stream=true

---

## 数据模型

### 会话对象

```javascript
{
  id: 98272,                       // 会话ID
  created: "2026-06-14 12:13:02",  // 创建时间
  updated: "2026-06-14 13:39:54",  // 更新时间
  uid: 23756,                      // 用户ID
  name: "会话标题",
  model: "openai::gpt-5.5",        // 模型
  maxToken: 4096,
  contextCount: 0,                 // 上下文轮数（固定0）
  temperature: 0,
  topP: 0,
  presencePenalty: 0,
  frequencyPenalty: 0,
  prompt: "",
  webSearch: false,
  plugins: null,
  useAppId: 0
}
```

### 账号对象

```javascript
{
  key: "acc_0",           // 账号标识
  account: "user@email.com",
  password: "password",
  enabled: true,          // 启用状态
  token: "eyJ...",        // JWT Token
  tokenExpires: "2026-06-20T07:50:11.000Z",
  health: {
    score: 100,
    consecutiveFailures: 0,
    lastFailureAt: null
  }
}
```

### 模型映射

```javascript
{
  "openai-gpt-5.5": {            // OpenAI 名称
    value: "openai::gpt-5.5",    // xstech value
    name: "GPT-5.5",
    provider: "openai",
    capabilities: {
      imageInput: true,          // 支持图片输入
      anyFile: true              // 支持任意文件
    },
    pricing: {
      integral: 500              // 积分价格
    }
  }
}
```

---

## 部署架构

### 本地开发

```
Android Termux
  └─ Node.js v18+
      └─ xs中转站
          ├─ 监听 0.0.0.0:3000
          ├─ 日志 /tmp/xs-proxy.out
          └─ 数据文件 ./
```

### 生产环境（Zeabur）

```
GitHub Repo (gyx1114995007/xstech-proxy)
  ↓ Auto Deploy
Zeabur K8s Pod
  ├─ 监听 0.0.0.0:8080
  ├─ 日志 stdout → Zeabur Logs
  ├─ 数据文件 /app/
  └─ 公网访问 nimbushub.zeabur.app
```

---

## 扩展性

### 新增 API 接口

1. 创建翻译层：`工具/新协议转Chat.js`, `工具/Chat转新协议.js`
2. 创建路由：`路由/新协议接口.js`
3. 注册路由：`启动/服务启动.js`
4. 添加 smoke test：`scripts/smoke-test.js`

### 新增上游 API

1. 在 `服务层/请求转发.js` 添加函数
2. 使用统一的 `上游请求()` 封装
3. 错误处理、超时、重试

### 新增配置项

1. 在 `.env.example` 添加说明
2. 在 `启动/配置.js` 读取并设置默认值
3. 在 `CLAUDE.md` 环境变量表更新
4. 如需运行时可改，在 `运行配置.json` 添加

---

## 性能指标

| 指标 | 数值 |
|------|------|
| 启动时间 | ~3秒（包含缓存预热） |
| 健康检查响应 | <10ms |
| 会话分配（缓存命中） | <1ms |
| 会话分配（未命中） | ~500ms |
| 流式首字时间 | 取决于上游（通常1-3秒） |
| 误判检测 | 5-30秒（独立会话，不阻塞） |
| Token 刷新 | ~200ms |
| 模型列表刷新 | ~500ms |

---

## 已知限制

- OpenAI `file_id` 暂不支持
- OpenAI 内置工具（file_search/computer_use）暂不实现
- `deepseek-v4-flash` 可上传图片但通常不识别内容
- 会话上限：单账号最多1000个
- 文件限制：最多8个，单文件最大10MB