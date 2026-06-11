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

# Zeabur默认使用8080端口，同时暴露3000以防万一
EXPOSE 8080
EXPOSE 3000

# 环境变量
ENV NODE_ENV=production

# 启动服务（服务会自动读取Zeabur的PORT环境变量）
CMD ["node", "index.js"]