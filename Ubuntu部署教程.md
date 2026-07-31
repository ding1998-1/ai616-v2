# 三重一大 AI 智能合规审计系统 — Ubuntu 部署教程

> 适用系统：**Ubuntu 20.04 LTS / 22.04 LTS**（推荐 22.04）
> 提供两条部署路径：**A. Docker 一键部署**（推荐生产）/ **B. 裸机手动部署**（推荐开发）

---

## 📋 目录

1. [服务器最低配置](#服务器最低配置)
2. [路径 A：Docker 一键部署（推荐）](#路径-adocker-一键部署推荐)
3. [路径 B：裸机手动部署](#路径-b裸机手动部署)
4. [环境变量配置](#环境变量配置)
5. [初始化知识库](#初始化知识库)
6. [配置开机自启](#配置开机自启)
7. [⚠️ 注意事项](#️-注意事项)
8. [常见问题排查](#常见问题排查)

---

## 服务器最低配置

| 资源 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核 | 4 核+ |
| 内存 | 8 GB | 16 GB |
| 磁盘 | 40 GB | 100 GB |
| 操作系统 | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| 网络 | 可访问大模型 API | 固定 IP / 域名 |

---

## 路径 A：Docker 一键部署（推荐）

### 1. 安装 Docker 和 Docker Compose

```bash
# 更新包索引
sudo apt-get update

# 安装必要依赖
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 添加 Docker 官方 GPG Key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加 Docker 软件源
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine 和 Compose 插件
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 将当前用户加入 docker 组（免 sudo 运行 docker）
sudo usermod -aG docker $USER
newgrp docker

# 验证安装
docker --version
docker compose version
```

### 2. 上传项目文件

```bash
# 方式 A：通过 scp 从本地上传（在本地 Mac 执行）
scp -r "/Users/macos/Documents/ai 合规 demo 4:28" ubuntu@服务器IP:/opt/ai-compliance

# 方式 B：通过 Git（如果有仓库）
git clone <你的仓库地址> /opt/ai-compliance

# 进入项目目录
cd /opt/ai-compliance
```

### 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

**必须修改的配置项：**

```env
# 大模型 API 地址（内网 Qwen 或线上 DeepSeek）
LLM_API_BASE=http://你的模型服务IP:8088/v1
LLM_API_KEY=your_api_key_here

# 容器内路径（Docker 部署必须使用这些路径）
PERSIST_DIR=/app/chroma_db
DATA_DIR=/app/data

# 嵌入模型（首次运行自动下载）
EMBEDDING_MODEL=shibing624/text2vec-base-chinese
```

> ⚠️ **Docker 部署时 `PERSIST_DIR` 和 `DATA_DIR` 必须用容器内路径 `/app/...`，不能用本地绝对路径！**

### 4. 启动所有服务

```bash
# 后台构建并启动（首次构建约需 5~15 分钟，需下载镜像和 Python 包）
docker compose up -d --build

# 查看启动状态
docker compose ps

# 实时查看日志
docker compose logs -f backend
```

### 5. 验证部署

```bash
# 后端健康检查
curl http://localhost:8000/

# 知识库状态
curl http://localhost:8000/kb_stats
```

浏览器访问 `http://服务器IP`（前端，80 端口）

### 6. 设置开机自启

```bash
sudo systemctl enable docker
# docker compose 本身配置了 restart: always，Docker 启动时容器自动恢复
```

---

## 路径 B：裸机手动部署

适合需要调试或自定义配置的场景。

### 第一步：安装系统基础依赖

```bash
sudo apt-get update && sudo apt-get upgrade -y

sudo apt-get install -y \
  curl wget git vim \
  build-essential \
  python3-dev \
  libssl-dev libffi-dev \
  poppler-utils \         # PDF 处理依赖
  libpq-dev
```

### 第二步：安装 Miniconda（Python 环境管理）

```bash
# 下载 Miniconda（Linux x86_64）
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh

# 静默安装到 /opt/miniconda3
sudo bash /tmp/miniconda.sh -b -p /opt/miniconda3

# 初始化 shell 环境
/opt/miniconda3/bin/conda init bash
source ~/.bashrc

# 验证
conda --version
```

### 第三步：创建 Python 虚拟环境

```bash
# 创建 Python 3.10 环境（名称可自定义）
conda create -n ai-compliance python=3.10 -y
conda activate ai-compliance
```

### 第四步：安装 Node.js 18（前端依赖）

```bash
# 使用 NodeSource 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node --version   # 应显示 v18.x.x
npm --version
```

### 第五步：上传/克隆项目文件

```bash
# 将项目放到 /opt/ai-compliance（可自定义路径）
sudo mkdir -p /opt/ai-compliance
sudo chown $USER:$USER /opt/ai-compliance

# 从本地 Mac 上传（在本地执行）
scp -r "/Users/macos/Documents/ai 合规 demo 4:28/." ubuntu@服务器IP:/opt/ai-compliance/

cd /opt/ai-compliance
```

### 第六步：配置环境变量

```bash
cp .env.example .env
nano .env
```

**裸机部署配置示例：**

```env
LLM_API_BASE=http://你的模型服务IP:8088/v1
LLM_API_KEY=your_api_key_here

# 裸机部署使用实际绝对路径
PERSIST_DIR=/opt/ai-compliance/chroma_db
DATA_DIR=/opt/ai-compliance/城投合规资料

EMBEDDING_MODEL=shibing624/text2vec-base-chinese
```

### 第七步：安装 Python 依赖

```bash
conda activate ai-compliance

# 设置 HuggingFace 国内镜像（国内服务器必须）
export HF_ENDPOINT=https://hf-mirror.com

# 安装依赖（PyTorch 较大，约 5~10 分钟）
pip install -r requirements.txt

# 验证关键包
python -c "import torch; import chromadb; import fastapi; print('依赖安装成功')"
```

### 第八步：修改启动脚本适配 Ubuntu

`start_backend.sh` 默认使用 Mac 的路径，需要修改：

```bash
# 备份原脚本
cp start_backend.sh start_backend.sh.mac.bak

# 创建 Ubuntu 版启动脚本
cat > start_backend_ubuntu.sh << 'EOF'
#!/bin/bash
echo "=================================================="
echo "          正在启动三重一大合规后端服务（Ubuntu）"
echo "=================================================="

# 设置 HuggingFace 国内镜像源
export HF_ENDPOINT=https://hf-mirror.com

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 终止占用 8000 端口的旧进程
echo "清理占用 8000 端口的旧进程..."
fuser -k 8000/tcp 2>/dev/null

echo "启动后端服务..."
# 使用 conda 环境中的 python
/opt/miniconda3/envs/ai-compliance/bin/python backend_full.py
EOF

chmod +x start_backend_ubuntu.sh
```

### 第九步：启动后端服务

```bash
# 前台启动（调试用）
./start_backend_ubuntu.sh

# 后台持久运行（推荐用 systemd，见下方）
nohup ./start_backend_ubuntu.sh > logs/backend.log 2>&1 &
```

### 第十步：构建并启动前端

```bash
cd /opt/ai-compliance/frontend

# 安装依赖
npm install

# 生产构建
npm run build

# 将 dist 目录通过 Nginx 托管（见下方 Nginx 配置）
```

### 第十一步：安装并配置 Nginx

```bash
sudo apt-get install -y nginx

# 创建 Nginx 配置
sudo tee /etc/nginx/sites-available/ai-compliance << 'EOF'
server {
    listen 80;
    server_name _;  # 替换为你的域名或 IP

    # 前端静态文件
    location / {
        root /opt/ai-compliance/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 代理后端流式输出（SSE 关键配置）
    location /audit_stream {
        proxy_pass http://127.0.0.1:8000/audit_stream;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;  # SSE 长连接，超时设长一些
    }

    # 代理其他 API 请求：必须保留 /api 前缀
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    # 直接代理所有后端接口（非 /api/ 前缀的）
    location ~ ^/(kb_stream|kb_stats|generate_template|ingest_file|parse_file|matter-types|contract|doc|cases) {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
EOF

# 启用站点并重启 Nginx
sudo ln -s /etc/nginx/sites-available/ai-compliance /etc/nginx/sites-enabled/
sudo nginx -t        # 测试配置语法
sudo systemctl restart nginx
sudo systemctl enable nginx
```

> `/issue-collect` 和 `/mobile-recorder` 是前端 SPA 路由，必须由 `location /` 的 `try_files $uri $uri/ /index.html;` 返回前端页面，再由前端根据路径渲染独立问题收集页或手机录音页。

---

## 环境变量配置

| 变量名 | Docker 部署值 | 裸机部署值 | 说明 |
|--------|--------------|-----------|------|
| `LLM_API_BASE` | `http://IP:端口/v1` | `http://IP:端口/v1` | 大模型 API 地址 |
| `LLM_API_KEY` | `your_key` | `your_key` | API Key，内网填 `empty` |
| `PERSIST_DIR` | `/app/chroma_db` | `/opt/ai-compliance/chroma_db` | 向量库路径 |
| `DATA_DIR` | `/app/data` | `/opt/ai-compliance/城投合规资料` | 原始文档路径 |
| `EMBEDDING_MODEL` | `shibing624/text2vec-base-chinese` | 同左 | 向量化模型 |
| `DASHSCOPE_API_KEY` | `your_key` | `your_key` | 阿里云百炼 API Key，用于 Fun-ASR 和图片 OCR |
| `DASHSCOPE_OCR_MODEL` | `qwen-vl-ocr` | `qwen-vl-ocr` | AI 会议图片 OCR 模型 |
| `DASHSCOPE_FUN_ASR_MODEL` | `paraformer-realtime-v2` | `paraformer-realtime-v2` | AI 会议实时语音识别模型 |

图片 OCR 走百炼 OpenAI 兼容接口 `/compatible-mode/v1/chat/completions`；实时语音识别走 Fun-ASR WebSocket。生产环境不要把 API Key 写入代码或提交到 Git。

---

## 初始化知识库

**首次部署必须执行**，否则合规问答功能无结果：

```bash
# 裸机部署
cd /opt/ai-compliance
export HF_ENDPOINT=https://hf-mirror.com
/opt/miniconda3/envs/ai-compliance/bin/python ingest_batch.py

# Docker 部署（进入容器执行）
docker compose exec backend python ingest_batch.py

# 验证知识库加载成功
curl http://localhost:8000/kb_stats
```

---

## 配置开机自启

### Docker 方式（推荐）

Docker 容器配置了 `restart: always`，`docker` 服务开机启动后容器自动恢复：

```bash
sudo systemctl enable docker
```

### 裸机方式（Systemd）

```bash
# 创建后端 Systemd 服务
sudo tee /etc/systemd/system/ai-compliance-backend.service << EOF
[Unit]
Description=AI Compliance Backend Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/ai-compliance
Environment=HF_ENDPOINT=https://hf-mirror.com
ExecStart=/opt/miniconda3/envs/ai-compliance/bin/python backend_full.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable ai-compliance-backend
sudo systemctl start ai-compliance-backend

# 查看服务状态
sudo systemctl status ai-compliance-backend

# 查看实时日志
sudo journalctl -u ai-compliance-backend -f
```

---

## ⚠️ 注意事项

### 1. 防火墙配置

Ubuntu 默认启用 UFW，需要开放端口：

```bash
sudo ufw allow 22/tcp     # SSH（必须！先开放，防止被锁定）
sudo ufw allow 80/tcp     # 前端 HTTP
sudo ufw allow 443/tcp    # HTTPS（如有域名）
sudo ufw allow 8000/tcp   # 后端 API（内网可访问时可不开放）
sudo ufw enable
sudo ufw status
```

> ⚠️ **必须先 `allow 22`，再 `enable` UFW，否则会断开 SSH！**

### 2. AI 会议外部分享入口与 HTTPS

AI 会议演示涉及两个独立外部入口：

| 入口 | 路径 | 说明 |
|------|------|------|
| 问题收集 | `/issue-collect?meetingId=...` | 部门人员登录/登记后填报问题，写回会议问题池 |
| 手机录音 | `/mobile-recorder?meetingId=...` | 参会人员手机登录/登记后录音、转写和签字 |

部署到服务器时：

- 后台里复制分享链接前，应通过正式域名或公网 HTTPS 地址访问系统，避免复制出 `localhost`。
- 手机录音需要麦克风权限，iOS / 安卓 / 鸿蒙的浏览器对非 HTTPS 环境限制较多，生产或演示建议配置 HTTPS。
- 如果使用 cpolar/ngrok 临时映射，应映射前端服务或 Nginx 入口，不要只映射后端 `8000`。

### 3. 国内服务器镜像加速

```bash
# HuggingFace 镜像（向量模型下载）
export HF_ENDPOINT=https://hf-mirror.com   # 写入 ~/.bashrc 永久生效

# pip 镜像（Python 包下载）
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# npm 镜像（前端包下载）
npm config set registry https://registry.npmmirror.com

# Docker 镜像（阿里云加速）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
EOF
sudo systemctl restart docker
```

### 4. 向量模型首次下载

`text2vec-base-chinese` 模型约 **400MB**，首次启动自动下载，可能需要 3~10 分钟。  
下载完成后缓存于 `~/.cache/huggingface/hub/`，后续启动无需再下载。

提前手动下载：
```bash
export HF_ENDPOINT=https://hf-mirror.com
/opt/miniconda3/envs/ai-compliance/bin/python -c \
  "from sentence_transformers import SentenceTransformer; SentenceTransformer('shibing624/text2vec-base-chinese')"
```

### 5. 文件上传大小限制

Nginx 默认只允许 1MB 文件上传，需要修改：

```bash
sudo nano /etc/nginx/nginx.conf
# 在 http {} 块中添加：
# client_max_body_size 100m;

sudo systemctl restart nginx
```

### 6. ChromaDB 数据备份

```bash
# 定期备份向量数据库
tar -czf /backup/chroma_db_$(date +%Y%m%d).tar.gz /opt/ai-compliance/chroma_db

# 建议设置定时任务
crontab -e
# 添加：0 2 * * * tar -czf /backup/chroma_db_$(date +\%Y\%m\%d).tar.gz /opt/ai-compliance/chroma_db
```

### 7. 内存不足处理

PyTorch + ChromaDB + FastAPI 合计约占用 **4~6GB 内存**，内存不足时：

```bash
# 添加 SWAP 空间（8GB 示例）
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# 永久生效
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 7. Nginx 流式输出（SSE）配置

前端使用 Server-Sent Events 实现流式审计结果，**Nginx 反向代理时必须关闭 Buffer**：

```nginx
proxy_buffering off;
proxy_cache off;
proxy_http_version 1.1;
proxy_set_header Connection '';
proxy_read_timeout 300s;
```

缺少这些配置会导致审计结果"卡住不显示"，最后一次性输出。

---

## 常见问题排查

| 问题现象 | 可能原因 | 解决方案 |
|----------|----------|----------|
| `pip install` 卡死或超时 | 网络访问 PyPI 慢 | 设置 pip 清华镜像源 |
| 模型下载失败 `ConnectionError` | HuggingFace 被墙 | `export HF_ENDPOINT=https://hf-mirror.com` |
| `Permission denied: port 80` | Linux 低端口需要 root | 用 Nginx 反向代理 8000 端口，或 `sudo setcap 'cap_net_bind_service=+ep' $(which python)` |
| Docker 构建时 `pip install` 超慢 | 容器内无镜像配置 | 在 `Dockerfile` 中添加 `RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple` |
| 审计结果不流式，卡住后一次输出 | Nginx 未关闭 proxy_buffering | Nginx 配置加 `proxy_buffering off` |
| `fuser -k 8000/tcp` 命令不存在 | Ubuntu 未安装 psmisc | `sudo apt install psmisc` |
| `SIGKILL` 导致 ChromaDB 数据损坏 | 强制 Kill 进程 | 改用 `kill -SIGTERM`；损坏后删除 `chroma_db/` 重新入库 |
| 前端 502 Bad Gateway | 后端未启动 | `sudo systemctl status ai-compliance-backend` 检查后端 |
| `OSError: [Errno 28] No space left` | 磁盘已满 | 清理 Docker 层或扩容，`docker system prune -a` |

---

## 📞 快速验证清单

```bash
# 1. 后端是否运行
curl http://localhost:8000/
# 期望：{"status": "ok"} 或类似响应

# 2. 知识库是否加载
curl http://localhost:8000/kb_stats

# 3. Nginx 是否运行
sudo systemctl status nginx

# 4. 前端是否可达（替换为实际 IP）
curl -I http://服务器IP/
# 期望：HTTP/1.1 200 OK

# 5. 分享入口是否由前端接管
curl -I "http://服务器IP/issue-collect?meetingId=demo"
curl -I "http://服务器IP/mobile-recorder?meetingId=demo"

# 6. 后端登录接口是否保留 /api 前缀
curl -I http://服务器IP/api/auth/me

# 7. Docker 部署状态检查
docker compose ps
docker compose logs --tail=50 backend
```

---

> 📋 本文档适配 Ubuntu 20.04 / 22.04，最后更新：2026-06-11
