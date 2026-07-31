FROM python:3.10

WORKDIR /app

# python:3.10 镜像已包含编译工具，无需额外安装

# 复制依赖配置并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 启动服务
CMD ["uvicorn", "backend_full:app", "--host", "0.0.0.0", "--port", "8000"]
