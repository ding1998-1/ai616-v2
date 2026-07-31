#!/bin/bash
# 启动后端服务 — 通过 systemd 管理，避免端口冲突
set -e

echo "=================================================="
echo "          启动三重一大合规后端服务"
echo "=================================================="

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 检查 systemd 服务状态
SERVICE_NAME="ai-compliance"

if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "✅ 服务已在运行中"
    systemctl status "$SERVICE_NAME" --no-pager | head -5
else
    echo "正在启动服务..."
    sudo systemctl start "$SERVICE_NAME"
    sleep 2

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo "✅ 服务启动成功"
        systemctl status "$SERVICE_NAME" --no-pager | head -5
    else
        echo "❌ 服务启动失败，查看日志:"
        journalctl -u "$SERVICE_NAME" --no-pager -n 20
        exit 1
    fi
fi

echo ""
echo "健康检查..."
for i in {1..10}; do
    if curl -s http://127.0.0.1:8002/health > /dev/null 2>&1; then
        echo "✅ 服务正常响应"
        exit 0
    fi
    echo -n "."
    sleep 1
done
echo ""
echo "⚠️ 服务启动中，请稍后检查: curl http://127.0.0.1:8002/health"
