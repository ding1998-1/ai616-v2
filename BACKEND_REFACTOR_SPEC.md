# 后端一次性模块化重构规范

## 决策

- 本地一次性完成 `backend_full.py` 的有效功能迁移，不采用长期双轨。
- `backend/main.py` 成为唯一 FastAPI 应用入口。
- `backend_full.py` 在验收期只作为行为对照，不被新服务导入，不再承载运行入口。
- 所有现有公开 URL 保持兼容；前端不因文件拆分而改变业务流程。
- 全量接口、WebSocket、SSE、文件和后台任务回归通过后，再一次性切换远端服务。

## 当前规模

- `backend_full.py`：9,766 行。
- `backend/db.py`：1,906 行。
- 当前扫描到约 149 个路由、模型、服务函数与后台任务入口。
- 当前运行命令：`uvicorn backend_full:app`。
- 已存在 `backend/main.py`、`backend/routes/` 与 `backend/services/`，但未覆盖全部主业务。
- 会议主流程与辅助流程已拆到 `routes/` + `services/`：认证、用户、会议、议题、材料、计时、录音、转写、成果、签字、权限、Whisper 终审、校订、发言人改派、实时待办、设置与文档状态。
- `app_factory.create_core_app()` 是唯一应用装配位置；业务工具域完成迁移并通过路径对照后，`backend/main.py` 只负责环境设置、生命周期和启动，不再重复注册路由。
- 项目运行环境以 `requirements_frozen.txt` 为准，禁止混用系统 FastAPI 与项目 Starlette；当前锁定 FastAPI 0.135.1、Starlette 0.52.1。
- `backend_full.py` 仅保留为验收期行为对照，模块化入口不得导入它。
- 主入口生命周期负责启动 ASR 恢复缓存的过期清理任务；关闭时必须取消并等待该任务，避免多 worker 中遗留孤儿协程。

## 目标结构

```text
backend/
├── main.py
├── app_factory.py
├── config.py
├── dependencies.py
├── errors.py
├── middleware.py
├── schemas/
│   ├── auth.py
│   ├── meetings.py
│   ├── agendas.py
│   ├── recordings.py
│   ├── transcripts.py
│   ├── outcomes.py
│   ├── permissions.py
│   ├── knowledge.py
│   ├── documents.py
│   └── contracts.py
├── routes/
│   ├── health.py
│   ├── auth.py
│   ├── users.py
│   ├── meetings.py
│   ├── agendas.py
│   ├── recordings.py
│   ├── transcripts.py
│   ├── outcomes.py
│   ├── permissions.py
│   ├── todos.py
│   ├── knowledge.py
│   ├── compliance.py
│   ├── documents.py
│   ├── contracts.py
│   ├── notifications.py
│   └── exports.py
├── services/
│   ├── meeting_service.py
│   ├── agenda_service.py
│   ├── recording_service.py
│   ├── transcript_service.py
│   ├── outcome_service.py
│   ├── signature_service.py
│   ├── permission_service.py
│   ├── knowledge_service.py
│   ├── compliance_service.py
│   ├── document_service.py
│   └── contract_service.py
├── repositories/
│   ├── database.py
│   ├── meeting_repository.py
│   ├── agenda_repository.py
│   ├── transcript_repository.py
│   ├── outcome_repository.py
│   ├── user_repository.py
│   └── file_repository.py
├── clients/
│   ├── llm_client.py
│   ├── dashscope_asr.py
│   ├── qwen_asr.py
│   ├── vector_store.py
│   └── document_converter.py
└── workers/
    ├── whisper_review.py
    ├── recovery.py
    └── todo_deadlines.py
```

## 依赖方向

```text
main
  → routes
    → services
      → repositories / clients
        → config
```

禁止：

- repository 导入 route 或 service。
- service 直接依赖 FastAPI `Request`、`Response` 或 `HTTPException`。
- route 直接执行 SQL。
- 前端字段名在多个路由中重复手工转换。
- 宽泛捕获异常后静默 `pass`。
- 新模块反向导入 `backend_full.py`。

## 业务域

### 会议域

- 会议 CRUD、阶段推进、文号、材料、计时、归档与导出。

### 议题域

- 正式议题、临时议题、当前议题、记录、决议、版本与检索对象。

### 录音与转写域

- 录音会话、分块上传、完整性确认、原件下载、ASR WebSocket、转写修正与发言人。

### 成果与签署域

- 会议纪实、纪要、议题决议、待办、版本快照、签署任务与归档拦截。

### 用户与权限域

- 账号、组织、全局角色、会议角色、议题 ACL 与保密过滤。

### 知识与合规域

- 议题级会议知识、制度资料、向量库、合规审查和案例检索。

### 文档与合同域

- 上传、解析、前端预览、书签、修改建议、导出和合同分析。

### 明确移除：OnlyOffice

- 新后端不迁移 OnlyOffice editor page、插件、callback 和服务发现逻辑。
- 新部署包不包含 DocumentServer 与 OnlyOffice 数据目录。
- 前端文档预览继续使用 `docx-preview`。
- DOCX/PDF 上传、下载、解析、建议和导出能力保留。
- 删除历史目录和文件前按项目规则单独确认删除清单。

## 完成标准

- `backend_full.py` 不再是运行入口。
- 新入口覆盖当前全部公开 HTTP、WebSocket 和 SSE 路径。
- OpenAPI 路径集合与旧入口一致，明确废弃的路径除外。
- 会议、议题、录音、转写、成果、签署、ACL 和知识检索测试通过。
- 服务启动、关闭和后台任务无重复注册。
- 远程依赖健康检查通过。
- 数据库、录音和文件目录保持兼容。
- 新运行路径和部署包不依赖 OnlyOffice。
- 部署包包含旧版本恢复方式。

## 模块化主入口实现说明（2026-08-24）

- `backend/main.py` 只做进程级环境设置、生命周期管理和 `create_core_app()` 装配，禁止直接导入或注册 `backend_full.py` 的应用与路由。
- 路由唯一注册点是 `backend.app_factory.create_core_app()`；主入口通过应用的 lifespan 挂载启动/关闭钩子，不在 `main.py` 再次 `include_router`，避免重复路由和重复后台任务。
- 启动时先校验 `APP_AUTH_SECRET`。缺失时必须拒绝启动；其它运行参数可以使用安全的默认值。
- 启动时执行幂等的旧 JSON → SQLite 迁移。迁移失败应保留异常并阻止不完整启动，避免服务在数据状态不明确时继续提供写接口。
- 知识库/向量模型预热由 `KNOWLEDGE_PREWARM=1` 显式开启，默认不预热。预热属于可选重依赖：Chroma、embedding 或其它可选包不可用时记录 warning 并继续启动，不影响认证、会议和健康接口。
- 关闭时尽力关闭 LLM 的 HTTP 客户端和线程池；某个可选客户端未创建、已关闭或清理失败不得掩盖其它资源的清理。主入口不包含 OnlyOffice editor、callback、plugin 或服务发现逻辑。
- 入口回归测试至少覆盖：路由只装配一次、缺失 `APP_AUTH_SECRET` 时 lifespan 启动失败、关闭阶段资源清理，以及可选知识库预热失败时基础 API 仍可启动。

## 人工确认点

- 数据库 Schema 或数据迁移执行前。
- 正式切换 `192.168.66.44` 服务前。
