#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AI 合规系统 — 迁移到 2080Ti Ubuntu 主机 无损脚本
# ═══════════════════════════════════════════════════════════════
# 用法:
#   在旧机器上:  bash migrate_to_2080ti.sh pack
#   在新机器上:  bash migrate_to_2080ti.sh deploy
# ═══════════════════════════════════════════════════════════════
set -e

MODE=${1:-help}
PROJECT_DIR="/home/ai/文档/ai616"
MIGRATE_PKG="/tmp/ai616_migrate_$(date +%Y%m%d_%H%M%S).tar.gz"
NEW_HOST_DIR="/home/ai/ai616"
CONDA_ENV="ai_compliance"
PYTHON_VER="3.10"

# ─── 颜色 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ═══════════════════════════════════════════════════════════════
# 阶段 1: 旧机器打包
# ═══════════════════════════════════════════════════════════════
pack() {
    echo_info "=== 旧机器：打包 ai616 全部数据 + 代码 ==="

    # 0. 冻结精确依赖版本
    echo_info "冻结 pip 依赖版本..."
    /home/ai/miniconda3/envs/ai_compliance/bin/pip freeze 2>/dev/null | grep -v "^-e\|^@\|^#\|^$" > "$PROJECT_DIR/requirements_frozen.txt"
    echo_info "已生成 requirements_frozen.txt ($(wc -l < "$PROJECT_DIR/requirements_frozen.txt") 个包)"

    # 0.1. 先做一次数据库备份
    echo_info "备份 SQLite..."
    cd "$PROJECT_DIR"
    /home/ai/miniconda3/envs/ai_compliance/bin/python -c "
import sqlite3, shutil, os
src = 'data/app.db'
if os.path.exists(src):
    dst = f'data/app_backup_{__import__(\"datetime\").datetime.now().strftime(\"%Y%m%d_%H%M%S\")}.db'
    shutil.copy2(src, dst)
    print(f'Backup: {dst}')
    # WAL checkpoint
    conn = sqlite3.connect(src)
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    conn.close()
    print('WAL checkpoint done')
" 2>&1

    # 1. 打包 —— 排除不需要的文件
    echo_info "打包文件..."
    cd "$PROJECT_DIR"
    tar czf "$MIGRATE_PKG" \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='node_modules' \
        --exclude='frontend/dist' \
        --exclude='.git' \
        --exclude='DocumentServer' \
        --exclude='onlyoffice_data' \
        --exclude='*.log' \
        --exclude='backend_server.log' \
        --exclude='logs/*.log' \
        --exclude='data/app_backup_*.db' \
        --exclude='backup_db_snapshots' \
        backend_full.py \
        backend/ \
        frontend/ \
        data/ \
        chroma_db/ \
        rules/ \
        docs/ \
        nginx-fixed.conf \
        nginx-8002.conf \
        ai-compliance.service \
        requirements.txt \
        requirements_frozen.txt \
        setup_prod.sh \
        restart.sh \
        setup_https.sh \
        backup_db.py \
        tests/ \
        .env \
        .env.example \
        check_system.sh \
        README.md \
        CLAUDE.md \
        CHANGELOG.md \
        2026-*.md \
        migrate_to_2080ti.sh \
        Agent_Skill_业务汇报方案.md \
        AI会议真实功能逻辑与查缺补漏.md \
        UI一致性规范.md \
        系统操作手册.md \
        技术文档.md \
        PROJECT_GUIDE.md \
        4.29.md \
        4.30.md \
        4.30_OA真实流程方案.md \
        部署教程.md \
        Ubuntu部署教程.md

    SIZE=$(du -h "$MIGRATE_PKG" | cut -f1)
    echo_info "打包完成: $MIGRATE_PKG ($SIZE)"

    # 2. 校验
    echo_info "校验包内容..."
    tar tzf "$MIGRATE_PKG" | head -20
    echo "..."
    tar tzf "$MIGRATE_PKG" | wc -l | xargs echo "文件总数:"

    echo ""
    echo_info "=== 下一步 ==="
    echo "  1. 把 $MIGRATE_PKG 拷贝到新机器:"
    echo "     scp $MIGRATE_PKG user@2080ti-host:/tmp/"
    echo ""
    echo "  2. 在新机器上运行:"
    echo "     bash migrate_to_2080ti.sh deploy /tmp/$(basename $MIGRATE_PKG)"
}

# ═══════════════════════════════════════════════════════════════
# 阶段 2: 新机器部署
# ═══════════════════════════════════════════════════════════════
deploy() {
    PKG=${1:-/tmp/ai616_migrate_*.tar.gz}
    # 展开 glob
    PKG=$(ls $PKG 2>/dev/null | head -1)
    if [ ! -f "$PKG" ]; then
        echo "用法: bash migrate_to_2080ti.sh deploy <迁移包路径>"
        echo "找不到包: $PKG"
        exit 1
    fi

    echo_info "=== 新机器：部署 ai616 ==="

    # ── 1. 系统依赖 ──
    echo_info "1/8 安装系统依赖..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx sqlite3 build-essential curl 2>&1 | tail -1

    # ── 2. NVIDIA 驱动检查 ──
    echo_info "2/8 检查 GPU..."
    if command -v nvidia-smi &>/dev/null; then
        nvidia-smi --query-gpu=name --format=csv,noheader | head -1
    else
        echo_warn "未检测到 NVIDIA 驱动！请先安装:"
        echo "  sudo apt install nvidia-driver-535"
        echo "  然后重启"
        echo ""
        echo "  继续部署但 GPU 将不可用..."
    fi

    # ── 3. Conda 环境 ──
    echo_info "3/8 创建 Conda 环境..."
    if ! command -v conda &>/dev/null; then
        echo_warn "未检测到 conda，安装 Miniconda..."
        wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh
        bash /tmp/miniconda.sh -b -p "$HOME/miniconda3"
        eval "$($HOME/miniconda3/bin/conda shell.bash hook)"
        conda init bash
    fi

    source "$HOME/miniconda3/etc/profile.d/conda.sh" 2>/dev/null || true
    conda create -n "$CONDA_ENV" python="$PYTHON_VER" -y 2>&1 | tail -3
    conda activate "$CONDA_ENV"

    # ── 4. 解压 ──
    echo_info "4/8 解压项目..."
    mkdir -p "$NEW_HOST_DIR"
    tar xzf "$PKG" -C "$NEW_HOST_DIR"
    echo_info "解压到 $NEW_HOST_DIR"

    # ── 5. Python 依赖 ──
    echo_info "5/8 安装 Python 依赖..."
    cd "$NEW_HOST_DIR"
    pip install --upgrade pip -q 2>&1 | tail -1

    # 2080Ti 是 Turing 架构 (SM75)，CUDA 11.4+ 都支持
    # 安装 PyTorch CUDA 版
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 -q 2>&1 | tail -3

    # 其他依赖 —— 优先用冻结版本保证一致性
    if [ -f "$NEW_HOST_DIR/requirements_frozen.txt" ]; then
        echo_info "使用精确版本 requirements_frozen.txt ..."
        pip install -r "$NEW_HOST_DIR/requirements_frozen.txt" -q 2>&1 | tail -3
    else
        pip install -r "$NEW_HOST_DIR/requirements.txt" -q 2>&1 | tail -3
    fi

    # 预热 embedding 模型（避免首次请求阻塞）
    echo_info "预下载 embedding 模型..."
    python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('shibing624/text2vec-base-chinese')" 2>&1 | tail -3
    echo_info "模型就绪"

    # ── 6. 配置 .env ──
    echo_info "6/8 检查 .env 配置..."
    if [ ! -f "$NEW_HOST_DIR/.env" ]; then
        cp "$NEW_HOST_DIR/.env.example" "$NEW_HOST_DIR/.env"
        echo_warn "已创建 .env 模板，请编辑填入 API Key:"
        echo "  vim $NEW_HOST_DIR/.env"
        echo "  至少配置: DEEPSEEK_API_KEY, APP_AUTH_SECRET"
    fi

    # ── 7. Nginx ──
    echo_info "7/8 配置 Nginx..."
    sudo cp "$NEW_HOST_DIR/nginx-fixed.conf" /etc/nginx/sites-available/ai616
    sudo ln -sf /etc/nginx/sites-available/ai616 /etc/nginx/sites-enabled/ai616
    # 移除默认站点
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t && sudo systemctl reload nginx
    echo_info "Nginx 配置完成"

    # ── 8. systemd 服务 ──
    echo_info "8/8 配置 systemd 服务..."
    # 修改 service 文件路径
    sed -i "s|WorkingDirectory=/home/ai/文档/ai616|WorkingDirectory=$NEW_HOST_DIR|g" "$NEW_HOST_DIR/ai-compliance.service"
    sed -i "s|ExecStart=.*|ExecStart=$HOME/miniconda3/envs/$CONDA_ENV/bin/python backend_full.py|g" "$NEW_HOST_DIR/ai-compliance.service"
    sed -i "s|StandardOutput=.*|StandardOutput=append:$NEW_HOST_DIR/backend_server.log|g" "$NEW_HOST_DIR/ai-compliance.service"
    sed -i "s|StandardError=.*|StandardError=append:$NEW_HOST_DIR/backend_server.log|g" "$NEW_HOST_DIR/ai-compliance.service"

    sudo cp "$NEW_HOST_DIR/ai-compliance.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable ai-compliance
    sudo systemctl start ai-compliance
    sleep 8

    # ── 验证 ──
    echo ""
    echo_info "=== 验证 ==="
    if curl -s http://localhost:8002/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Health: {d[\"status\"]} | DB: {d[\"checks\"][\"db\"]} | Chroma: {d[\"checks\"][\"chromadb\"]} | GPU: {d[\"checks\"][\"llm\"]}')" 2>/dev/null; then
        echo_info "✅ 后端健康检查通过"
    else
        echo_warn "后端未正常启动，检查日志: journalctl -u ai-compliance -n 50"
    fi

    if curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ | grep -q 200; then
        echo_info "✅ 前端 200 OK"
    fi

    # ── 构建前端 ──
    echo_info "构建前端..."
    cd "$NEW_HOST_DIR/frontend"
    npm install --legacy-peer-deps 2>&1 | tail -3
    ./node_modules/.bin/vite build 2>&1 | tail -3
    echo_info "前端构建完成"

    echo ""
    echo_info "=== 迁移完成 ==="
    echo "  后端: http://$(hostname -I | awk '{print $1}'):8002/health"
    echo "  前端: http://$(hostname -I | awk '{print $1}')/"
    echo ""
    echo "  检查清单:"
    echo "  □ 编辑 .env: vim $NEW_HOST_DIR/.env"
    echo "  □ 测试登录: curl -X POST http://localhost:8002/api/auth/login ..."
    echo "  □ 确认 ChromaDB 正常: ls -la $NEW_HOST_DIR/chroma_db/"
    echo "  □ 确认数据库: ls -la $NEW_HOST_DIR/data/app.db"
    echo "  □ GPU 可用: python -c 'import torch; print(torch.cuda.is_available())'"
    echo ""
    echo "  回滚: sudo systemctl stop ai-compliance && rm -rf $NEW_HOST_DIR"
}

# ═══════════════════════════════════════════════════════════════
# 帮助
# ═══════════════════════════════════════════════════════════════
help() {
    echo "AI 合规系统 2080Ti 迁移脚本"
    echo ""
    echo "  旧机器上:  bash migrate_to_2080ti.sh pack"
    echo "  新机器上:  bash migrate_to_2080ti.sh deploy <包路径>"
    echo ""
    echo "迁移后检查清单:"
    echo "  □ .env 文件中的 API Key 是否已配置"
    echo "  □ ChromaDB 向量库是否需要重新 indexing (如果 embedding 模型版本不同)"
    echo "  □ nginx 是否正常 (sudo nginx -t)"
    echo "  □ 防火墙是否已开放 80/8002 端口"
    echo "  □ 宝塔转发目标 IP 是否已更新为新机器 IP"
    echo "  □ GPU 驱动与 PyTorch CUDA 版本是否匹配 (python -c 'import torch; print(torch.cuda.is_available())')"
    echo ""
    echo "注意事项:"
    echo "  - ChromaDB 43MB, SQLite 24MB, 打包后 ~200MB"
    echo "  - 2080Ti (11GB VRAM, Turing SM75) 需要 CUDA 11.4+ / PyTorch cu118"
    echo "  - 旧机器服务保持运行，新机器验证通过后再切 DNS/宝塔转发"
}

case "$MODE" in
    pack)    pack ;;
    deploy)  deploy "$2" ;;
    help|*)  help ;;
esac
