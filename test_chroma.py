import os
from langchain_chroma import Chroma
from sentence_transformers import SentenceTransformer
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PERSIST_DIR = "/Users/macos/Documents/ai 合规 demo/chroma_db"
EMBEDDING_MODEL = "shibing624/text2vec-base-chinese"

class STLangChainEmbeddings:
    def __init__(self, model_name: str):
        self._model = SentenceTransformer(model_name)
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, normalize_embeddings=True).tolist()
    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], normalize_embeddings=True).tolist()[0]

def main():
    logger.info(f"Connecting to Chroma database at {PERSIST_DIR}...")
    embeddings = STLangChainEmbeddings(EMBEDDING_MODEL)
    
    vectorstore = Chroma(
        persist_directory=PERSIST_DIR,
        embedding_function=embeddings
    )
    
    # Check total documents
    try:
        total_docs = vectorstore._collection.count()
        logger.info(f"Total documents in Chroma DB: {total_docs}")
    except Exception as e:
        logger.warning(f"Could not get total count directly: {e}")
        
    # Filter directly by metadata to prove the file exists
    logger.info("Executing Exact Metadata Filter: {'source': '601985_20251224_1JKG.pdf'}")
    
    results = vectorstore.get(where={"source": "601985_20251224_1JKG.pdf"})
    
    print("\n" + "="*50)
    print("🔍 [TEST RESULTS] Exact Metadata Matches:")
    print("="*50)
    
    found_target = False
    documents = results.get('documents', [])
    metadatas = results.get('metadatas', [])
    
    if len(documents) > 0:
        found_target = True
        logger.info(f"Found {len(documents)} chunks belonging to the PDF.")
        for i in range(min(3, len(documents))):
            print(f"\n[{i+1}] Source: {metadatas[i].get('source')}")
            print(f"Content Snippet: {documents[i][:200]}...")

        
    print("\n" + "="*50)
    if found_target:
        print("✅ SUCCESS: The PDF has been successfully mapped into the AI's semantic space!")
    else:
        print("⚠️ WARNING: Could not find the specific PDF in the top results. It might require an exact metadata filter.")

if __name__ == "__main__":
    main()
