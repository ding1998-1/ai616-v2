import os
import sys
import importlib
import requests
import logging

# 尝试加载配置文件 (如果存在)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("SystemCheck")

def check_package(package_name):
    try:
        importlib.import_id(package_name) if hasattr(importlib, 'import_id') else importlib.import_module(package_name)
        return True
    except ImportError:
        return False

def main():
    print("==================================================")
    print("        🚀 三重一大合规系统 - 环境状态巡检")
    print("==================================================")

    # 1. 检查 Python 依赖
    print("\n[1/4] 核心依赖库状态:")
    required_pkgs = ["langchain", "chromadb", "sentence_transformers", "fastapi", "torch", "pypdf"]
    all_ok = True
    for pkg in required_pkgs:
        status = "🟢 已安装" if check_package(pkg) else "🔴 未找到"
        if "未找到" in status: all_ok = False
        print(f"  - {pkg:<25} {status}")

    # 2. 检查外部 API 连通性
    print("\n[2/4] 模型服务连通性:")
    api_url = os.getenv("LLM_API_BASE", "http://192.168.66.44:8088/v1")
    try:
        # 尝试访问 API 的 models 接口
        resp = requests.get(f"{api_url}/models", timeout=3)
        if resp.status_code == 200:
            print(f"  - LLM API ({api_url}) 🟢 正常响应")
        else:
            print(f"  - LLM API ({api_url}) 🟡 响应异常 (HTTP {resp.status_code})")
    except Exception as e:
        print(f"  - LLM API ({api_url}) 🔴 无法连接: {e}")

    # 3. 检查向量数据库存储
    print("\n[3/4] 向量知识库状态:")
    db_path = os.getenv("PERSIST_DIR", "/Users/macos/Documents/ai 合规 demo/chroma_db")
    if os.path.exists(db_path):
        sqlite_file = os.path.join(db_path, "chroma.sqlite3")
        if os.path.exists(sqlite_file):
            size_mb = os.path.getsize(sqlite_file) / (1024 * 1024)
            print(f"  - 向量数据库目录 🟢 存在")
            print(f"  - 索引数据库文件 🟢 正常 ({size_mb:.2f} MB)")
        else:
            print(f"  - 向量数据库目录 🟡 存在，但未见 sqlite3 索引文件")
    else:
        print(f"  - 向量数据库目录 🔴 未找到 (路径: {db_path})")

    # 4. 检查前端端口
    print("\n[4/4] 运行环境端口:")
    import socket
    def check_port(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('localhost', port)) == 0
    
    print(f"  - 后端服务 (8000) {'🟢 运行中' if check_port(8000) else '⚪ 未启动'}")
    print(f"  - 前端界面 (3000) {'🟢 运行中' if check_port(3000) else '⚪ 未启动'}")

    print("\n==================================================")
    if all_ok:
        print("✅ 检测完成：系统基础环境良好，可以正常启动。")
    else:
        print("❌ 检测完成：发现环境异常，请检查上述红色标记项。")
    print("==================================================")

if __name__ == "__main__":
    main()
