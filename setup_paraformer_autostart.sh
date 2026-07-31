#!/bin/bash
# Paraformer ASR 开机自启 + 旧服务清理
set -e

echo "=== 1/4 清理旧服务 ==="
sudo systemctl mask qwen3-asr funasr-asr 2>/dev/null || true
sudo systemctl stop qwen3-asr funasr-asr 2>/dev/null || true
sudo rm -f /etc/systemd/system/qwen3-asr.service /etc/systemd/system/funasr-asr.service 2>/dev/null || true

echo "=== 2/4 安装 Paraformer 服务 ==="
sudo cp /home/ai/文档/ai616/paraformer-asr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable paraformer-asr

echo "=== 3/4 启动 Paraformer ==="
sudo systemctl restart paraformer-asr
sleep 15
if curl -s http://127.0.0.1:8091/api/health | grep -q '"status":"ok"'; then
    echo "Paraformer 已就绪 (GPU 1)"
else
    echo "启动失败，查看: journalctl -u paraformer-asr -n 30"
    exit 1
fi

echo "=== 4/4 重启后端 ==="
sudo systemctl restart ai-compliance
sleep 8
if curl -s http://127.0.0.1:8002/health | grep -q '"status":"ok"'; then
    echo "后端已就绪"
else
    echo "后端启动失败"
    exit 1
fi

echo ""
echo "=== 完成 ==="
echo "Paraformer ASR: systemctl status paraformer-asr"
echo "开机自启:       systemctl is-enabled paraformer-asr"
