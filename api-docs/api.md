# API 接口文档

> **说明：** 本文件为 API 接口总文档，每个接口由抓包数据经整理后归档。  
> **更新方式：** 逐条抓包 → 逐条整理 → 按模块/接口名归档。

---

## 目录

1. [接口分类与说明](#接口分类与说明)
2. [接口清单](#接口清单)
3. [附录：抓包原始记录](#附录抓包原始记录)

---

## 接口分类与说明

### 通用格式

每个接口条目包含以下字段：

| 字段 | 说明 |
|------|------|
| 接口名 | 接口名称，如 `用户登录` |
| URL | 完整请求路径 |
| 方法 | GET / POST / PUT / DELETE 等 |
| 请求头 | 关键 Header（如 Content-Type、Authorization 等） |
| 请求参数 | Query / Body / Path 参数结构 |
| 响应格式 | 成功与失败的返回结构 |
| 备注 | 特殊说明、依赖、鉴权方式等 |

---

## 接口清单

---

### 1. 用户登录

| 字段 | 内容 |
|------|------|
| **接口名** | 用户登录 |
| **URL** | `https://xstech.one/api/user/login` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`Content-Type: application/json`<br>`X-APP-VERSION: 3.1.0` |
| **请求参数 (Body JSON)** | `account` (string) — 邮箱/账号<br>`password` (string) — 密码<br>`code` (string) — 验证码（可为空）<br>`captcha` (string) — 图形验证码（可为空）<br>`invite` (string) — 邀请码（可为空）<br>`agreement` (boolean) — 是否同意协议<br>`captchaId` (string) — 验证码ID（可为空） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string) — 提示消息<br>`data.token` (string) — JWT Token<br>`data.email` (string) — 邮箱<br>`data.phone` (string) — 手机号<br>`data.role` (string) — 角色（如 `user`）<br>`data.registerTime` (string) — 注册时间 |
| **备注** | - 响应头中 `X-Server: goamzai-plus/3.1.0` 标识后端服务<br>- 跨域允许来源 `*`<br>- 后续接口需携带 `Authorization: Bearer <token>` 请求头 |

---

### 2. 获取聊天模板（模型列表/配置）

| 字段 | 内容 |
|------|------|
| **接口名** | 获取聊天模板（模型列表/客户端配置） |
| **URL** | `https://xstech.one/api/chat/tmpl` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数** | 无（纯 GET，无 Query 参数） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.defModel` (string) — 默认模型，如 `openai::gpt-5.5`<br>`data.defaultChat` (string) — 默认聊天欢迎语（HTML）<br>`data.genLine` (int) — 生成条数<br>`data.genTitle` (bool) — 是否自动生成标题<br>`data.mFileCount` (int) — 最大文件数<br>`data.mFileSize` (int) — 最大文件大小（MB）<br>`data.mcp` (array) — MCP 配置列表<br>`data.models` (array) — 可用模型列表（每项含 label/value/attr）<br>`data.notice` (string) — 公告<br>`data.p` (bool) — 是否允许<br>`data.plugins` (array\|) — 插件列表<br>`data.providers` (array) — 供应商列表（含 idKey/name/sort）<br>`data.rm` (bool) — 余额是否足够<br>`data.sessionHoverSetting` (bool) — 会话悬浮设置<br>`data.showTokens` (bool) — 是否显示 Token<br>`data.thinkModel` (string) — 思考模型<br>`data.toggleTipTime` (int)<br>`data.tooltipsText` (string)<br>`data.webSearchOpen` (bool) — 联网搜索是否开启 |
| **备注** | - **依赖鉴权**：需携带登录返回的 JWT Token<br>- 返回的 `models` 数组每项包含：`label`（显示名）、`value`（模型ID）、`attr.capabilities`（能力描述：imageInput/anyFile/tools/stream/systemRole 等）、`attr.integral`（消耗积分/免费）<br>- `providers` 数组按 sort 排序，列出所有模型供应商 |

---

### 3. 获取用户信息

| 字段 | 内容 |
|------|------|
| **接口名** | 获取用户信息 |
| **URL** | `https://xstech.one/api/user/info` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数** | 无 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.id` (int) — 用户ID<br>`data.nickname` (string) — 昵称<br>`data.email` (string) — 邮箱<br>`data.phone` (string) — 手机号<br>`data.avatar` (string) — 头像标识<br>`data.hasPassword` (bool) — 是否已设置密码<br>`data.customAvatar` (bool) — 是否自定义头像<br>`data.passkeyCount` (int) — passkey 数量<br>`data.oauthList` (array) — 第三方绑定列表（每项含 `type.name`、`type.tag`、`type.color`、`type.method`、`type.open`、`bind`） |
| **备注** | - **依赖鉴权**<br>- `oauthList` 返回当前支持的第三方绑定方式及是否已绑定 |

---

### 4. 获取公告列表

| 字段 | 内容 |
|------|------|
| **接口名** | 获取公告列表 |
| **URL** | `https://xstech.one/api/notice` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Query)** | `size` (int) — 每页条数<br>`page` (int) — 页码<br>`detail` (string/boolean) — 是否返回详情（`"true"`） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.page` (int) — 当前页码<br>`data.size` (int) — 每页条数<br>`data.search` (string\|) — 搜索关键词<br>`data.asc` (bool) — 是否升序<br>`data.total` (int) — 总记录数<br>`data.pages` (int) — 总页数<br>`data.records` (array) — 公告记录列表 |
| **备注** | - **依赖鉴权**<br>- 当前数据为空（total=0），records 为空数组 |

---

### 5. 获取会话列表

| 字段 | 内容 |
|------|------|
| **接口名** | 获取会话列表 |
| **URL** | `https://xstech.one/api/chat/session` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Query)** | `page` (int) — 页码 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.page` (int) — 当前页码<br>`data.size` (int) — 每页条数（固定30）<br>`data.search` (string\|) — 搜索关键词<br>`data.asc` (bool) — 是否升序<br>`data.total` (int) — 总记录数<br>`data.pages` (int) — 总页数<br>`data.records` (array) — 会话列表，每项包含：<br>&emsp;`id` (int) — 会话ID<br>&emsp;`created` (string) — 创建时间<br>&emsp;`updated` (string) — 更新时间<br>&emsp;`uid` (int) — 用户ID<br>&emsp;`name` (string) — 会话标题<br>&emsp;`model` (string) — 使用的模型<br>&emsp;`maxToken` (int) — 最大Token<br>&emsp;`contextCount` (int) — 上下文条数<br>&emsp;`temperature` (int) — 温度<br>&emsp;`presencePenalty` (int) — 存在惩罚<br>&emsp;`frequencyPenalty` (int) — 频率惩罚<br>&emsp;`prompt` (string) — 系统提示词<br>&emsp;`topSort` (int) — 置顶排序<br>&emsp;`icon` (string) — 图标<br>&emsp;`plugins` (array\|) — 插件列表<br>&emsp;`mcp` (array\|) — MCP配置<br>&emsp;`webSearch` (bool) — 是否联网搜索<br>&emsp;`localPlugins` (array\|) — 本地插件<br>&emsp;`useAppId` (int) — 关联应用ID |
| **备注** | - **依赖鉴权**<br>- 默认每页30条，不分页时为固定30<br>- 会话记录中 `contextCount` 表示该会话的上下文条数 |

---

### 6. 获取会话消息记录

| 字段 | 内容 |
|------|------|
| **接口名** | 获取会话消息记录（历史消息） |
| **URL** | `https://xstech.one/api/chat/record/{sessionId}` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Path + Query)** | `sessionId` (int, path) — 会话ID<br>`page` (int, query) — 页码 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.page` (int) — 当前页码<br>`data.size` (int) — 每页条数（固定10）<br>`data.search` (string\|) — 搜索关键词<br>`data.asc` (bool) — 是否升序<br>`data.total` (int) — 总记录数<br>`data.pages` (int) — 总页数<br>`data.records` (array) — 消息列表，每项包含：<br>&emsp;`id` (int) — 消息记录ID<br>&emsp;`created` (string) — 创建时间<br>&emsp;`updated` (string) — 更新时间<br>&emsp;`sessionId` (int) — 所属会话ID<br>&emsp;`recordType` (string) — 记录类型（如 `"message"`）<br>&emsp;`userText` (string) — 用户消息原文<br>&emsp;`aiText` (string) — AI回复原文（含Markdown）<br>&emsp;`uid` (int) — 用户ID<br>&emsp;`ip` (string) — 用户IP<br>&emsp;`taskId` (string) — 任务ID<br>&emsp;`model` (string) — 使用的模型<br>&emsp;`deductCount` (int) — 扣除次数<br>&emsp;`refundCount` (int) — 退款次数<br>&emsp;`promptTokens` (int) — 提示Token数<br>&emsp;`completionTokens` (int) — 生成Token数<br>&emsp;`contextTokens` (int) — 上下文Token数<br>&emsp;`useTokens` (int) — 总使用Token数<br>&emsp;`useImages` (array\|) — 使用的图片<br>&emsp;`useFiles` (array\|) — 使用的文件<br>&emsp;`useAppId` (int) — 关联应用ID<br>&emsp;`appendDeductCount` (int)<br>&emsp;`userStop` (bool) — 用户是否主动停止 |
| **备注** | - **依赖鉴权**<br>- 默认每页10条<br>- `userText` 和 `aiText` 可能包含长文本<br>- Token消耗明细（promptTokens / completionTokens / contextTokens / useTokens）可用于计费统计 |

---

### 7. 更新会话

| 字段 | 内容 |
|------|------|
| **接口名** | 更新会话（修改会话信息） |
| **URL** | `https://xstech.one/api/chat/session/{id}` |
| **方法** | PUT |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`Content-Type: application/json`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Path + Body JSON)** | `id` (int, path) — 会话ID<br>Body: 会话完整对象（与 GET 会话列表返回的 records 项同结构） |
| **成功响应 (code=0)** | 返回更新后的完整会话对象，与 GET 会话记录的 records 项结构一致 |
| **备注** | - **依赖鉴权**<br>- 此接口实际为“全量更新”而非“增量更新”，需传入完整会话对象 |

---

### 8. 聊天补全（SSE 流式）

| 字段 | 内容 |
|------|------|
| **接口名** | 聊天补全（流式对话） |
| **URL** | `https://xstech.one/api/chat/completions` |
| **方法** | POST |
| **请求头** | `Content-Type: application/json`<br>`Accept: text/event-stream`（SSE）<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Body JSON)** | `text` (string) — 用户消息<br>`sessionId` (int) — 会话ID<br>`files` (array) — 文件列表，每项包含：<br>&emsp;`name` (string) — 文件名<br>&emsp;`data` (string) — 文件数据（base64 编码，支持图片如 `data:image/jpeg;base64,...`）<br>&emsp;可为空数组 `[]`<br>`thinking` (bool) — 是否启用思考<br>`webSearch` (bool) — 是否联网搜索 |
| **响应格式** | SSE (Server-Sent Events)，事件流格式：<br>`data: {json chunk}`<br>...<br>`data: [DONE]` |
| **备注** | - **依赖鉴权**<br>- **响应为流式 SSE**，请求头需指定 `Accept: text/event-stream`<br>- `Content-Type: application/json` 仍需保留在请求头中（同时存在两个Accept形式）<br>- 每条 `data:` 行是一个 JSON chunk，`[DONE]` 标记结束 |

---

### 9. 批量删除会话

| 字段 | 内容 |
|------|------|
| **接口名** | 批量删除会话 |
| **URL** | `https://xstech.one/api/chat/session/batch` |
| **方法** | DELETE |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Query)** | `ids[]` (array) — 要删除的会话ID数组，如 `ids[]=96150&ids[]=96213` |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`data` () — 返回 null<br>`msg` (string) — 提示消息（通常为空） |
| **备注** | - **依赖鉴权**<br>- 参数名直接为 `ids[]` 而非标准 JSON 数组<br>- 删除成功返回 `data: null`<br>- 此操作为**不可逆删除** |

---

### 10. 删除单个会话

| 字段 | 内容 |
|------|------|
| **接口名** | 删除单个会话 |
| **URL** | `https://xstech.one/api/chat/session/{id}` |
| **方法** | DELETE |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Path)** | `id` (int) — 要删除的会话ID |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`data` () — 返回 null<br>`msg` (string) |
| **备注** | - **依赖鉴权**<br>- 与 `/api/chat/session/batch` 不同，此处为删除单个会话<br>- 删除成功返回 `data: null`<br>- 此操作为**不可逆删除** |

---

### 11. 获取用户套餐/积分计划列表

| 字段 | 内容 |
|------|------|
| **接口名** | 获取用户套餐/积分计划列表 |
| **URL** | `https://xstech.one/api/user_plan` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Query)** | `page` (int) — 页码 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.page` (int) — 当前页码<br>`data.size` (int) — 每页条数（固定10）<br>`data.total` (int) — 总记录数<br>`data.pages` (int) — 总页数<br>`data.records` (array) — 套餐列表，每项包含：<br>&emsp;`id` (int) — 计划ID<br>&emsp;`created` (string) — 创建时间<br>&emsp;`updated` (string) — 更新时间<br>&emsp;`name` (string) — 套餐名称（如 `"10万积分"`、`"签到福利（20260603）"`）<br>&emsp;`total` (int) — 总积分<br>&emsp;`use` (int) — 已使用积分<br>&emsp;`usable` (int) — 剩余可用积分<br>&emsp;`eachDay` (bool) — 是否每日刷新<br>&emsp;`lastResetTime` (string) — 上次重置时间<br>&emsp;`isExpire` (bool) — 是否已过期<br>&emsp;`expire` (string) — 过期时间<br>&emsp;`type` (string) — 类型<br>&emsp;`eachDayInterval` (int) — 每日刷新间隔 |
| **备注** | - **依赖鉴权**<br>- 当前数据：共 32 条，分 4 页<br>- 可用/已用/总计积分构成积分体系的消费记录 |

---

### 12. 获取套餐模板

| 字段 | 内容 |
|------|------|
| **接口名** | 获取套餐模板 |
| **URL** | `https://xstech.one/api/user_plan/template` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数** | 无 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`data` (object) — 空对象 `{}`<br>`msg` (string) |
| **备注** | - **依赖鉴权**<br>- 当前数据为空（返回空对象 `{}`），可能为后台管理配置接口，普通用户无数据 |

---

### 13. 获取签到记录

| 字段 | 内容 |
|------|------|
| **接口名** | 获取签到记录（按月查询） |
| **URL** | `https://xstech.one/api/gift_sign` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Query)** | `year` (int) — 年份<br>`month` (int) — 月份 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data` (array) — 签到记录列表，每项包含：<br>&emsp;`id` (int) — 记录ID<br>&emsp;`created` (string) — 创建时间<br>&emsp;`updated` (string) — 更新时间<br>&emsp;`uid` (int) — 用户ID<br>&emsp;`ymd` (string) — 签到日期（如 `"20260603"`）<br>&emsp;`integral` (int) — 获得积分<br>&emsp;`signDate` (string) — 签到具体时间 |
| **备注** | - **依赖鉴权**<br>- 按年/月查询，无记录则返回空数组 |

---

### 14. 签到打卡

| 字段 | 内容 |
|------|------|
| **接口名** | 签到打卡（每日签到） |
| **URL** | `https://xstech.one/api/gift_sign` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数** | 无（空 Body） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.id` (int) — 签到记录ID<br>`data.created` (string) — 创建时间<br>`data.updated` (string) — 更新时间<br>`data.uid` (int) — 用户ID<br>`data.ymd` (string) — 签到日期（如 `"20260604"`）<br>`data.integral` (int) — 获得积分（固定 20）<br>`data.signDate` (string) — 签到具体时间 |
| **备注** | - **依赖鉴权**<br>- 无请求体，直接 POST 即可<br>- 每次签到获得 20 积分<br>- 签到后会在 `user_plan` 中生成一条对应日期的"签到福利"计划 |

---

### 15. 获取商品列表

| 字段 | 内容 |
|------|------|
| **接口名** | 获取商品列表（积分套餐商品） |
| **URL** | `https://xstech.one/api/product` |
| **方法** | GET |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数** | 无 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.aq` (string\|) — 待定<br>`data.buyProtocol` (string) — 购买协议（HTML内容）<br>`data.defaultMethod` (string) — 默认支付方式（如 `"ALIPAY"`）<br>`data.list` (array) — 积分套餐列表，每项包含：<br>&emsp;`id` (int) — 商品ID<br>&emsp;`name` (string) — 商品名（如 `"10万积分"`）<br>&emsp;`description` (string) — 描述（HTML）<br>&emsp;`price` (float) — 原价<br>&emsp;`expireDay` (int) — 有效期（999999 ≈ 永久）<br>&emsp;`integral` (int) — 包含积分数量<br>&emsp;`eachDay` (bool) — 是否每日刷新<br>&emsp;`eachDayInterval` (int)<br>&emsp;`sort` (int) — 排序<br>&emsp;`discount` (float) — 折扣<br>&emsp;`available` (bool) — 是否可购买<br>&emsp;`finalPrice` (float) — 最终价格<br>`data.notice` (string) — 公告/提示（HTML，含客服联系方式）<br>`data.payMethods` (array) — 支持的支付方式，每项含 `label`/`value`/`icon` |
| **备注** | - **依赖鉴权**<br>- 当前商品共 7 个套餐，价格区间 ¥15.9 ~ ¥11,999，积分区间 10万 ~ 1亿<br>- 支持支付宝（ALIPAY）和微信支付（EASY-wxpay） |

---

### 16. 创建订单（购买商品）

| 字段 | 内容 |
|------|------|
| **接口名** | 创建订单/购买商品 |
| **URL** | `https://xstech.one/api/order/buy` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`Content-Type: application/json`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Body JSON)** | `method` (string) — 支付方式，如 `"EASY-wxpay"`（微信）或 `"ALIPAY"`<br>`productId` (int) — 商品ID<br>`openid` (object) — 微信openid（可为 `{}`） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.qrcode` (string) — 二维码（可能为空）<br>`data.orderId` (int) — 订单ID<br>`data.orderNo` (string) — 订单号<br>`data.payUrl` (string) — 支付链接<br>`data.platformOrderId` (string) — 平台订单ID<br>`data.payMethod` (string) — 支付方式<br>`data.tips` (string) — 提示信息<br>`data.showFootBtn` (bool) — 是否显示"我已支付完成"按钮<br>`data.method` (string) — 支付方式类型（如 `"url"`）<br>`data.attr` (object\|) — 附加属性 |
| **备注** | - **依赖鉴权**<br>- 创建订单后会返回支付链接 `payUrl`，用于跳转支付页面<br>- 支付完成后需点击"我已支付完成"确认 |

---

### 17. 取消订单

| 字段 | 内容 |
|------|------|
| **接口名** | 取消订单（未支付订单） |
| **URL** | `https://xstech.one/api/order/pay/cancel/{orderNo}` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Path)** | `orderNo` (string) — 订单号（非订单ID） |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.id` (int) — 订单ID<br>`data.created` (string) — 创建时间<br>`data.updated` (string) — 更新时间<br>`data.uid` (int) — 用户ID<br>`data.no` (string) — 订单号<br>`data.payMethod` (string) — 支付方式<br>`data.amount` (float) — 金额<br>`data.status` (string) — 状态（如 `"WAIT"` 等待支付）<br>`data.productId` (int) — 商品ID<br>`data.payTime` (string\|) — 支付时间<br>`data.name` (string) — 商品名称<br>`data.buyerId` (string)<br>`data.platformOrderId` (string) — 平台订单ID<br>`data.ip` (string) — 用户IP |
| **备注** | - **依赖鉴权**<br>- 取消后订单状态变为 `"WAIT"`（等待支付→已取消）<br>- 使用订单号（orderNo）而非订单ID |

---

### 18. 创建新会话

| 字段 | 内容 |
|------|------|
| **接口名** | 创建新会话 |
| **URL** | `https://xstech.one/api/chat/session` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`Content-Type: application/json`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Body JSON)** | `model` (string) — 使用的模型（如 `"openai::gpt-5.5"`）<br>`plugins` (array) — 插件列表（可为空数组）<br>`mcp` (array) — MCP 配置列表（可为空数组）<br>`webSearch` (bool) — 是否开启联网搜索 |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data.id` (int) — 新会话ID<br>`data.created` (string) — 创建时间<br>`data.updated` (string) — 更新时间<br>`data.uid` (int) — 用户ID<br>`data.name` (string) — 会话标题（默认 `"新对话"`）<br>`data.model` (string) — 使用的模型<br>`data.maxToken` (int)<br>`data.contextCount` (int) — 上下文条数（默认20）<br>`data.temperature` (float)<br>`data.presencePenalty` (float)<br>`data.frequencyPenalty` (float)<br>`data.prompt` (string)<br>`data.topSort` (int)<br>`data.icon` (string)<br>`data.plugins` (array)<br>`data.mcp` (array)<br>`data.webSearch` (bool)<br>`data.localPlugins` (array\|)<br>`data.useAppId` (int) |
| **备注** | - **依赖鉴权**<br>- 与 GET 会话列表返回的 records 项结构一致 |

---

### 19. 清空会话上下文

| 字段 | 内容 |
|------|------|
| **接口名** | 清空会话上下文（清除对话记忆） |
| **URL** | `https://xstech.one/api/chat/context-clear/{sessionId}` |
| **方法** | POST |
| **请求头** | `Accept: application/json, text/plain, */*`<br>`X-APP-VERSION: 3.1.0`<br>`Authorization: Bearer <token>` |
| **请求参数 (Path)** | `sessionId` (int) — 要清空上下文的会话ID |
| **成功响应 (code=0)** | `code` (int) — 0 表示成功<br>`msg` (string)<br>`data` (object) — 与消息记录 records 项同结构，记录了一条 `context_clear` 类型消息：<br>&emsp;`id` (int) — 记录ID<br>&emsp;`sessionId` (int) — 会话ID<br>&emsp;`recordType` (string) — `"context_clear"`<br>&emsp;`userText` (string) — `"<!-- context-clear -->"`（清空标记）<br>&emsp;`aiText` (string) — 空字符串<br>&emsp;`uid` (int) — 用户ID<br>&emsp;`ip` (string) — 用户IP<br>&emsp;其余 Token 字段均为 0 |
| **备注** | - **依赖鉴权**<br>- 清空操作会在会话消息记录中生成一条 `recordType="context_clear"` 的记录<br>- `userText` 内容为 `"<!-- context-clear -->"`，用作清空标记<br>- 清空后会话的对话上下文被重置 |

---

## 附录：抓包原始记录

### 1. 用户登录

**Request:**
```json
POST https://xstech.one/api/user/login

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-APP-VERSION": "3.1.0"
}

Body:
{
  "account": "1114995007@qq.com",
  "password": "Gyx.1114995007",
  "code": "",
  "captcha": "",
  "invite": "",
  "agreement": true,
  "captchaId": ""
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "email": "1114995007@qq.com",
    "phone": "18067481838",
    "role": "user",
    "registerTime": "2025-12-18 15:58:24"
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Credentials: true`

### 2. 获取聊天模板

**Request:**
```
GET https://xstech.one/api/chat/tmpl

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200) — 数据概要:**
```json
{
  "code": 0,
  "data": {
    "defModel": "openai::gpt-5.5",
    "defaultChat": "<p>您好，我是AI助手...</p>",
    "genLine": 3,
    "genTitle": true,
    "mFileCount": 8,
    "mFileSize": 10,
    "mcp": [],
    "models": [
      {"label": "GPT-OSS-120b", "value": "openai::openai/gpt-oss-120b", "attr": {"integral": "免费", "capabilities": {"imageInput": false, "anyFile": false, "tools": true, "stream": true, "systemRole": true}}},
      {"label": "GPT-5.4", "value": "openai::gpt-5.4", "attr": {"integral": "1积分", "capabilities": {"imageInput": true}}},
      {"label": "GPT-5.4(支持文件)", "value": "openai::gpt-5.4-file", "integral": "100积分"},
      {"label": "GPT-5.5", "value": "openai::gpt-5.5", "integral": "1积分"},
      {"label": "Claude Opus 4.8", "value": "anthropic::claude-opus-4-8", "integral": "1积分"},
      {"label": "Claude Opus 4.7", "value": "anthropic::claude-opus-4-7", "integral": "1积分"},
      {"label": "Claude-Opus-4.6", "value": "anthropic::claude-opus-4-6", "integral": "1积分"},
      {"label": "Claude-Sonnet-4.6", "value": "anthropic::claude-sonnet-4-6", "integral": "1积分"},
      {"label": "Gemini-3.5-Flash", "value": "google::gemini-3.5-flash", "integral": "1积分"},
      {"label": "Gemini-3.1-Pro", "value": "google::gemini-3.1-pro-preview", "integral": "1积分"},
      {"label": "Grok-4.2", "value": "Grok::grok-4.20", "integral": "1积分"},
      {"label": "Grok-4.20-Multi-Agent-Xhigh", "value": "Grok::grok-4.20-multi-agent-xhigh", "integral": "1积分"},
      {"label": "Grok-4.3", "value": "Grok::grok-4.3-high", "integral": "1积分"},
      {"label": "Llama-4-Scout", "value": "Llama::meta-llama/llama-4-scout-17b-16e-instruct", "integral": "免费"},
      {"label": "Deepseek-V4-Flash", "value": "deepseek::deepseek-v4-flash", "integral": "免费"},
      {"label": "Deepseek-V4-Pro", "value": "deepseek::deepseek-v4-pro", "integral": "免费"},
      {"label": "Qwen-3.7-Max", "value": "Qwen::qwen3.7-max-preview-thinking", "integral": "免费"},
      {"label": "Qwen-3.7-Plus", "value": "Qwen::qwen3.7-plus-preview-thinking", "integral": "免费"},
      {"label": "Kimi-K2.6", "value": "Kimi::kimi-k2.6", "integral": "1积分"},
      {"label": "MiniMax-M2.7", "value": "MiniMax::MiniMax-M2.7", "integral": "1积分"},
      {"label": "Doubao-seed-2.0-Pro", "value": "doubao::doubao-seed-2-0-pro", "integral": "免费"},
      {"label": "GLM-5.1", "value": "zhipu::GLM-5.1", "integral": "免费"},
      {"label": "Glm-5", "value": "zhipu::glm-5", "integral": "免费"},
      {"label": "Mimo-V2.5-Pro", "value": "Xiaomi::mimo-v2.5-pro", "integral": "免费"},
      {"label": "GPT语音对话", "value": "realtime::gpt-realtime-mini", "integral": "10000积分"}
    ],
    "notice": "",
    "p": true,
    "plugins": null,
    "providers": [
      {"idKey": "openai", "name": "OpenAI", "sort": 13},
      {"idKey": "anthropic", "name": "Anthropic", "sort": 12},
      {"idKey": "google", "name": "Google Gemini", "sort": 11},
      {"idKey": "Grok", "name": "Grok", "sort": 10},
      {"idKey": "Llama", "name": "Llama", "sort": 9},
      {"idKey": "deepseek", "name": "DeepSeek", "sort": 8},
      {"idKey": "Qwen", "name": "Qwen", "sort": 7},
      {"idKey": "Kimi", "name": "Kimi", "sort": 6},
      {"idKey": "MiniMax", "name": "MiniMax", "sort": 5},
      {"idKey": "doubao", "name": "豆包", "sort": 4},
      {"idKey": "zhipu", "name": "智谱GLM", "sort": 3},
      {"idKey": "Xiaomi", "name": "Xiaomi", "sort": 2},
      {"idKey": "realtime", "name": "语音通话", "sort": 1}
    ],
    "rm": true,
    "sessionHoverSetting": true,
    "showTokens": false,
    "thinkModel": "deepseek::deepseek-v4-pro",
    "toggleTipTime": 3,
    "tooltipsText": "",
    "webSearchOpen": true
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 4. 获取公告列表

**Request:**
```
GET https://xstech.one/api/notice?size=3&page=1&detail=true

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "page": 1,
    "size": 3,
    "search": null,
    "asc": false,
    "total": 0,
    "pages": 0,
    "records": []
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 5. 获取会话列表

**Request:**
```
GET https://xstech.one/api/chat/session?page=1

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200) — 数据概要:**
```json
{
  "code": 0,
  "data": {
    "page": 1,
    "size": 30,
    "search": null,
    "asc": false,
    "total": 17,
    "pages": 1,
    "records": [
      {
        "id": 96213,
        "created": "2026-06-04 09:07:30",
        "updated": "2026-06-04 09:08:22",
        "uid": 23756,
        "name": "新对话",
        "model": "anthropic::claude-opus-4-8",
        "maxToken": 0,
        "contextCount": 65,
        "temperature": 0,
        "presencePenalty": 0,
        "frequencyPenalty": 0,
        "prompt": "",
        "topSort": 0,
        "icon": "",
        "plugins": [],
        "mcp": [],
        "webSearch": false,
        "localPlugins": null,
        "useAppId": 0
      }
    ]
  },
  "msg": ""
}
```
> 注：records 数组完整包含 17 条记录，此处仅展示第1条作为结构示例。实际响应中有 17 条会话，使用模型包括 claude-opus-4-8、deepseek-v4-pro、gpt-5.5、gpt-5.4、gemini-3.1-pro、mimo-v2.5 等。

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 9. 批量删除会话

**Request:**
```
DELETE https://xstech.one/api/chat/session/batch?ids[]=96150&ids[]=96213

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": null,
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 10. 删除单个会话

**Request:**
```
DELETE https://xstech.one/api/chat/session/96008

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": null,
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 11. 获取用户套餐/积分计划列表

**Request:**
```
GET https://xstech.one/api/user_plan?page=1

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200) — 数据概要:**
```json
{
  "code": 0,
  "data": {
    "page": 1,
    "size": 10,
    "search": null,
    "asc": false,
    "total": 32,
    "pages": 4,
    "records": [
      {
        "id": 84525,
        "created": "2026-03-29 19:07:22",
        "updated": "2026-06-04 09:10:21",
        "name": "10万积分",
        "total": 100000,
        "use": 2625,
        "usable": 97375,
        "eachDay": false,
        "lastResetTime": "2026-03-29 19:07:22",
        "isExpire": false,
        "expire": "4764-02-23 19:07:22",
        "type": "",
        "eachDayInterval": 0
      },
      {
        "id": 87193,
        "created": "2026-06-03 11:32:43",
        "updated": "2026-06-03 22:12:56",
        "name": "签到福利（20260603）",
        "total": 20,
        "use": 20,
        "usable": 0,
        "eachDay": false,
        "lastResetTime": "2026-06-03 11:32:43",
        "isExpire": false,
        "expire": "2026-06-04 11:32:43",
        "type": "",
        "eachDayInterval": 0
      }
    ]
  },
  "msg": ""
}
```
> 注：完整 records 共 10 条（第1页），含 1 条 10 万积分主套餐 + 多条签到福利（20积分/条）。共 32 条，分 4 页。

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 12. 获取套餐模板

**Request:**
```
GET https://xstech.one/api/user_plan/template

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {},
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 13. 获取签到记录

**Request:**
```
GET https://xstech.one/api/gift_sign?year=2026&month=6

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": [
    {
      "id": 56184,
      "created": "2026-06-03 11:32:43",
      "updated": "2026-06-03 11:32:43",
      "uid": 23756,
      "ymd": "20260603",
      "integral": 20,
      "signDate": "2026-06-03 11:32:43"
    }
  ],
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 14. 签到打卡

**Request:**
```
POST https://xstech.one/api/gift_sign

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 56220,
    "created": "2026-06-04 10:14:05",
    "updated": "2026-06-04 10:14:05",
    "uid": 23756,
    "ymd": "20260604",
    "integral": 20,
    "signDate": "2026-06-04 10:14:05"
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 15. 获取商品列表

**Request:**
```
GET https://xstech.one/api/product

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200) — 数据概要:**
```json
{
  "code": 0,
  "data": {
    "aq": null,
    "buyProtocol": "<p>...购买协议HTML...</p>",
    "defaultMethod": "ALIPAY",
    "list": [
      {"id": 15, "name": "10万积分", "price": 15.9, "finalPrice": 15.9, "integral": 100000, "expireDay": 999999, "available": true},
      {"id": 16, "name": "50万积分", "price": 75.9, "finalPrice": 75.9, "integral": 500000, "expireDay": 999999, "available": true},
      {"id": 17, "name": "100万积分", "price": 139, "finalPrice": 139, "integral": 1000000, "expireDay": 999999, "available": true},
      {"id": 18, "name": "500万积分", "price": 659, "finalPrice": 659, "integral": 5000000, "expireDay": 999999, "available": true},
      {"id": 19, "name": "1000万积分", "price": 1299, "finalPrice": 1299, "integral": 10000000, "expireDay": 999999, "available": true},
      {"id": 20, "name": "5000万积分", "price": 5999, "finalPrice": 5999, "integral": 50000000, "expireDay": 999999, "available": true},
      {"id": 21, "name": "1亿积分", "price": 11999, "finalPrice": 11999, "integral": 100000000, "expireDay": 999999, "available": true}
    ],
    "notice": "<p>...客服联系方式...</p>",
    "payMethods": [
      {"label": "支付宝", "value": "ALIPAY", "icon": "fab fa-alipay"},
      {"label": "微信", "value": "EASY-wxpay", "icon": "fab fa-weixin"}
    ]
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`

### 16. 创建订单（购买商品）

**Request:**
```
POST https://xstech.one/api/order/buy

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}

Body:
{
  "method": "EASY-wxpay",
  "productId": 15,
  "openid": {}
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "qrcode": "",
    "orderId": 2725,
    "orderNo": "2062357554717003776",
    "payUrl": "http://xspay.xstech.one/Pay/console/H202606041015326455",
    "platformOrderId": "",
    "payMethod": "EASY-wxpay",
    "tips": "请在新窗口内完成支付，若支付完成请点击【我已支付完成】完成购买",
    "showFootBtn": true,
    "method": "url",
    "attr": null
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`

### 17. 取消订单

**Request:**
```
POST https://xstech.one/api/order/pay/cancel/2062357554717003776

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 2725,
    "created": "2026-06-04 10:15:32",
    "updated": "2026-06-04 10:15:33",
    "uid": 23756,
    "no": "2062357554717003776",
    "payMethod": "EASY-wxpay",
    "amount": 15.9,
    "status": "WAIT",
    "productId": 15,
    "payTime": null,
    "name": "10万积分",
    "buyerId": "",
    "platformOrderId": "H202606041015326455",
    "ip": "172.70.46.8"
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`

### 18. 创建新会话

**Request:**
```
POST https://xstech.one/api/chat/session

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}

Body:
{
  "model": "openai::gpt-5.5",
  "plugins": [],
  "mcp": [],
  "webSearch": false
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 96220,
    "created": "2026-06-04 10:20:23",
    "updated": "2026-06-04 10:20:23",
    "uid": 23756,
    "name": "新对话",
    "model": "openai::gpt-5.5",
    "maxToken": 0,
    "contextCount": 20,
    "temperature": 0,
    "presencePenalty": 0,
    "frequencyPenalty": 0,
    "prompt": "",
    "topSort": 0,
    "icon": "",
    "plugins": [],
    "mcp": [],
    "webSearch": false,
    "localPlugins": null,
    "useAppId": 0
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`

### 19. 清空会话上下文

**Request:**
```
POST https://xstech.one/api/chat/context-clear/96122

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 983713,
    "created": "2026-06-04 10:21:10",
    "updated": "2026-06-04 10:21:10",
    "sessionId": 96122,
    "recordType": "context_clear",
    "userText": "<!-- context-clear -->",
    "aiText": "",
    "uid": 23756,
    "ip": "172.70.46.8",
    "taskId": "",
    "model": "",
    "deductCount": 0,
    "refundCount": 0,
    "promptTokens": 0,
    "completionTokens": 0,
    "contextTokens": 0,
    "useTokens": 0,
    "useImages": null,
    "useFiles": null,
    "useAppId": 0,
    "appendDeductCount": 0,
    "userStop": false
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`

### 7. 更新会话

**Request:**
```
PUT https://xstech.one/api/chat/session/96122

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}

Body:
{
  "id": 96122,
  "created": "2026-06-03 04:37:31",
  "updated": "2026-06-03 16:15:11",
  "uid": 23756,
  "name": "新对话",
  "model": "Deepseek-V4-Flash",
  "maxToken": 0,
  "contextCount": 65,
  "temperature": 0.2,
  "presencePenalty": 0.2,
  "frequencyPenalty": 0.7,
  "prompt": "",
  "topSort": 0,
  "icon": "",
  "plugins": null,
  "mcp": null,
  "webSearch": false,
  "localPlugins": null,
  "useAppId": 0
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 96122,
    "created": "2026-06-03 04:37:31",
    "updated": "2026-06-03 16:15:11",
    "uid": 23756,
    "name": "新对话",
    "model": "Deepseek-V4-Flash",
    "maxToken": 0,
    "contextCount": 65,
    "temperature": 0.2,
    "presencePenalty": 0.2,
    "frequencyPenalty": 0.7,
    "prompt": "",
    "topSort": 0,
    "icon": "",
    "plugins": null,
    "mcp": null,
    "webSearch": false,
    "localPlugins": null,
    "useAppId": 0
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 3. 获取用户信息

**Request:**
```
GET https://xstech.one/api/user/info

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200):**
```json
{
  "code": 0,
  "data": {
    "id": 23756,
    "nickname": "爱大哥",
    "email": "1114995007@qq.com",
    "phone": "18067481838",
    "avatar": "b1",
    "hasPassword": true,
    "customAvatar": true,
    "passkeyCount": 0,
    "oauthList": [
      {
        "type": {
          "name": "微信",
          "alias": "",
          "tag": "wechat",
          "color": "#51aa38",
          "icon": "",
          "method": "qrcode",
          "open": true
        },
        "bind": false
      }
    ]
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置

### 6. 获取会话消息记录

**Request:**
```
GET https://xstech.one/api/chat/record/96213?page=1

Headers:
{
  "Accept": "application/json, text/plain, */*",
  "X-APP-VERSION": "3.1.0",
  "Authorization": "Bearer <token>"
}
```

**Response (200) — 数据概要:**
```json
{
  "code": 0,
  "data": {
    "page": 1,
    "size": 10,
    "search": null,
    "asc": false,
    "total": 2,
    "pages": 1,
    "records": [
      {
        "id": 983661,
        "created": "2026-06-04 09:10:10",
        "updated": "2026-06-04 09:10:21",
        "sessionId": 96213,
        "recordType": "message",
        "userText": "（用户消息原文，此处省略长内容）",
        "aiText": "（AI回复原文，含Markdown，此处省略长内容）",
        "uid": 23756,
        "ip": "104.23.170.52",
        "taskId": "2062341102467289088",
        "model": "Claude Opus 4.8",
        "deductCount": 1,
        "refundCount": 0,
        "promptTokens": 2155,
        "completionTokens": 967,
        "contextTokens": 1129,
        "useTokens": 3122,
        "useImages": null,
        "useFiles": null,
        "useAppId": 0,
        "appendDeductCount": 0,
        "userStop": false
      }
    ]
  },
  "msg": ""
}
```

**Response Headers (关键):**
- `Content-Type: application/json; charset=utf-8`
- `X-Server: goamzai-plus/3.1.0`
- 与登录接口相同的跨域配置
