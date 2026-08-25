# 2026-08-19 悦仲业务二部周例会 Golden Case

该目录用于 Records Pipeline v2 的离线回归。原始会议内容属于业务资料，不进入版本库：

- `meeting.json`：远端会议详情；
- `transcripts.json`：721 条实时/终审转写接口响应；
- `whisper_review.json`：Whisper 终审事件与分段；
- `records.json`：当前线上旧版纪要结果。

上述 JSON 由只读 API 导出并由目录级 `.gitignore` 忽略。没有音频文件、密码、JWT 或 API Token 被保存。

如果本地没有原始 JSON，Golden Case 测试会显式跳过并提示需要重新导出；不能用合成数据冒充真实验收结果。
