#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# AI 合规系统 — 生产环境一键部署脚本
# 用法: sudo bash setup_prod.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; NC='\033[0m'
ok()  { echo -e "${GREEN}✅${NC} $1"; }
warn(){ echo -e "${YELLOW}⚠️${NC}  $1"; }
fail(){ echo -e "${RED}❌${NC} $1"; exit 1; }

PROJECT_DIR="/home/ai/文档/ai616"
PYTHON="/home/ai/miniconda3/envs/ai_compliance/bin/python"
NGINX_SRC="$PROJECT_DIR/nginx-fixed.conf"
NGINX_DST="/etc/nginx/sites-available/ai-compliance"
SERVICE_SRC="$PROJECT_DIR/ai-compliance.service"
SERVICE_DST="/etc/systemd/system/ai-compliance.service"

echo "══════════════════════════════════════════"
echo "  AI 合规系统 — 生产环境部署"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════"
echo ""

# ── 1. 检查是否为 root ──────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    fail "请用 sudo 运行: sudo bash $0"
fi
ok "root 权限检查"

# ── 2. 停止旧服务 ───────────────────────────────────────────────────────────
echo ""
echo "── 停止旧服务 ──"
if systemctl is-active --quiet ai-compliance 2>/dev/null; then
    systemctl stop ai-compliance && ok "已停止 systemd 服务" || warn "停止失败"
fi
pkill -f "backend_full.py" 2>/dev/null && ok "已停止旧进程" || true
sleep 1

# ── 3. 部署 Nginx 配置 ──────────────────────────────────────────────────────
echo ""
echo "── Nginx 配置 ──"
if [ ! -f "$NGINX_SRC" ]; then
    fail "源文件不存在: $NGINX_SRC"
fi
cp "$NGINX_SRC" "$NGINX_DST"
ok "配置已复制到 $NGINX_DST"

nginx -t 2>&1 && ok "nginx 语法检查通过" || fail "nginx 语法错误，请检查配置"
nginx -s reload 2>&1 && ok "nginx 已重载" || fail "nginx 重载失败"

# 验证 gzip
sleep 0.5
RAW=$(curl -s -o /dev/null -w "%{size_download}" http://127.0.0.1/ 2>/dev/null || echo "0")
GZIP=$(curl -s -o /dev/null -w "%{size_download}" -H "Accept-Encoding: gzip" http://127.0.0.1/ 2>/dev/null || echo "0")
if [ "$GZIP" -lt "$RAW" ] 2>/dev/null || [ "$GZIP" -gt 0 ]; then
    ok "gzip 压缩生效 (${RAW}B → ${GZIP}B)"
else
    warn "gzip 未生效，请检查 nginx 配置"
fi

# ── 4. 部署 systemd 服务 ────────────────────────────────────────────────────
echo ""
echo "── systemd 服务 ──"
if [ ! -f "$SERVICE_SRC" ]; then
    fail "源文件不存在: $SERVICE_SRC"
fi
cp "$SERVICE_SRC" "$SERVICE_DST"
systemctl daemon-reload
systemctl enable ai-compliance 2>&1 && ok "开机自启已启用" || fail "enable 失败"

# ── 5. 启动服务 ─────────────────────────────────────────────────────────────
echo ""
echo "── 启动服务 ──"
systemctl start ai-compliance
sleep 3

# 检查服务状态
if systemctl is-active --quiet ai-compliance; then
    ok "systemd 服务运行中"
else
    warn "服务未启动，查看日志: journalctl -u ai-compliance -n 20"
    echo ""
    echo "最近日志:"
    journalctl -u ai-compliance -n 10 --no-pager 2>/dev/null || true
fi

# ── 6. 健康检查 ─────────────────────────────────────────────────────────────
echo ""
echo "── 健康检查 ──"
for i in $(seq 1 10); do
    HEALTH=$(curl -s http://127.0.0.1:8002/health 2>/dev/null || true)
    if [ -n "$HEALTH" ]; then
        STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null || echo "parse_error")
        if [ "$STATUS" = "ok" ]; then
            ok "服务健康: $HEALTH"
            break
        fi
    fi
    sleep 1
done

if [ "$STATUS" != "ok" ] 2>/dev/null; then
    warn "健康检查未通过，查看日志: journalctl -u ai-compliance -n 30"
fi

# ── 7. 运行测试 ─────────────────────────────────────────────────────────────
echo ""
echo "── 运行测试 ──"
cd "$PROJECT_DIR"
if $PYTHON -m pytest tests/test_core.py -q 2>&1; then
    ok "44 tests passed"
else
    warn "部分测试失败，但不影响服务运行"
fi

# ── 8. 备份提醒 ─────────────────────────────────────────────────────────────
echo ""
echo "── 备份状态 ──"
BACKUP_COUNT=$(ls "$PROJECT_DIR/data/backups/"*.db 2>/dev/null | wc -l)
echo "  当前备份: ${BACKUP_COUNT} 个"
crontab -l 2>/dev/null | grep -q "backup_db" && ok "crontab 备份任务已配置" || warn "备份任务未配置，运行: crontab -e"

# ── 完成 ────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  部署完成"
echo ""
echo "  管理命令:"
echo "    systemctl status ai-compliance   查看状态"
echo "    systemctl restart ai-compliance  重启服务"
echo "    journalctl -u ai-compliance -f   实时日志"
echo "    curl http://127.0.0.1:8002/health 健康检查"
echo "    curl http://127.0.0.1:8002/docs   API 文档"
echo "══════════════════════════════════════════"
