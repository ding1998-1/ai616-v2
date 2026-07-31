# Agent: 文档管理与 OnlyOffice (Document Management)

## 功能概述

基于 OnlyOffice Document Server 的文档协作系统，支持上传、编辑、书签锚定、审查批注、导出带修订痕迹的文档。

## 核心文件

| 文件 | 职责 |
|------|------|
| `frontend/src/components/OfficeEditor.jsx` | OnlyOffice 编辑器包装组件 |
| `frontend/src/components/DocxPreviewModal.jsx` | DOCX 预览弹窗 |
| `backend_full.py` L5733 | 文档上传 (`POST /doc/upload`) |
| `backend_full.py` L5893 | 编辑器 URL (`POST /doc/edit_url`) |
| `backend_full.py` L5995 | 编辑器页面 (`GET /doc/editor_page/{name}`) |
| `backend_full.py` L6142 | Audit Navigator 插件 |
| `backend_full.py` L6345 | OnlyOffice 保存回调 (`POST /doc/callback`) |
| `backend_full.py` L6464 | 导出审查版 (`POST /doc/export_reviewed`) |

## 文档上传流程

```
上传 .docx
  → POST /doc/upload
  → 自动插入书签 (bookmark) 到每个段落
  → 保存到 data/docs/{uuid}_{filename}.docx
  → 生成 .meta.json (书签→段落映射)
```

## OnlyOffice 集成

- **服务**: Docker 容器，端口 8081
- **WOPI**: 使用 JWT 认证
- **自定义插件**: Audit Navigator
  - 从审查报告中跳转到文档中的风险位置
  - 支持书签锚定、段落高亮
  - 插件文件: `backend_full.py` L6142-6338 (动态生成 JS)

## 审查批注流程

```
1. 上传合同 → 插入书签
2. AI 分析 → 返回 issues (每个 issue 锚定到书签)
3. 用户在 OnlyOffice 中查看 → Audit Navigator 跳转
4. 用户修改 → OnlyOffice 回调保存
5. 导出审查版 → POST /doc/export_reviewed
   → 合并修订痕迹 + 批注 → 生成新 docx
```

## 数据存储

| 路径 | 内容 |
|------|------|
| `data/docs/{uuid}_{name}.docx` | 文档文件 |
| `data/docs/{uuid}_{name}.meta.json` | 书签映射元数据 |
| `data/contracts/{name}.issues.json` | 合同风险分析结果 |
| `onlyoffice_data/` | OnlyOffice WOPI 密钥 |

## 相关 API

| 端点 | 功能 |
|------|------|
| `POST /doc/upload` | 上传文档（自动插书签） |
| `GET /doc/list` | 文档列表 |
| `GET /doc/download/{name}` | 下载文档 |
| `DELETE /doc/delete/{name}` | 删除文档 |
| `GET /doc/extract_bookmarks/{name}` | 提取书签 |
| `POST /doc/edit_url` | 获取编辑器 URL (JWT) |
| `GET /doc/editor_page/{name}` | 完整编辑器页面 |
| `POST /doc/callback` | OnlyOffice 保存回调 |
| `POST /doc/selection` | 获取段落信息（按书签） |
| `POST /doc/submit_suggestion` | 提交修改建议 |
| `POST /doc/export_reviewed` | 导出带修订的文档 |
