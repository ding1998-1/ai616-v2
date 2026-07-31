# AI 会议真实功能逻辑与查缺补漏

## 结论

当前 AI 会议模块的方向是对的，但需要把业务对象拆清楚，否则会出现一个严重问题：问题收集、项目、会议、手机录音、角色转写都混到同一个演示会议里。

真实可用的逻辑必须是：

1. 先创建或选择一个本地项目。
2. 围绕该项目收集问题。
3. AI 把问题整理成待办议题。
4. 秘书选择议题创建会议。
5. 会议生成唯一 `meetingId`。
6. 手机录音链接绑定这个唯一 `meetingId`。
7. 录音、转写、角色、发言、上传事件全部写入该会议。
8. 会议结束后，AI 基于该会议的数据做纪要、待办、合规检查和归档。

其中第 6、7 步现在已有真实基础能力，但第 1 到 5 步仍偏前端演示态，需要补齐持久化和 ID 绑定。

## 业务对象边界

### 1. 本地项目 Project

系统不能假设能接政府项目库，也不能写成自动拉取外部项目。

真实做法：

- 由秘书或经办人手动创建本地项目名称。
- 系统生成本地项目 ID。
- 本地项目只服务于本系统内部串联，不等同于政府 OA 项目编码。

建议字段：

```json
{
  "projectId": "local-project-20260609-001",
  "projectName": "高新区二期厂房消防改造",
  "createdBy": "u_admin",
  "creatorName": "张敏",
  "createdAt": "2026-06-09 09:12",
  "source": "manual",
  "status": "active"
}
```

### 2. 问题线索 IssueSource

问题不直接等于会议议题。问题只是原始素材，可以来自浙政钉、企业微信、Excel、复制粘贴、图片 OCR。

真实做法：

- 支持手动粘贴。
- 支持 Excel 台账上传或导入。
- 支持分享收集链接。
- 每条问题都必须绑定 `projectId`，否则后面 AI 议题会跨项目混乱。

建议字段：

```json
{
  "sourceId": "src-001",
  "projectId": "local-project-20260609-001",
  "sourceType": "manual | excel | share-link | image",
  "submitterName": "基建科 王明",
  "submitterDept": "基建科",
  "content": "现场变更导致预算追加 860 万",
  "attachmentIds": [],
  "createdAt": "2026-06-09 08:42"
}
```

### 3. AI 议题 AgendaDraft

AI 议题是从问题线索中提炼出来的结构化事项。它不是会议本身。

真实做法：

- AI 根据同一个 `projectId` 下的问题线索聚类。
- 一个问题可以进入一个议题。
- 一句话里多个事项可以拆成多个议题。
- 议题需要支持人工确认、编辑、合并、拆分。

建议字段：

```json
{
  "agendaId": "agenda-001",
  "projectId": "local-project-20260609-001",
  "title": "高新区二期厂房改造追加预算审议",
  "riskType": "重大项目安排 / 大额度资金运作",
  "riskLevel": "high",
  "sourceIds": ["src-001", "src-002", "src-003"],
  "todos": [
    "补充资金来源测算表",
    "补充合同变更签证资料"
  ],
  "status": "draft | confirmed | meeting-created"
}
```

### 4. 会议 Meeting

会议是秘书基于一个或多个已确认议题创建出来的业务容器。

真实做法：

- 创建会议时生成唯一 `meetingId`。
- 会议必须绑定 `projectId` 和 `agendaIds`。
- 会议列表展示创建人、创建时间、会议日期、状态。
- 手机录音链接必须使用该会议自己的 `meetingId`。

建议字段：

```json
{
  "meetingId": "meeting-20260609-001",
  "projectId": "local-project-20260609-001",
  "agendaIds": ["agenda-001"],
  "meetingTitle": "高新区二期厂房消防改造专题会",
  "meetingDate": "2026-06-09",
  "meetingType": "党委会",
  "createdBy": "u_admin",
  "creatorName": "张敏",
  "createdAt": "2026-06-09 09:20",
  "status": "collecting | agenda-confirmed | meeting-live | finished | audited | archived"
}
```

### 5. 录音与转写 Transcript

录音和转写必须只属于一个会议，不能按页面默认会议混写。

当前已有真实基础：

- 手机端可登录。
- 手机端可录音。
- 后端可通过 Fun-ASR WebSocket 实时转写。
- 后端可按 `meetingId` 保存 `events` 和 `transcripts`。
- 桌面端可按 `meetingId` 轮询转写。

必须补的点：

- 桌面会议列表中的每个会议都必须有自己的 `meetingId`。
- 手机分享链接必须由该会议生成。
- 手机端不能再默认使用固定 `meeting-gxq-fc-2026-02`。
- 桌面端不能再从固定 `meeting-gxq-fc-2026-02` 读取转写。

## 当前实现中容易混乱的点

### 问题 1：会议列表是前端状态，不是真实数据

当前会议列表在前端 `INITIAL_MEETING_RECORDS` 中模拟。

风险：

- 刷新页面会恢复默认演示数据。
- 删除、编辑、新建不会真正保存。
- 多台设备无法同步。

应该补：

- `GET /api/meeting/list`
- `POST /api/meeting`
- `PUT /api/meeting/{meetingId}`
- `DELETE /api/meeting/{meetingId}`

### 问题 2：问题收集没有后端存储

当前问题收集、Excel 导入、粘贴内容都只是前端状态。

风险：

- 分享链接无法真正把别人提交的问题写回来。
- AI 议题池不是根据真实问题重新生成。
- 会议刷新后问题丢失。

应该补：

- `GET /api/projects/{projectId}/issues`
- `POST /api/projects/{projectId}/issues`
- `POST /api/projects/{projectId}/issues/import-excel`
- `POST /api/projects/{projectId}/issues/cluster`

### 问题 3：AI 议题整理还不是真 AI

当前 AI 议题池是固定 `ISSUE_CARDS`。

风险：

- 用户导入 Excel 后，AI 议题不会真正变化。
- 不能证明系统真的能把碎片问题聚类成议题。

应该补：

- 后端聚类接口读取真实问题线索。
- 调用大模型输出结构化议题。
- 保存 AI 输出和人工确认版本。

建议接口：

```http
POST /api/projects/{projectId}/agenda/cluster
```

返回：

```json
{
  "agendaDrafts": [
    {
      "title": "高新区二期厂房改造追加预算审议",
      "riskType": "重大项目安排 / 大额度资金运作",
      "sourceIds": ["src-001", "src-002"],
      "todos": ["补充资金来源测算表"]
    }
  ]
}
```

### 问题 4：会议 ID 现在容易固定导致转写串会

当前很多地方默认 `meeting-gxq-fc-2026-02`。

风险：

- A 会议录音可能显示到 B 会议。
- 蔡万青、丁志强等测试转写会混到新会议里。
- 演示时容易被问：“为什么这个人不在这场会也显示？”

应该补：

- 新建会议时生成唯一 `meetingId`。
- 会议列表点击进入时设置当前 `meetingId`。
- 手机录音链接使用当前 `meetingId`。
- 桌面轮询使用当前 `meetingId`。

### 问题 5：分享收集链接还没有真实提交页

当前 `?page=ai_meeting&collect=1` 可以直接进入问题收集页，但它仍依赖主系统登录和前端状态。

真实做法应该分两类链接：

- 内部秘书链接：进入完整 AI 会议工作台。
- 外部部门填报链接：只看到一个简化问题提交页。

建议新增页面：

```text
/issue-collect?projectId=xxx&token=xxx
```

页面只需要：

- 项目名称。
- 填报人姓名。
- 部门。
- 问题描述。
- 上传附件。
- 提交按钮。

提交后写入问题线索表，不进入完整后台。

### 问题 6：会议状态机需要收紧

建议状态顺序：

```text
project-created
issue-collecting
agenda-drafted
agenda-confirmed
meeting-created
meeting-live
meeting-finished
reviewing
archived
```

页面应该按状态显示能力：

- `issue-collecting`：只能收集问题、导入 Excel、分享链接。
- `agenda-drafted`：只能看 AI 议题、合并拆分、确认议题。
- `meeting-created`：生成手机录音链接，但还不能终审。
- `meeting-live`：手机录音、实时转写、角色绑定。
- `meeting-finished`：停止录音，生成纪要和待办。
- `reviewing`：三重一大核验、材料缺口、催办。
- `archived`：红头纪要、签名、归档包。

## 推荐实现顺序

### 第一优先级：防止录音串会

必须先做。

- 后端新增会议列表 JSON 存储。
- 新建会议生成唯一 `meetingId`。
- 前端会议列表读取后端。
- 手机录音链接使用当前会议 ID。
- 桌面轮询使用当前会议 ID。

完成后，录音和转写才不会混到一起。

### 第二优先级：真实问题收集

- 后端新增项目问题线索存储。
- 粘贴问题写后端。
- Excel 导入写后端。
- 分享收集页提交写后端。
- AI 议题池从后端问题线索读取。

完成后，问题收集不再是前端假数据。

### 第三优先级：AI 议题整理

- 增加 AI 聚类接口。
- 输出议题、风险类型、待办、材料缺口。
- 支持人工确认议题。
- 会议只能基于已确认议题创建。

### 第四优先级：会议后处理

- 会议结束后把转写按人归集。
- 生成纪要摘要。
- 生成责任待办。
- 进入三重一大终审。

## 演示数据保留原则

可以保留模拟数据，但要满足三条：

1. 模拟数据必须挂在某个真实对象 ID 下，比如 `projectId`、`meetingId`。
2. 模拟数据不能跨会议显示。
3. 模拟数据要像真实业务数据，不要出现无关测试口播。

当前建议清理：

- 保留“高新区二期厂房消防改造”作为默认演示项目。
- 保留“蔡万青”等真实手机端回传数据，但只显示在对应会议下。
- 清理或隐藏明显测试语音，例如“喂喂喂”“哈哈”等，避免政府演示时出戏。

## 最小可落地版本定义

如果要从原型变成可信 demo，最小版本必须做到：

- 会议列表来自后端。
- 新建会议生成唯一 ID。
- 问题收集写后端。
- AI 议题至少能根据问题内容真实调用模型生成。
- 手机录音链接绑定当前会议。
- 转写只显示当前会议数据。
- 会议结束后能看到该会议的完整转写和上传事件。

只要这几项打通，后面的纪要、公文、归档可以暂时保留半模拟，但前链路就不会乱。
