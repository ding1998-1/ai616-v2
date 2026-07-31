# Agent: 知识库与 RAG (Knowledge Base & RAG)

## 功能概述

基于 ChromaDB 向量数据库的 RAG 系统，支持上传制度文件、案例、模板，进行语义检索和合规问答。

## 核心文件

| 文件 | 职责 |
|------|------|
| `frontend/src/pages/KnowledgeBase.jsx` | 合规问答页面（11KB） |
| `frontend/src/pages/KnowledgeLibrary.jsx` | 知识文库管理（43KB） |
| `backend_full.py` L4821 | RAG 问答流式 API (`POST /kb_stream`) |
| `backend_full.py` L4963 | 文件解析 (`POST /parse_file`) |
| `backend_full.py` L5160 | 文件入库 (`POST /ingest_file`) |
| `backend_full.py` L5231 | 知识库统计 (`GET /kb_stats`) |
| `backend_full.py` L5412 | 知识文件管理 CRUD |

## RAG 流程

```
用户提问
  → POST /kb_stream (SSE)
  → ChromaDB 语义检索 (MMR 策略)
  → 取 Top-K 相关片段
  → DeepSeek 基于检索结果生成回答
  → SSE 流式返回
```

## 文件入库流程

```
上传文件 (docx/pdf/txt)
  → POST /parse_file (解析文本)
  → POST /ingest_file
    → 文本分块 (chunk)
    → text2vec-base-chinese 向量化
    → 存入 ChromaDB
  → 记录到 data/knowledge_files/files.json
```

## 知识文件分类

| 类型 | 说明 |
|------|------|
| `case` | 案例 |
| `regulation` | 法规制度 |
| `template` | 模板 |
| `other` | 其他 |

## ChromaDB 配置

- **路径**: `chroma_db/`
- **嵌入模型**: `shibing624/text2vec-base-chinese` (GPU 0)
- **检索策略**: MMR (Maximum Marginal Relevance)
- **集合**: 默认集合存储所有知识文件向量

## 相关 API

| 端点 | 功能 |
|------|------|
| `POST /api/knowledge_files` | 添加知识文件记录 |
| `PUT /api/knowledge_files/{id}` | 更新知识文件 |
| `DELETE /api/knowledge_files/{id}` | 删除知识文件 |
| `POST /api/knowledge_files/{id}/vectorize` | 切换向量化状态 |
| `POST /api/knowledge_files/{id}/link` | 切换关联状态 |
| `GET /api/kb_stats` | 知识库统计 |
| `POST /api/ocr/image` | OCR 图片文字提取 |
