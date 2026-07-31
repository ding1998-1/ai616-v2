#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# AI 合规系统 — 状态检测脚本（每天随手跑，安全无副作用）
# 用法:
#   bash check_system.sh          纯检查模式，不改任何东西
#   sudo bash check_system.sh --fix  检查 + 自动修复
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; CYAN='\033[36m'; NC='\033[0m'
PASS="${GREEN}✅${NC}"; FAIL="${RED}❌${NC}"; WARN="${YELLOW}⚠️${NC} "; INFO="${CYAN}→${NC} "

FIX_MODE=false
[[ "${1:-}" == "--fix" ]] && FIX_MODE=true

PROJECT_DIR="/home/ai/文档/ai616"
PYTHON="/home/ai/miniconda3/envs/ai_compliance/bin/python"
API="http://127.0.0.1:8002"
IS_ROOT=false
[[ "$(id -u)" -eq 0 ]] && IS_ROOT=true

PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0

check() {
    local label="$1"; local cmd="$2"; local fix_cmd="${3:-}"
    if eval "$cmd" &>/dev/null; then
        echo -e "  $PASS $label"
        ((PASS_COUNT++)) || true
    else
        if $FIX_MODE && [[ -n "$fix_cmd" ]]; then
            echo -e "  $WARN $label — 尝试修复..."
            if eval "$fix_cmd" &>/dev/null; then
                echo -e "    $PASS 已修复"
                ((PASS_COUNT++)) || true
            else
                echo -e "    $FAIL 修复失败"
                ((FAIL_COUNT++)) || true
            fi
        else
            echo -e "  $FAIL $label"
            ((FAIL_COUNT++)) || true
        fi
    fi
}

echo "══════════════════════════════════════════"
echo "  AI 合规系统 — 状态检测"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
$FIX_MODE && echo "  模式: 自动修复" || echo "  模式: 只读检查 (加 --fix 自动修)"
echo "══════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════════════════
# 1. 进程
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 1. 服务进程 ──"
check "后端进程运行中" \
    "pgrep -f 'backend_full.py' >/dev/null" \
    "cd $PROJECT_DIR && nohup $PYTHON backend_full.py > backend_server.log 2>&1 &"

check "端口 8002 监听中" \
    "ss -tlnp | grep -q ':8002 '"

PROC_COUNT=$(pgrep -c -f "backend_full.py" 2>/dev/null || echo 0)
echo "     进程数: $PROC_COUNT"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. API 健康
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 2. API 健康 ──"
HEALTH=$(curl -s --max-time 5 "$API/health" 2>/dev/null || echo '{"status":"down"}')
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','down'))" 2>/dev/null || echo "down")

[[ "$STATUS" == "ok" ]] && echo -e "  $PASS 服务状态: ok" && ((PASS_COUNT++)) || { echo -e "  $FAIL 服务状态: $STATUS"; ((FAIL_COUNT++)); }

# 各组件
for comp in db chromadb llm asr; do
    CSTATE=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['checks'].get('$comp','fail'))" 2>/dev/null || echo "fail")
    if [[ "$CSTATE" == "ok" ]]; then
        echo -e "    $PASS $comp: $CSTATE"
    else
        echo -e "    $FAIL $comp: $CSTATE"
        ((FAIL_COUNT++)) || true
    fi
done

MEETINGS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['checks'].get('meetings','?'))" 2>/dev/null || echo "?")
TRANSCRIPTS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['checks'].get('transcripts','?'))" 2>/dev/null || echo "?")
echo "     会议: $MEETINGS  转写: $TRANSCRIPTS"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. 端点可达性
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 3. 关键端点 ──"
for ep in "/health" "/" "/docs" "/matter-types" "/api/meetings" "/api/departments"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API$ep" 2>/dev/null || echo "000")
    ok_codes="200 401 302"
    if echo "$ok_codes" | grep -qw "$code"; then
        echo -e "  $PASS GET $ep → $code"
    elif [[ "$code" == "000" ]]; then
        echo -e "  $FAIL GET $ep → 无响应"
        ((FAIL_COUNT++)) || true
    else
        echo -e "  $WARN GET $ep → $code"
        ((WARN_COUNT++)) || true
    fi
done
# POST-only endpoints
for ep in "/api/audit_stream" "/api/kb_stream"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API$ep" -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
    if [[ "$code" == "200" || "$code" == "401" ]]; then
        echo -e "  $PASS POST $ep → $code"
    elif [[ "$code" == "000" ]]; then
        echo -e "  $FAIL POST $ep → 无响应"
        ((FAIL_COUNT++)) || true
    else
        echo -e "  $WARN POST $ep → $code"
        ((WARN_COUNT++)) || true
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Nginx
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 4. Nginx ──"
check "nginx 进程运行中" \
    "pgrep -x nginx >/dev/null"

NGINX_CONF="/etc/nginx/sites-enabled/ai-compliance"
check "nginx 配置存在" \
    "test -f $NGINX_CONF" \
    "cp $PROJECT_DIR/nginx-fixed.conf $NGINX_CONF && nginx -s reload"

# gzip 测试
RAW=$(curl -s -o /dev/null -w "%{size_download}" --max-time 3 http://127.0.0.1/ 2>/dev/null || echo "0")
GZIP=$(curl -s -o /dev/null -w "%{size_download}" -H "Accept-Encoding: gzip" --max-time 3 http://127.0.0.1/ 2>/dev/null || echo "0")
[[ "$GZIP" != "0" && "$GZIP" -le "$RAW" ]] && echo -e "  $PASS gzip 压缩生效 (${RAW}B→${GZIP}B)" || echo -e "  $WARN gzip 状态: raw=${RAW}B gzip=${GZIP}B"

# ═══════════════════════════════════════════════════════════════════════════════
# 5. systemd
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 5. 开机自启 ──"
if $IS_ROOT; then
    check "systemd 服务已 enable" \
        "systemctl is-enabled ai-compliance &>/dev/null" \
        "cp $PROJECT_DIR/ai-compliance.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable ai-compliance"
else
    ENABLED=$(systemctl is-enabled ai-compliance 2>/dev/null || echo "unknown")
    [[ "$ENABLED" == "enabled" ]] && echo -e "  $PASS 开机自启: $ENABLED" || echo -e "  $FAIL 开机自启: $ENABLED (需要 sudo 修复)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. 数据库备份
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 6. 备份 ──"
BACKUP_DIR="$PROJECT_DIR/data/backups"
BACKUP_COUNT=$(ls "$BACKUP_DIR"/*.db 2>/dev/null | wc -l)
LAST_BACKUP=$(ls -t "$BACKUP_DIR"/*.db 2>/dev/null | head -1)
if [[ "$BACKUP_COUNT" -gt 0 ]]; then
    AGE_MIN=$(( ($(date +%s) - $(stat -c %Y "$LAST_BACKUP" 2>/dev/null || date +%s)) / 60 ))
    echo -e "  $PASS 备份数: $BACKUP_COUNT (最近: ${AGE_MIN}分钟前)"
else
    echo -e "  $FAIL 无备份"
    ((FAIL_COUNT++)) || true
fi

check "crontab 备份任务已配置" \
    "crontab -l 2>/dev/null | grep -q 'backup_db'" \
    "(crontab -l 2>/dev/null; echo '0 * * * * $PYTHON $PROJECT_DIR/backup_db.py >> $PROJECT_DIR/data/backup.log 2>&1') | crontab -"

# ═══════════════════════════════════════════════════════════════════════════════
# 7. 日志
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 7. 日志 ──"
LOG_DIR="$PROJECT_DIR/logs"
[[ -d "$LOG_DIR" ]] && LOG_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1) || LOG_SIZE="无"
echo "     日志目录: $LOG_SIZE"

AUDIT_COUNT=$(grep -c "【审计】" "$PROJECT_DIR/backend_server.log" 2>/dev/null || echo 0)
echo "     审计记录: ${AUDIT_COUNT} 条"

# ═══════════════════════════════════════════════════════════════════════════════
# 8. 磁盘
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 8. 磁盘 ──"
DISK=$(df -h "$PROJECT_DIR" | tail -1 | awk '{print $5 " 已用," $4 " 可用"}')
echo "     项目磁盘: $DISK"
DB_SIZE=$(ls -lh "$PROJECT_DIR/data/app.db" 2>/dev/null | awk '{print $5}')
CHROMA_SIZE=$(du -sh "$PROJECT_DIR/chroma_db" 2>/dev/null | cut -f1)
echo "     数据库: ${DB_SIZE:-无}  ChromaDB: ${CHROMA_SIZE:-无}"

# ═══════════════════════════════════════════════════════════════════════════════
# 9. 测试（可选，较慢）
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 9. 自动化测试 ──"
if [[ "$STATUS" == "ok" ]]; then
    TEST_OUTPUT=$($PYTHON -m pytest "$PROJECT_DIR/tests/test_core.py" -q 2>&1) || true
    TEST_PASSED=$(echo "$TEST_OUTPUT" | grep -oP '\d+(?= passed)' || echo "0")
    TEST_FAILED=$(echo "$TEST_OUTPUT" | grep -oP '\d+(?= failed)' || echo "0")
    if [[ "$TEST_FAILED" == "0" && "$TEST_PASSED" -gt 0 ]]; then
        echo -e "  $PASS ${TEST_PASSED} passed"
    else
        echo -e "  $FAIL ${TEST_PASSED} passed, ${TEST_FAILED} failed"
        ((FAIL_COUNT++)) || true
    fi
else
    echo -e "  $WARN 服务未就绪，跳过测试"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════"
TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))
echo -e "  结果: ${GREEN}${PASS_COUNT} 通过${NC}  ${RED}${FAIL_COUNT} 失败${NC}  ${YELLOW}${WARN_COUNT} 警告${NC}"
if [[ "$FAIL_COUNT" -eq 0 ]]; then
    echo -e "  ${GREEN}系统正常 ✅${NC}"
elif $FIX_MODE; then
    echo -e "  ${YELLOW}仍有 $FAIL_COUNT 项未修复，请手动处理${NC}"
else
    echo -e "  ${YELLOW}有 $FAIL_COUNT 项异常，运行 'sudo bash $0 --fix' 自动修复${NC}"
fi
echo "══════════════════════════════════════════"
