# xs中转站 Dockerfile
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json
COPY package.json ./

# 安装依赖
RUN npm install --production

# 复制所有文件
COPY . .

# 暴露端口
EXPOSE 3000

# 环境变量（Zeabur会自动设置PORT）
ENV NODE_ENV=production
ENV PORT=3000

# Zeabur会使用自己的健康检查，这里注释掉
# HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# 启动服务
CMD ["node", "index.js"]