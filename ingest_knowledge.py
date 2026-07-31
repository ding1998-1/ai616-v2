import os
import glob
from langchain_community.document_loaders import Docx2txtLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = "/Users/macos/Documents/ai 合规 demo/城投合规资料"
PERSIST_DIR = "/Users/macos/Documents/ai 合规 demo/chroma_db"
EMBEDDING_MODEL = "shibing624/text2vec-base-chinese"

def load_documents(data_dir):
    docs = []
    # Find all docx and txt files recursively
    docx_files = glob.glob(os.path.join(data_dir, "**", "*.docx"), recursive=True)
    txt_files = glob.glob(os.path.join(data_dir, "**", "*.txt"), recursive=True)
    
    logger.info(f"Found {len(docx_files)} DOCX files and {len(txt_files)} TXT files.")
    
    for file_path in docx_files:
        try:
            loader = Docx2txtLoader(file_path)
            docs.extend(loader.load())
        except Exception as e:
            logger.error(f"Error loading {file_path}: {e}")
            
    for file_path in txt_files:
        try:
            loader = TextLoader(file_path, encoding='utf-8')
            docs.extend(loader.load())
        except Exception as e:
            logger.error(f"Error loading {file_path}: {e}")
            
    return docs

def main():
    logger.info("Loading documents...")
    documents = load_documents(DATA_DIR)
    if not documents:
        logger.warning("No documents loaded. Exiting.")
        return
        
    logger.info(f"Loaded {len(documents)} document objects.")
    
    # Split documents
    logger.info("Splitting documents...")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
    )
    splits = text_splitter.split_documents(documents)
    logger.info(f"Created {len(splits)} text chunks.")
    
    # Initialize embeddings
    logger.info(f"Initializing embedding model: {EMBEDDING_MODEL}")
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        # Default execution uses CPU or whatever PyTorch auto-detects
        model_kwargs={'device': 'cpu'}, # Use 'mps' if Apple Silicon supports this model optimally, but 'cpu' is safer generally for embedding locally
        encode_kwargs={'normalize_embeddings': True}
    )
    
    # Create and persist vectorstore
    logger.info("Building Chroma vector database...")
    vectorstore = Chroma.from_documents(
        documents=splits,
        embedding=embeddings,
        persist_directory=PERSIST_DIR
    )
    
    logger.info(f"Successfully ingested {len(splits)} chunks into ChromaDB at {PERSIST_DIR}")

if __name__ == "__main__":
    main()
