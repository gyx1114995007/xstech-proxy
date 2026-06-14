# 运维手册

> **受众**：运维人员、管理员  
> **用途**：部署、监控、故障排查

---

## 环境要求

- **Node.js**：≥ 18.0.0
- **内存**：推荐 ≥ 512MB
- **磁盘**：≥ 100MB（不含日志）
- **网络**：需访问 xstech.one

---

## 环境变量完整说明

### 必需变量

```env
# API Key（中转站对外API认证）
API_KEY=sk-your-secret-key-here

# xstech账号列表（JSON数组）
XSTECH_ACCOUNTS='[{"account":"user@email.com","password":"password"}]'
```

### 服务配置

```env
# 服务端口（默认3000）
PORT=3000

# 监听地址（默认0.0.0.0）
HOST=0.0.0.0

# xstech基础URL（默认https://xstech.one）
XSTECH_BASE_URL=https://xstech.one

# xstech应用版本（默认3.1.0）
XSTECH_APP_VERSION=3.1.0

# 是否发送useImages/useFiles字段（默认false）
XSTECH_SEND_FILE_FLAGS=false
```

### 会话池配置

```env
# 会话池最小上限（默认50）
SESSION_POOL_MIN=50

# 会话池最大上限（默认1000）
SESSION_POOL_MAX=1000

# 会话同步间隔（分钟，默认30）
SESSION_SYNC_MINUTES=30

# 缓存同步间隔（分钟，默认10）
SESSION_CACHE_SYNC_MINUTES=10
```

### Token管理

```env
# Token提前刷新窗口（秒，默认300=5分钟）
TOKEN_REFRESH_BEFORE_SEC=300

# Token检查间隔（秒，默认60）
TOKEN_REFRESH_CHECK_INTERVAL_SEC=60
```

### 模型刷新

```env
# 模型刷新间隔（秒，默认1800=30分钟）
MODEL_REFRESH_INTERVAL_SEC=1800
```

### 文件处理

```env
# OpenAI Chat文件提取范围（last_user | all，默认last_user）
OPENAI_CHAT_FILE_SCOPE=last_user

# Responses文件提取范围（last_user | all，默认last_user）
RESPONSES_INPUT_FILE_SCOPE=last_user

# Responses文件上下文重放模式（auto | always | never，默认auto）
RESPONSES_FILE_CONTEXT_MODE=auto

# 文件上下文TTL（毫秒，默认3600000=1小时）
RESPONSES_FILE_CONTEXT_TTL_MS=3600000
```

### 日志

```env
# 日志级别（DEBUG | INFO | WARN | ERROR，默认INFO）
LOG_LEVEL=INFO
```

---

## 服务管理

### 启动服务

```bash
# 前台启动
npm start
# 或
node index.js

# 后台启动
nohup node index.js > /tmp/xs-proxy.out 2>&1 &

# 查看PID
ps aux | grep 'node index.js' | grep -v grep
```

### 停止服务

```bash
# 优雅停止（如果支持）
pkill -SIGTERM -f 'node index.js'

# 强制停止
pkill -9 -f 'node index.js'
```

### 重启服务

```bash
pkill -9 -f 'node index.js' && sleep 2 && nohup node index.js > /tmp/xs-proxy.out 2>&1 &
```

### 查看日志

```bash
# 实时日志
tail -f /tmp/xs-proxy.out

# 最近100行
tail -100 /tmp/xs-proxy.out

# 搜索错误
grep -i error /tmp/xs-proxy.out | tail -20
```

---

## 健康检查

### 基础检查

```bash
# 健康检查
curl http://localhost:3000/health

# 预期响应
{
  "ok": true,
  "service": "xs-openai-proxy",
  "uptimeSec": 123,
  "now": "2026-06-14T..."
}
```

### 详细状态

```bash
# 完整状态
curl http://localhost:3000/debug/status \
  -H "Authorization: Bearer ${API_KEY}"

# 包含：
# - accounts: 账号状态、Token有效期、健康评分
# - sessionPools: 会话池统计、空闲/使用中
# - models: 模型数量、刷新时间
# - uptime: 运行时长
```

### 模型列表

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer ${API_KEY}"
```

---

## 监控指标

### 关键指标

| 指标 | 接口 | 正常范围 |
|------|------|---------|
| **健康状态** | `GET /health` | `ok: true` |
| **账号Token** | `GET /debug/status` | `accounts[].tokenExpires` > now + 5分钟 |
| **会话池** | `GET /debug/status` | `sessionPools[].idle` > 0 |
| **模型数量** | `GET /v1/models` | `data.length` ≥ 20 |
| **请求成功率** | `GET /debug/metrics/trend` | `successRate` > 95% |
| **上游网络** | `GET /debug/upstream/diagnostics` | 所有检查通过 |

### 监控脚本示例

```bash
#!/bin/bash
# check_health.sh

API_KEY="sk-your-api-key"
BASE_URL="http://localhost:3000"

# 健康检查
health=$(curl -s "${BASE_URL}/health")
if [[ $(echo "$health" | jq -r '.ok') != "true" ]]; then
  echo "❌ 健康检查失败"
  exit 1
fi

# 账号Token检查
status=$(curl -s -H "Authorization: Bearer ${API_KEY}" "${BASE_URL}/debug/status")
token_expires=$(echo "$status" | jq -r '.accounts[0].tokenExpires')
if [[ -z "$token_expires" ]]; then
  echo "⚠️ Token信息缺失"
  exit 1
fi

echo "✅ 所有检查通过"
```

---

## 故障排查

### 服务无法启动

**症状**：`npm start` 或 `node index.js` 无响应或报错

**排查步骤**：

1. 检查端口占用
```bash
lsof -i :3000
# 或
netstat -tulnp | grep 3000
```

2. 检查环境变量
```bash
cat .env
# 确认 API_KEY 和 XSTECH_ACCOUNTS 存在且格式正确
```

3. 检查依赖
```bash
npm install
```

4. 检查语法错误
```bash
node -c index.js
find 启动 工具 中间件 服务层 路由 -name '*.js' -exec node -c {} \;
```

### Token过期

**症状**：日志中出现 `401 Unauthorized` 或 `Token expired`

**解决方案**：

1. 手动刷新Token
```bash
curl -X POST http://localhost:3000/debug/maintenance/refresh-token \
  -H "Authorization: Bearer ${API_KEY}"
```

2. 检查自动刷新是否启用
```bash
# 查看日志
grep "Token自动刷新" /tmp/xs-proxy.out
```

3. 如果账号被锁定，需要重新登录
```bash
# 删除旧Token
rm 账号token.json

# 重启服务
pkill -9 -f 'node index.js' && sleep 2 && nohup node index.js > /tmp/xs-proxy.out 2>&1 &
```

### 会话池已满

**症状**：日志中出现 `Session pool full`

**解决方案**：

1. 检查会话池状态
```bash
curl http://localhost:3000/debug/sessions/detail \
  -H "Authorization: Bearer ${API_KEY}"
```

2. 手动同步会话（清理孤立会话）
```bash
curl -X POST http://localhost:3000/debug/maintenance/sync-sessions \
  -H "Authorization: Bearer ${API_KEY}"
```

3. 调整会话池上限（需重启）
```bash
# .env
SESSION_POOL_MAX=2000
```

### 上游请求失败

**症状**：日志中频繁出现 `ETIMEDOUT`、`ECONNREFUSED`、`524`

**排查步骤**：

1. 上游网络诊断
```bash
curl http://localhost:3000/debug/upstream/diagnostics \
  -H "Authorization: Bearer ${API_KEY}"
```

2. 检查DNS解析
```bash
nslookup xstech.one
```

3. 检查HTTPS连通性
```bash
curl -v https://xstech.one
```

4. 检查账号状态
```bash
curl http://localhost:3000/debug/status \
  -H "Authorization: Bearer ${API_KEY}" | jq '.accounts'
```

### 模型列表为空

**症状**：`GET /v1/models` 返回空数组

**解决方案**：

1. 手动刷新模型
```bash
curl -X POST http://localhost:3000/debug/maintenance/refresh-models \
  -H "Authorization: Bearer ${API_KEY}"
```

2. 检查模型映射文件
```bash
cat 模型映射.json | jq 'length'
```

3. 如果文件损坏，删除后重启
```bash
rm 模型映射.json 模型价格.json
pkill -9 -f 'node index.js' && sleep 2 && nohup node index.js > /tmp/xs-proxy.out 2>&1 &
```

---

## 备份与恢复

### 备份关键文件

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 配置文件
cp .env "$BACKUP_DIR/"
cp 运行配置.json "$BACKUP_DIR/"

# 数据文件
cp 账号列表.json "$BACKUP_DIR/"
cp 账号token.json "$BACKUP_DIR/"
cp 会话池.json "$BACKUP_DIR/"
cp 误判词.json "$BACKUP_DIR/"
cp 模型流错误规则.json "$BACKUP_DIR/"

# 模型数据
cp 模型映射.json "$BACKUP_DIR/"
cp 模型价格.json "$BACKUP_DIR/"

tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
echo "✅ 备份完成：${BACKUP_DIR}.tar.gz"
```

### 恢复备份

```bash
#!/bin/bash
# restore.sh

if [ -z "$1" ]; then
  echo "用法: ./restore.sh <备份文件.tar.gz>"
  exit 1
fi

# 解压备份
tar -xzf "$1"
BACKUP_DIR=$(basename "$1" .tar.gz)

# 停止服务
pkill -9 -f 'node index.js'

# 恢复文件（谨慎：会覆盖现有文件）
cp -r "$BACKUP_DIR"/* .

# 重启服务
nohup node index.js > /tmp/xs-proxy.out 2>&1 &

echo "✅ 恢复完成，服务已重启"
```

---

## 性能优化

### 1. 会话池预热

启动时会自动预热缓存（约3秒），无需手动操作。

### 2. 缓存同步间隔

根据使用频率调整：

```env
# 高频使用：缩短同步间隔
SESSION_CACHE_SYNC_MINUTES=5

# 低频使用：延长同步间隔
SESSION_CACHE_SYNC_MINUTES=30
```

### 3. Token提前刷新

避免Token过期时才刷新：

```env
# 提前10分钟刷新
TOKEN_REFRESH_BEFORE_SEC=600
```

### 4. 日志级别

生产环境建议使用 INFO 或 WARN：

```env
LOG_LEVEL=INFO
```

---

## 安全建议

1. **API Key保护**
   - 不要在客户端暴露 API Key
   - 定期更换 API Key
   - 使用环境变量而非硬编码

2. **网络隔离**
   - 如有条件，使用防火墙限制访问源IP
   - 使用HTTPS（通过反向代理）

3. **日志脱敏**
   - 日志中不包含完整Token
   - 敏感信息用 `***` 代替

4. **定期备份**
   - 每天备份关键配置文件
   - 保留最近7天备份

---

## 部署检查清单

部署前检查：

- [ ] 环境变量已配置（API_KEY, XSTECH_ACCOUNTS）
- [ ] 依赖已安装（npm install）
- [ ] 端口未被占用（lsof -i :3000）
- [ ] 网络可达xstech.one（ping / curl）
- [ ] 语法检查通过（npm run smoke）

部署后检查：

- [ ] 健康检查正常（GET /health）
- [ ] 账号Token有效（GET /debug/status）
- [ ] 模型列表正常（GET /v1/models）
- [ ] 会话池已初始化（GET /debug/status）
- [ ] 日志无ERROR（tail /tmp/xs-proxy.out）

---

## 常见维护任务

### 每日

- 检查服务健康状态
- 检查账号Token有效期
- 查看错误日志

### 每周

- 备份配置文件
- 清理旧日志（如需要）
- 检查会话池状态

### 每月

- 更新依赖（npm update）
- 检查误判词规则是否过多
- 审查事件日志

---

## 技术支持

- **GitHub Issues**：https://github.com/gyx1114995007/xstech-proxy/issues
- **控制面板**：http://localhost:3000/panel
- **项目文档**：README.md, CLAUDE.md, docs/