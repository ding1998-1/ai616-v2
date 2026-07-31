#!/bin/bash
# 切换到 FunASR SenseVoiceSmall 本地 ASR 服务
set -e

echo "=== 1/4 停 Qwen3-ASR ==="
sudo systemctl mask qwen3-asr 2>/dev/null || true
sudo systemctl stop qwen3-asr 2>/dev/null || true
kill $(ps aux | grep 'qwen3_asr_server' | grep -v grep | awk '{print $2}') 2>/dev/null || true
echo "Qwen3-ASR 已停止"

echo "=== 2/4 装 FunASR 服务 ==="
sudo cp /home/ai/文档/ai616/funasr-asr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable funasr-asr
echo "FunASR 服务已安装"

echo "=== 3/4 启动 FunASR (GPU 1) ==="
sudo systemctl restart funasr-asr
sleep 12
if curl -s http://127.0.0.1:8091/api/health | grep -q '"status":"ok"'; then
    echo "FunASR SenseVoiceSmall 已就绪 (GPU 1)"
else
    echo "FunASR 启动失败，查看日志: journalctl -u funasr-asr -n 30"
    exit 1
fi

echo "=== 4/4 重启 ai-compliance ==="
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
echo "FunASR SenseVoiceSmall (GPU 1) 已替换 Qwen3-ASR"
echo "手机端选择「本地识别」即可使用"
