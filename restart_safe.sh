#!/bin/bash
# ai616 安全重启脚本 — 处理旧进程端口占用问题
set -e

echo "=== ai616 安全重启 ==="

# 1. 停服务
echo "[1/4] 停止服务..."
systemctl stop ai-compliance 2>/dev/null || true

# 2. 确保端口释放
echo "[2/4] 释放端口..."
sleep 1
# 杀掉可能残留的旧进程
OLD_PID=$(pgrep -f "python.*backend_full.py" 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
    echo "  残留进程 PID=$OLD_PID，正在终止..."
    kill $OLD_PID 2>/dev/null || true
    sleep 2
    # 如果还没死，强制杀
    if kill -0 $OLD_PID 2>/dev/null; then
        echo "  强制终止..."
        kill -9 $OLD_PID 2>/dev/null || true
        sleep 1
    fi
fi

# 确认端口已释放
if ss -tlnp | grep -q ':8002'; then
    echo "  ⚠ 端口 8002 仍被占用:"
    ss -tlnp | grep ':8002'
    echo "  请手动处理"
    exit 1
fi
echo "  端口 8002 已释放"

# 3. 启服务
echo "[3/4] 启动服务..."
systemctl start ai-compliance
sleep 3

# 4. 验证
echo "[4/4] 验证..."
if curl -s http://127.0.0.1:8002/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'; print(f'  ✅ 服务正常 — {d[\"checks\"][\"meetings\"]}场会议, {d[\"checks\"][\"transcripts\"]}条转写, uptime={d[\"uptime_seconds\"]}s')" 2>/dev/null; then
    echo ""
    echo "=== 重启成功 ==="
else
    echo "  ❌ 健康检查失败，查看日志: tail -50 /home/ai/文档/ai616/backend_server.log"
    exit 1
fi
