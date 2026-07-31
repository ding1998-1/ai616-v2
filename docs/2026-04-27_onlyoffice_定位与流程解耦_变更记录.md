# 2026-04-27 变更记录（OnlyOffice 定位跳转 + 审查流程解耦）

## 1. 变更日期
- 日期：2026-04-27
- 变更范围：前端 `OfficeEditor`、`ComplianceAudit`、`CaseAnalysis`；后端 `backend_full.py`

## 2. 本次修改目标
- 修复 OnlyOffice 编辑器“无法定位/跳转”的问题。
- 修复插件 fallback 消息链路不生效的问题。
- 将“上传后必须等待 AI 审查完成才能看文档”改为“文档先打开，审查后台进行”。

## 3. 修改文件与内容

### A. `frontend/src/components/OfficeEditor.jsx`

1. React 包事件绑定修正  
将 `DocumentEditor` 的事件参数改为组件支持的形式：
- `events_onDocumentReady`
- `events_onError`
- `events_onRequestSaveAs`
- `events_onWarning`

目的：确保 `onDocumentReady` 真正触发，后续才有机会初始化连接器与导航逻辑。

2. 实例读取路径修正  
从 `window.DocEditor.instances` 获取实例，不再使用错误路径。

目的：避免“实例存在但取不到”的情况。

3. Connector 方法参数修正  
- `SearchNext` 改为对象参数：`{ searchString, matchCase }`
- `SearchAndReplace` 改为对象参数：`{ searchString, replaceString, matchCase }`

目的：与当前 OnlyOffice API 调用格式一致。

4. 插件 fallback 通道修正（关键）  
- iframe 选择改为优先查找 `iframe[name="frameEditor"]`
- `postMessage` 发送数据改为 `JSON.stringify(...)`

目的：OnlyOffice 内部对 `event.data` 执行 `JSON.parse`，必须发送 JSON 字符串；否则插件收不到外部指令。

5. 增加插件回传日志  
监听并打印：
- `auditNavResponse`
- `onExternalPluginMessageCallback`

目的：区分“fallback 已发送”与“插件已接收并执行”的阶段。

---

### B. `frontend/src/pages/ComplianceAudit.jsx`

证据定位状态从“纯数字”改为“对象载荷”：
- `setEditorTargetPara({ paraIndex, text, action: 'locate', ts })`

目的：重复点击同一段时，`ts` 变化可强制触发导航 effect，避免 React 因值相同不更新。

---

### C. `frontend/src/pages/CaseAnalysis.jsx`

1. 上传与审查状态拆分  
- 新增 `uploading`、`analyzing`
- 移除旧的单一 `loading` 语义

2. 流程解耦（关键）  
上传成功后不再 `await runAnalysis(...)`，改为：
- 先设置 `contractFile` 与 `docStructure`，立即可打开编辑器
- `void runAnalysis(...)` 后台执行

3. UI 状态对应修正  
- 上传区域只看 `uploading`
- 侧栏分析进度与追加审查按钮只看 `analyzing`

目的：实现“审查归审查、文档归文档”，不阻塞文档查看与编辑。

---

### D. `backend_full.py`

1. 浏览器可达地址推导  
新增 `_get_browser_backend_base(request)`，优先从 `Origin/Referer/X-Forwarded-*` 推导浏览器可达的后端地址。

目的：避免插件地址落到浏览器不可达 IP（如 `198.18.0.1`）。

2. `/doc/edit_url` 插件配置修正  
- `plugins.pluginsData` 使用浏览器可达地址
- 增加版本参数（`?v=doc_key`）避免插件配置缓存污染

3. `/doc/plugin/audit_navigator/config.json` 修正  
- `baseUrl` 指向 `/doc/plugin/audit_navigator/`
- 返回头增加 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`

4. `/doc/plugin/audit_navigator/index.html` 修正  
- 增加 `PLUGIN_READY` 回传
- `GoToBookmark` 执行后回传 `NAV_BOOKMARK_RESULT`
- `SearchNext` / `SearchAndReplace` 参数改为对象形式
- 返回头增加禁缓存

目的：确保插件地址正确、插件脚本不吃旧缓存、并可验证执行结果。

## 4. 代码关系（调用链）

1. 合同审查页主链路  
`CaseAnalysis.handleUpload`  
-> `setContractFile + setDocStructure`（立即可渲染编辑器）  
-> `OfficeEditor` 挂载后请求 `/api/doc/edit_url`  
-> OnlyOffice 加载文档与插件  
-> `runAnalysis` 在后台更新右侧建议。

2. 定位/跳转链路（有 connector）  
`UI 点击定位/替换`  
-> `targetParaIndex`（对象载荷）  
-> `OfficeEditor.jumpToBookmark`  
-> `connector.executeMethod('GoToBookmark'/'SearchNext'/'SearchAndReplace')`。

3. 定位/跳转链路（无 connector，fallback）  
`OfficeEditor.jumpToBookmark/_locateText/_replaceText`  
-> `_sendToPlugin(JSON.stringify(...))`  
-> 插件 `window.Asc.plugin.onExternalPluginMessage`  
-> `GoToBookmark/SearchNext/SearchAndReplace`  
-> `postMessage(auditNavResponse)` 回前端日志。

4. 证据引用链路  
`ComplianceAudit.handleEvidenceNavigate`  
-> `setEditorTargetPara({ action:'locate', paraIndex, text, ts })`  
-> `OfficeEditor` 响应并执行跳转/定位。

## 5. 与报错的关系说明

- `GET http://<host>:8088/v1/models ERR_CONNECTION_REFUSED`：模型状态探测接口，不是 OnlyOffice 跳转主链路。
- `antd` deprecation warning：UI 组件升级提示，不会导致编辑器 `DocsAPI` 加载失败。
- `DocsAPI ... :8081 ... ERR_CONNECTION_REFUSED`：OnlyOffice 服务层不可达问题，需要容器可用且端口可访问。

## 6. 部署与生效条件

如果运行方式是 Docker（本项目当前为此方式），前端代码修改后必须重建容器才能生效：
- `docker compose up -d --build frontend backend`

仅重启浏览器或本地 `vite`，不会更新已在容器内运行的旧前端静态资源。

## 7. 追加变更（解决定位最终不生效问题）

### 7.1 后端配置修正（修复 500 报错）
在 `backend_full.py` 的 `/doc/edit_url` 接口中，修正了变量定义的顺序问题：
- 将 `plugin_config` 的定义提前至 `editor_config` 构建之前，解决了此前因变量未定义导致的 `UnboundLocalError`，使得 OnlyOffice 能够成功加载配置项。

### 7.2 前端连接器 API 替换（放弃 executeMethod）
发现 `connector.executeMethod('SearchNext')` 在处理带有空格、多余换行符或与原文不完全匹配的 AI 生成文本时，会直接静默失败（无报错，无效果）。因此在 `OfficeEditor.jsx` 中，对 `_locateText` 和 `_replaceText` 进行了根本性重构：
- 弃用 `executeMethod`，直接使用拥有最高 API 权限的宏命令下发工具：`connector.callCommand`。

### 7.3 实现原生多级降级搜索机制（解决文本匹配不上的核心问题）
在通过 `callCommand` 注入到 OnlyOffice 原生环境中的 JS 脚本里，实现了一套极具鲁棒性的定位搜索逻辑：
1. **自动清理格式**：使用 `.replace(/\\s+/g, " ").trim()` 将目标字符串中的所有换行和多余空格归一化。
2. **第一级：精确搜索**：直接使用 `Api.GetDocument().Search(txt, false)` 进行全文精确查找。
3. **第二级：段落级模糊匹配**：如果精确搜索失败，获取 `GetAllParagraphs()` 逐段遍历。先尝试原文段落内直接 `indexOf`，再尝试清理段落空格后 `indexOf`（完全无视两端的换行和空格差异）。
4. **第三级：碎片段定位兜底**：如果依然失败，且文本较长（>15字符），则截取前15个字符再搜索一次，尽可能把视野拉向目标区域。
5. **执行跳跃与高亮**：通过 `.SetShd("clear", 255, 255, 0)` 给找到的 `range` 打上黄色底色高亮，最后调用 `range.Select()` 强制卷轴跳转！

### 7.4 增加前端回传状态感知
借助 `callCommand` 的回调函数，如果在宏脚本内所有层级的降级搜索均未能命中，则向 `OfficeEditor.jsx` 返回 `false`，并在屏幕右上角弹出醒目的警告（`antMessage.warning` 或 `antMessage.error`），彻底消除“点击后毫无反应”的黑盒体验。
