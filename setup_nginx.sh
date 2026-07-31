#!/bin/bash
cp /home/ai/文档/ai616/nginx-fixed.conf /etc/nginx/sites-available/ai-compliance
nginx -t
systemctl restart nginx
echo "Nginx 已更新（修复 /api/doc/ 路由）"
