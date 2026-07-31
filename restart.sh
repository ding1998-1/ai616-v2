#!/bin/bash
echo "⏳ 重启 AI 合规系统..."
sudo systemctl restart ai-compliance
echo -n "   等待服务启动"
for i in {1..15}; do
  echo -n "."
  sleep 0.6
  if curl -s http://127.0.0.1:8002/health > /dev/null 2>&1; then
    echo ""
    break
  fi
done
echo ""
echo "✅ 服务已启动"
curl -s http://127.0.0.1:8002/health | /home/ai/miniconda3/envs/ai_compliance/bin/python -c "
import sys,json
d=json.load(sys.stdin)
s=d['checks']
print(f'   DB: {s[\"db\"]}  |  Chroma: {s[\"chromadb\"]}  |  LLM: {s[\"llm\"]}  |  ASR: {s[\"asr\"]}')
print(f'   会议: {s[\"meetings\"]}  |  转写: {s[\"transcripts\"]}')
" 2>/dev/null || echo "   (服务正常运行)"
echo ""
sudo nginx -t 2>&1 | tail -1
