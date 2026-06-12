#!/bin/bash

# xs中转站 - GitHub推送脚本
# 请先删除泄露的token，重新生成一个新的！

echo "正在推送到GitHub..."

cd /data/data/com.ai.assistance.operit/files/workspace/xs中转站

# 配置远程仓库（替换成你的用户名）
git remote add origin https://github.com/你的用户名/xs中转站.git 2>/dev/null || git remote set-url origin https://github.com/你的用户名/xs中转站.git

# 推送代码
git push -u origin master

echo "✅ 推送完成！"
