#!/bin/bash
# 修复问答功能 network error —— 给 nginx 加 /api/kb_stream SSE location
set -e

CONF="/etc/nginx/sites-available/ai-compliance"

# 检查是否已经加过
if grep -q 'location = /api/kb_stream' "$CONF"; then
    echo "✅ 已经存在，无需重复添加"
else
    # 在 WebSocket 那行前面插入
    sed -i '/# ═══ WebSocket — AI meeting/i\    # ═══ SSE — knowledge base stream (问答) ═══\n    location = /api/kb_stream {\n        proxy_pass http://127.0.0.1:8002/kb_stream;\n        proxy_http_version 1.1;\n        proxy_set_header Connection '"'"''"'"';\n        proxy_buffering off;\n        proxy_cache off;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_read_timeout 600s;\n    }\n' "$CONF"
    echo "✅ 配置已添加"
fi

# 验证语法
nginx -t
echo "✅ 语法检查通过"

# 重载
systemctl reload nginx
echo "✅ nginx 已重载，问答功能修复完成"
