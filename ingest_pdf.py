import os
import argparse
import logging
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from sentence_transformers import SentenceTransformer

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
    parser = argparse.ArgumentParser(description="Ingest a specific PDF into ChromaDB")
    parser.add_argument("pdf_path", type=str, help="Path to the PDF file")
    args = parser.parse_args()

    file_path = args.pdf_path
    if not os.path.exists(file_path):
        logger.error(f"File not found: {file_path}")
        return

    logger.info(f"Loading PDF: {file_path}")
    loader = PyPDFLoader(file_path)
    try:
        documents = loader.load()
    except Exception as e:
        logger.error(f"Failed to load PDF using PyPDFLoader: {e}")
        # Try pdfplumber as fallback
        from langchain_community.document_loaders import PDFPlumberLoader
        logger.info("Retrying with PDFPlumberLoader...")
        loader2 = PDFPlumberLoader(file_path)
        documents = loader2.load()

    logger.info(f"Loaded {len(documents)} pages from PDF.")

    logger.info("Splitting text into chunks...")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=600,
        chunk_overlap=150,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " "]
    )
    splits = text_splitter.split_documents(documents)
    
    # Add metadata to indicate source
    for split in splits:
        split.metadata["source"] = os.path.basename(file_path)

    logger.info(f"Created {len(splits)} text chunks.")

    logger.info(f"Initializing embedding model: {EMBEDDING_MODEL}")
    embeddings = STLangChainEmbeddings(EMBEDDING_MODEL)

    logger.info(f"Adding chunks to Chroma database at {PERSIST_DIR}...")
    vectorstore = Chroma(
        persist_directory=PERSIST_DIR,
        embedding_function=embeddings
    )
    
    vectorstore.add_documents(documents=splits)
    logger.info(f"✅ Successfully ingested '{os.path.basename(file_path)}' into ChromaDB!")

if __name__ == "__main__":
    main()
