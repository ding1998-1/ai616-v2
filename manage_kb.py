import os
import argparse
import sys
import logging
import glob
from langchain_community.document_loaders import PyPDFLoader, PDFPlumberLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from sentence_transformers import SentenceTransformer

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("KBManager")

# 默认配置
PERSIST_DIR = "/Users/macos/Documents/ai 合规 demo/chroma_db"
DATA_DIR = "/Users/macos/Documents/ai 合规 demo/城投合规资料"
EMBEDDING_MODEL = "shibing624/text2vec-base-chinese"

class STLangChainEmbeddings:
    def __init__(self, model_name: str):
        self._model = SentenceTransformer(model_name)
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()
    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], normalize_embeddings=True).tolist()[0]

def get_vectorstore():
    embeddings = STLangChainEmbeddings(EMBEDDING_MODEL)
    return Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)

def stats():
    """查看数据库统计信息"""
    if not os.path.exists(PERSIST_DIR):
        print(f"❌ 数据库目录不存在: {PERSIST_DIR}")
        return
    
    try:
        vs = get_vectorstore()
        col = vs._collection
        count = col.count()
        print(f"==================================================")
        print(f"📊 知识库统计 (ChromaDB)")
        print(f"==================================================")
        print(f"  - 存储路径: {PERSIST_DIR}")
        print(f"  - 总向量切片数: {count}")
        
        # 尝试提取来源统计
        results = col.get(include=['metadatas'])
        sources = set()
        for meta in results['metadatas']:
            if meta and 'source' in meta:
                sources.add(meta['source'])
        
        print(f"  - 包含原始文档数: {len(sources)}")
        if sources:
            print(f"  - 文档列表: ")
            for s in sorted(list(sources)):
                print(f"    • {s}")
        print(f"==================================================")
    except Exception as e:
        print(f"❌ 读取数据库统计失败: {e}")

def query(text):
    """进行简单的语义检索测试"""
    print(f"🔍 正在检索: '{text}'...")
    vs = get_vectorstore()
    results = vs.similarity_search_with_score(text, k=3)
    
    for i, (doc, score) in enumerate(results):
        print(f"\n[{i+1}] 匹配度: {1-score:.4f} | 来源: {doc.metadata.get('source')}")
        print(f"内容摘要: {doc.page_content[:200]}...")

def rebuild():
    """清空并全量重构索引"""
    import shutil
    if os.path.exists(PERSIST_DIR):
        print(f"⚠️ 正在清空旧数据库: {PERSIST_DIR}...")
        shutil.rmtree(PERSIST_DIR)
        os.makedirs(PERSIST_DIR)

    # 扫描所有 docx 和 pdf
    docs_files = glob.glob(os.path.join(DATA_DIR, "**/*.docx"), recursive=True)
    pdf_files = glob.glob(os.path.join(DATA_DIR, "**/*.pdf"), recursive=True)
    all_files = docs_files + pdf_files
    
    print(f"📂 发现待入库文件 {len(all_files)} 份...")
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=150)
    all_splits = []
    
    for f in all_files:
        filename = os.path.basename(f)
        try:
            if f.endswith('.pdf'):
                loader = PyPDFLoader(f)
            else:
                loader = Docx2txtLoader(f)
            
            data = loader.load()
            splits = text_splitter.split_documents(data)
            for s in splits:
                s.metadata["source"] = filename
            all_splits.extend(splits)
            print(f"  ✅ 已解析: {filename} ({len(splits)} 切片)")
        except Exception as e:
            print(f"  ❌ 解析失败: {filename} - {e}")

    if all_splits:
        print(f"🚀 正在生成向量并存入数据库 (共 {len(all_splits)} 个切片)...")
        vs = Chroma.from_documents(
            documents=all_splits, 
            embedding=STLangChainEmbeddings(EMBEDDING_MODEL),
            persist_directory=PERSIST_DIR
        )
        print(f"✅ 全量重构完成！")
        stats()

def main():
    parser = argparse.ArgumentParser(description="知识库统一管理工具")
    parser.add_argument("command", choices=["rebuild", "stats", "query"], help="执行命令")
    parser.add_argument("--q", type=str, help="查询关键字 (仅用于 query 命令)")
    
    args = parser.parse_args()
    
    if args.command == "rebuild":
        rebuild()
    elif args.command == "stats":
        stats()
    elif args.command == "query":
        if not args.q:
            print("❌ 请使用 --q 提供查询关键字")
            return
        query(args.q)

if __name__ == "__main__":
    main()
