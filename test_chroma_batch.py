import os
from langchain_chroma import Chroma
from sentence_transformers import SentenceTransformer

PERSIST_DIR = "/Users/macos/Documents/ai 合规 demo/chroma_db"
EMBEDDING_MODEL = "shibing624/text2vec-base-chinese"

class STLangChainEmbeddings:
    def __init__(self, model_name: str):
        self._model = SentenceTransformer(model_name)
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()
    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], normalize_embeddings=True).tolist()[0]

def test_query():
    print("Initialize Embeddings...")
    embeddings = STLangChainEmbeddings(EMBEDDING_MODEL)
    
    print("Loading ChromaDB...")
    vectorstore = Chroma(
        persist_directory=PERSIST_DIR,
        embedding_function=embeddings
    )
    
    # 模拟用户可能会问的涉及宁波地方国资管理的问题
    query = "根据《宁波市属企业资产评估管理办法》或有关规定，哪些情况需要进行资产评估？大宗物资采购有什么规范要求？"
    
    print(f"\n==================================================")
    print(f"🧐 [User Query]: {query}")
    print(f"==================================================")
    
    results = vectorstore.similarity_search_with_score(query, k=5)
    
    if not results:
        print("❌ No matching chunks found.")
        return
        
    print("✅ Successfully retrieved the following chunks:")
    for idx, (doc, score) in enumerate(results):
        print(f"\n[{idx+1}] Score: {score:.4f} | Source: {doc.metadata.get('source', 'Unknown')}")
        content = doc.page_content.replace('\n', ' ').strip()
        print(f"Content Snippet: {content[:150]}...")

if __name__ == "__main__":
    test_query()
