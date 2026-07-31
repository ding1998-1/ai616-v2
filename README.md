# 🛡️ 昇晟“三重一大”智能合规审核与法务对比系统 (Master Context)

> **项目状态**: 生产级核心架构固化，集成 RAG + Multi-Agent + OnlyOffice 协同能力。
> **AI 友好度**: 100% (包含完整架构、API Schema 及逻辑流，方便其他 AI 快速接管)。

---

## 🧩 1. 系统核心愿景 (Vision)
本系统专为国企“三重一大”决策审计设计，通过 **Agent (智能体大脑)** + **Skill (原子级技能探针)** 架构，将碎片化的监管政策转化为实时、可穿溯的合规能力，消除审计盲区。

---

## 🏗️ 2. 技术架构全景 (Architecture)

### 🎨 前端 (Frontend)
- **核心框架**: React 18 + Ant Design 5.0
- **核心组件**:
  - `ComplianceAudit.jsx`: 基于 SSE 的流式审核中心。
  - `KnowledgeLibrary.jsx`: RAG 向量库管理界面。
  - `CaseAnalysis.jsx`: 法务案例相似度比对看板。
  - `OfficeEditor.jsx`: 集成 **OnlyOffice**，支持 `Audit Navigator` 插件实现问题定位。

### ⚙️ 后端 (Backend)
- **核心框架**: FastAPI (异步高性能 Web 服务)
- **AI 引擎**: 
  - **LLM**: DeepSeek V3 (支持 Reasoning 思考链) + Qwen 2.5 (本地备份)。
  - **Embedding**: `shibing624/text2vec-base-chinese` (HuggingFace 语义空间)。
  - **Agent 框架**: LangChain + 自研确定性流水线 (Pipeline)。
- **存储层**:
  - **向量库**: ChromaDB (持久化本地索引)。
  - **数据库**: 基于文件系统的 JSON/SQLite 混合存储 (案件库)。

### 📦 部署环境 (Environment)
- **端口映射**:
  - `3000`: 前端开发服务器
  - `8000`: 后端 API
  - `8081`: OnlyOffice Document Server (Docker)
- **关键路径**:
  - `/chroma_db`: 知识库向量索引。
  - `/data/contracts`: 数字化合同与审核结果缓存。

---

## 🧠 3. 核心业务逻辑流 (Workflows)

### 🛡️ A. 智能合规审核 (Thinking Mode Audit)
1. **输入**: 事项类型 (重大决策/大额资金等) + 材料文本。
2. **Pipeline**:
   - `extract_rules`: 从 `RULES_DB` 提取红线。
   - `validate_material`: 文本语义交叉校验。
   - `check_procedure`: 穿透式程序完整性核查。
   - `identify_responsibility`: 责权主体自动化溯源。
   - `generate_compliance_report`: 生成符合国企公文规范的 Markdown 报告。
3. **输出**: SSE 流式反馈，包含 `reasoning_content` (AI 思考链) 及可视化雷达灯。

### 📚 B. 企业知识库 (RAG)
- **摄取**: 支持 PDF/Docx/TXT，自动分片 (Chunking) 并持久化。
- **检索**: 使用 MMR (最大边际相关性) 算法，确保召回的多样性与准确性。

### ⚖️ C. 法务对比 (Legal Comparison)
- **逻辑**: 通过向量空间计算当前案情与历史案例库的相似度。
- **输出**: 胜诉率预测、风险等级、相似案例证据链。

---

## 🔌 4. 关键 API 契约 (AI 快速查阅)

| 端点 | 方法 | 功能 |
| :--- | :--- | :--- |
| `/audit_stream` | `POST` | 流式合规审核 (SSE)，需 `matter_type` 与 `material_text` |
| `/kb_stream` | `POST` | 知识库问答 (RAG)，基于语义检索 |
| `/doc/edit_url` | `POST` | 获取 OnlyOffice 编辑配置与 Navigator 插件 Token |
| `/legal-compare` | `POST` | 执行法务案例相似度分析 |

---

## 🛠️ 5. AI 接管指南 (How to Continue)
如果你是新接手的 AI 助手，请关注以下重点：
1. **Prompt 模板**: 位于 `backend_full.py` 的 `generate_compliance_report` 工具中，包含了严格的 XML 雷达格式定义。
2. **OnlyOffice 插件**: `Audit Navigator` 插件逻辑在后端 `/doc/plugin/navigator/` 系列路由中动态下发。
3. **向量更新**: 若要重置知识库，需物理删除 `/chroma_db` 目录。

---
> 📋 **README Version**: 2.3.0 | **Last Updated**: 2026-04-23
> **Antigravity 自动化运维系统固化**
