#!/bin/bash
echo "=================================================="
echo "     三重一大合规后端服务 (Ubuntu)"
echo "=================================================="

export HF_ENDPOINT=https://hf-mirror.com
echo "HuggingFace 镜像: $HF_ENDPOINT"

cd "$(dirname "$0")"
echo "项目目录: $(pwd)"

echo "清理占用 8000 端口的旧进程..."
fuser -k 8002/tcp 2>/dev/null

echo "启动后端服务..."
/home/ai/miniconda3/envs/ai_compliance/bin/python backend_full.py
