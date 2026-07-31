import os
import argparse
import logging
from langchain_community.document_loaders import PyPDFLoader, PDFPlumberLoader, Docx2txtLoader
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
    files_to_ingest = [
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于调整部分产权管理事项审批方式的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于调整市属企业资产处置审批权限的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于贯彻落实《企业国有资产交易监督管理办法》有关事项的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于规范和发展产权交易市场若干意见.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于规范市属国有企业大宗物资采购管理有关问题解释.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于加强市属企业房屋出租管理工作的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于进一步促进企业国有产权有序流转有关事项的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于进一步规范市本级国有企业资产租赁管理的通知.pdf",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于进一步规范市属企业国有资产管理的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于进一步加强市属企业国有产权管理工作的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于印发《关于推动国有股东与所控股上市公司解决同业竞争规范关联交易的指导意见》的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于印发《市属国有企业增资扩股公开选择投资者管理办法（试行）》的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/关于印发《市属企业国有产权转让管理办法》的通知(甬国资发[2015]39号).docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/宁波市财政局关于印发《宁波市行政事业性国有资产管理暂行办法》的通知.docx",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/宁波市市级行政事业单位国有资产出租和处置进场交易实施细则.pdf",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/宁波市属企业资产评估管理办法.pdf",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/甬国资发(2019)54号《市属企业国有资产评估管理实施办法》.pdf",
        "/Users/macos/Documents/ai 合规 demo/城投合规资料/宁波产权交易中心/地方政策及文件/浙江省企业国有产权转让管理暂行办法.docx"
    ]

    all_splits = []
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=600,
        chunk_overlap=150,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " "]
    )

    for file_path in files_to_ingest:
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            continue

        filename = os.path.basename(file_path)
        logger.info(f"Loading '{filename}'...")
        
        try:
            if file_path.lower().endswith('.pdf'):
                loader = PyPDFLoader(file_path)
                documents = loader.load()
            elif file_path.lower().endswith('.docx'):
                loader = Docx2txtLoader(file_path)
                documents = loader.load()
            else:
                logger.warning(f"Unsupported file format for: {filename}")
                continue
                
        except Exception as e:
            logger.error(f"Failed to load {filename}: {e}")
            if file_path.lower().endswith('.pdf'):
                try:
                    logger.info("Retrying PDF with PDFPlumberLoader...")
                    loader = PDFPlumberLoader(file_path)
                    documents = loader.load()
                except Exception as inner_e:
                    logger.error(f"Failed again: {inner_e}")
                    continue
            else:
                continue

        # Split and add metadata
        splits = text_splitter.split_documents(documents)
        for split in splits:
            split.metadata["source"] = filename
            all_splits.append(split)
            
        logger.info(f"-> Created {len(splits)} chunks from '{filename}'.")

    if not all_splits:
        logger.error("No valid documents to ingest!")
        return

    logger.info(f"Initializing embedding model: {EMBEDDING_MODEL}")
    embeddings = STLangChainEmbeddings(EMBEDDING_MODEL)

    total_chunks = len(all_splits)
    logger.info(f"Adding total {total_chunks} chunks to Chroma database at {PERSIST_DIR}...")
    
    vectorstore = Chroma(
        persist_directory=PERSIST_DIR,
        embedding_function=embeddings
    )
    
    vectorstore.add_documents(documents=all_splits)
    logger.info(f"✅ Successfully ingested {len(files_to_ingest)} documents ({total_chunks} chunks) into ChromaDB!")

if __name__ == "__main__":
    main()
