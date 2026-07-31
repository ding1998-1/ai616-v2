# 🛠️ 昇晟合规系统：核心技术实现手册 (AI Developer Guide)

> 本文档旨在为后续接手的 AI 助手提供深度的系统实现细节，确保逻辑延续性。

---

## 1. 核心 AI 管道 (The Audit Pipeline)

系统放弃了不稳定的 `ReAct` 循环，采用 **确定性过程化管道 (Procedural Pipeline)**。

### 🔧 技能工具链 (Toolbox)
1. **`extract_rules`**: 基于硬编码的 `RULES_DB`。
2. **`validate_material`**: 采用关键词命中率与语义匹配。
3. **`check_procedure_completeness`**: 检查文本中是否包含预设的决策环节。
4. **`identify_responsibility`**: 检查责任主体关键词。
5. **`generate_compliance_report`**: **关键组件**。
   - **Prompt**: 强制要求输出以 `<risk_radar>` 开头的 XML 块。
   - **Output**: 必须包含 `evidence:"..."` 和 `remediate:"..."` 的自定义 Markdown 链接语法，前端依赖这些语法实现高亮和按钮渲染。

### 🧠 思考链 (Reasoning)
- 调用 DeepSeek V3 时开启 `thinking` 模式。
- 后端通过 SSE `thinking_chunk` 类型实时推送思考内容，前端在“思考视窗”展示。

---

## 2. OnlyOffice & 证据锚定 (Document Integration)

### 🖇️ Audit Navigator 插件
- **GUID**: `asc.{823A43AE-971A-4C2E-8041-356C197BA3C8}`
- **端点**: `/doc/plugin/audit_navigator/{config.json,index.html,icon.png}`
- **逻辑**:
  1. 前端监听到用户点击报告中的 `evidence` 链接。
  2. 调用 `OfficeEditor` 的 `jumpToBookmark(bookmarkName)`。
  3. 通过 `postMessage` 向 OnlyOffice IFrame 发送 `JUMP_TO_BOOKMARK` 指令。
  4. 插件调用 `Asc.plugin.executeMethod("GoToBookmark", [bookmarkName])` 跳转。
  5. 文字替换：`SearchAndReplace([original, replacement, false])`（三个独立参数，非对象）

### 💾 保存回调 (Callback)
- **URL**: `/doc/callback`
- **逻辑**: 监听 `status: 2` (准备保存)，下载 URL 指向的临时文件并覆盖本地 `data/docs/` 下的原始文件。

### 📄 书签系统 (Bookmark System)
- **命名规则**: `risk_{risk_id}` 或降级 `audit_para_{para_index}`
- **meta.json**: 上传时生成，记录 `{para_index, bookmark_name, text_preview}` 映射
- **API**: `/contract/analyze` 返回的 `review_points` 包含 `bookmark_name` 字段

---

## 3. 文档管理 (Document CRUD)

### 存储位置
- **上传文档**: `data/docs/{uuid}_{原始文件名}.docx`
- **元数据**: `data/docs/{uuid}_{原始文件名}.meta.json`（段落书签映射）
- **审查结果**: `data/contracts/{saved_name}.issues.json`

### 知识文库 API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge_files` | 获取文件列表（持久化） |
| POST | `/api/knowledge_files` | 添加文件记录 |
| DELETE | `/api/knowledge_files/{file_id}` | 删除文件 |
| POST | `/api/knowledge_files/{file_id}/vectorize` | 切换向量化状态 |
| POST | `/api/knowledge_files/{file_id}/link` | 切换关联状态 |
| POST | `/parse_file` | 解析文件（.docx/.pdf/.txt） |
| POST | `/ingest_file` | 向量化入库 |
| GET | `/kb_stats` | 知识库状态 |

### 知识文库存储
- 文件记录：`data/knowledge_files/files.json`（JSON 持久化）
- 向量数据：ChromaDB (`chroma_db/`)
- 可编辑文档：`data/docs/{uuid}_{文件名}.docx`

### API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/doc/upload` | 上传 .docx 文件，自动插入书签 |
| GET | `/doc/download/{saved_name}` | 下载文档 |
| GET | `/doc/list` | 列出所有文档 |
| DELETE | `/doc/delete/{saved_name}` | 删除文档 |
| POST | `/doc/selection` | 获取指定书签的段落信息 |
| POST | `/doc/submit_suggestion` | 提交修改建议 |
| POST | `/contract/map_doc_structure` | 解析文档结构（段落列表） |
| POST | `/contract/analyze` | 分析合同风险，返回含 `bookmark_name` 的审查点 |
| GET | `/contract/issues/{saved_name}` | 获取审查结果 |

### 文件命名规则
- 格式: `{uuid}_{原始文件名}` - UUID 保证唯一性，保留原始名便于识别
- `saved_name` = `{uuid}_{原始文件名}`，用于所有后续 API 调用

### meta.json 结构
```json
{
  "filename": "原始文件名.docx",
  "saved_as": "uuid_原始文件名.docx",
  "paragraphs": [
    {"para_index": 7, "bookmark_name": "audit_para_7", "text_preview": "..."}
  ]
}
```

---

## 4. RAG 知识库配置 (Vector Store)

- **Model**: `text2vec-base-chinese` (512维度)。
- **Storage**: ChromaDB (本地持久化)。
- **Search Strategy**: MMR (Max Marginal Relevance)，设置 `fetch_k=12` 以增加召回多样性。

---

## 5. 前端状态管理 (Frontend Logic)

- **SSE 处理**: 使用 `fetchEventSource` (或自定义 `EventSource`)。
- **报告渲染**: 自定义 Markdown 渲染器，拦截以下链接：
  - `evidence:"text"` -> 触发编辑器跳转。
  - `remediate:"prompt"` -> 触发新任务生成。

---

## 6. 待办事项与扩展建议 (Roadmap)
1. **多模态支持**: 当前仅支持文本，后续可扩展 PDF 表格解析（Skill 5）。
2. **知识库热更新**: 实现 `/api/ingest_file` 的即时索引更新。
3. **法律案例扩展**: 增强 `case_similarity.py` 的余弦相似度计算权重。

---
> 🚀 **AI Context Ready**. 如果你是接手的 AI，请直接阅读 `backend_full.py` 的 `audit_stream` 函数以获取最新逻辑。
