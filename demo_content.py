from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List


DEMO_USER: Dict[str, Any] = {
    "name": "张三",
    "role": "staff",
    "dept": "合规法务部",
}


DEMO_KNOWLEDGE_FILES: List[Dict[str, Any]] = [
    {
        "id": "seed_case_001",
        "name": "某城投公司重大项目违规审批案例.docx",
        "type": "docx",
        "size": "128 KB",
        "date": "2025-11-12",
        "tags": ["重大项目", "违规", "案例"],
        "linked": True,
        "vectorized": True,
        "uploader": "系统管理员",
        "uploaderRole": "admin",
        "dept": "信息管理中心",
        "libraryCategory": "cases",
    },
    {
        "id": "seed_case_002",
        "name": "大额资金未经审批转移处分决定书.pdf",
        "type": "pdf",
        "size": "256 KB",
        "date": "2025-09-03",
        "tags": ["大额资金", "处分", "案例"],
        "linked": True,
        "vectorized": True,
        "uploader": "李敏",
        "uploaderRole": "staff",
        "dept": "审计监察部",
        "libraryCategory": "cases",
    },
    {
        "id": "seed_knowledge_001",
        "name": "城投企业三重一大实施细则（2024版）.pdf",
        "type": "pdf",
        "size": "445 KB",
        "date": "2024-12-01",
        "tags": ["制度", "2024"],
        "linked": True,
        "vectorized": True,
        "uploader": "系统管理员",
        "uploaderRole": "admin",
        "dept": "信息管理中心",
        "libraryCategory": "knowledge",
    },
    {
        "id": "seed_knowledge_002",
        "name": "重大项目决策合规操作手册.docx",
        "type": "docx",
        "size": "198 KB",
        "date": "2024-10-15",
        "tags": ["操作手册", "项目"],
        "linked": False,
        "vectorized": False,
        "uploader": "赵云",
        "uploaderRole": "staff",
        "dept": "战略规划部",
        "libraryCategory": "knowledge",
    },
    {
        "id": "seed_shared_001",
        "name": "国企合规管理指引（国务院国资委）.pdf",
        "type": "pdf",
        "size": "890 KB",
        "date": "2024-08-01",
        "tags": ["法规", "国资委", "共享"],
        "linked": True,
        "vectorized": True,
        "uploader": "系统管理员",
        "uploaderRole": "admin",
        "dept": "信息管理中心",
        "libraryCategory": "shared",
    },
]


DEMO_WORKFLOW_CONFIG: Dict[str, Any] = {
    "defaultMatterType": "重要干部",
    "matterTypes": [
        {"label": "重大事项", "value": "重大事项"},
        {"label": "重要干部", "value": "重要干部"},
        {"label": "重大项目", "value": "重大项目"},
        {"label": "大额资金", "value": "大额资金"},
    ],
    "departments": ["董事会办公室", "总经理办公室", "财务管理部", "法务合规部", "人力资源部", "项目管理部", "采购中心", "审计监察部"],
    "workflows": {
        "重大事项": {
            "steps": [
                {"title": "调查与定议", "desc": "业务部门、工会、职工代表充分讨论"},
                {"title": "确定议题", "desc": "书面提出议题，分管领导审核确认"},
                {"title": "酝酿意见", "desc": "材料送达相关人员"},
                {"title": "专家论证", "desc": "专家评估，提交经营管理层会议参考"},
                {"title": "征求意见", "desc": "向社会公开征求意见"},
                {
                    "title": "作出决策",
                    "desc": "会议讨论意见并表决",
                    "riskPoint": "不按公司议事规则进行集体决策，决策运行过程中存在权力失控风险",
                    "precaution": "严格按公司章程、董事会/总经理办公会议事规则执行，对重大事项集体讨论、决策。",
                },
                {"title": "依法公开", "desc": "对决策依据、过程、结果向社会公开"},
            ],
            "details": {
                "0": {
                    "type": "descriptions",
                    "items": [
                        {"label": "组织部门", "value": "业务一部"},
                        {"label": "参与讨论工会代表", "value": "张副主席"},
                        {"label": "参与讨论妇委会代表", "value": "李主任"},
                        {"label": "参与讨论共青团代表", "value": "王书记"},
                        {"label": "初步意见", "value": "调研充分，建议书面提交流程"},
                    ],
                },
                "1": {
                    "type": "descriptions",
                    "items": [
                        {"label": "书面议题", "value": "《关于新院区规划建设的重大事项决议提案》"},
                        {"label": "分管领导", "value": "陈副院长（已审核）"},
                        {"label": "主要领导", "value": "刘院长（已确认）"},
                    ],
                },
                "2": {
                    "type": "descriptions",
                    "items": [
                        {"label": "材料送达范围", "value": "经营管理层、各职能部门核心骨干"},
                        {"label": "酝酿时长", "value": "3个工作日"},
                        {"label": "反馈情况", "value": "无重大分歧，部分细节需专家组介入评估"},
                    ],
                },
                "3": {
                    "type": "descriptions",
                    "items": [
                        {"label": "专家组构成", "value": "省建委智库专家抽取 5 名"},
                        {"label": "评估结论", "value": "规划合理，风险可控", "tone": "success"},
                        {"label": "材料流转向", "value": "已整理专家意见并提交经营管理层会议参考"},
                    ],
                },
                "4": {
                    "type": "descriptions",
                    "items": [
                        {"label": "征求形式", "value": "向社会公开征求意见公告"},
                        {"label": "征集期", "value": "15天"},
                        {"label": "结果汇总", "value": "收到公众有效建议 12 条，已采纳 3 条"},
                    ],
                },
                "5": {
                    "type": "descriptions",
                    "items": [
                        {"label": "会议形式", "value": "总经理办公会扩大会议讨论并表决"},
                        {"label": "表决结果", "value": "一致同意通过", "tone": "info"},
                        {"label": "权力规范排查", "value": "未发生独断专行或滥用权力，严格遵循集体决策", "tone": "success"},
                    ],
                },
                "6": {
                    "type": "descriptions",
                    "items": [
                        {"label": "依法公开内容", "value": "决策依据清单、过程记录、最终结果通报"},
                        {"label": "发布渠道", "value": "门户网站及上级主管部门报备系统"},
                    ],
                },
            },
        },
        "重要干部": {
            "steps": [
                {"title": "民主推荐", "desc": "民主测评提名，半数进入考察"},
                {"title": "组织考察", "desc": "人力资源部、工会、审计监察部联合考察德能勤绩廉"},
                {
                    "title": "会议决定",
                    "desc": "总经理办公会投票决议，形成会议决定",
                    "riskPoint": "不按任免奖惩和公司议事规则进行，人事任免中存在滥用权力和吃拿卡要风险。",
                    "precaution": "严格执行集体决策，完整留痕民主推荐、联合考察、审计监察意见和集体表决材料。",
                },
                {"title": "任前公示", "desc": "在一定范围内公示无异议后试用"},
                {"title": "人员试用", "desc": "试用期一年，考核胜任正式任命"},
            ],
            "details": {
                "0": {
                    "type": "descriptions",
                    "items": [
                        {"label": "会议时间", "value": "2025-04-10 09:00"},
                        {"label": "参会人数", "value": "45人"},
                        {"label": "有效票数", "value": "43票"},
                        {"label": "提名人选", "value": "王建国"},
                        {"label": "得票率", "value": "88%（超过半数）", "tone": "success"},
                        {"label": "民主测评结论", "value": "同意进入组织考察程序"},
                    ],
                },
                "1": {
                    "type": "table",
                    "columns": [
                        {"title": "联合考察成员", "dataIndex": "member"},
                        {"title": "所属代表", "dataIndex": "dept"},
                        {"title": "德", "dataIndex": "de"},
                        {"title": "能", "dataIndex": "neng"},
                        {"title": "勤", "dataIndex": "qin"},
                        {"title": "绩", "dataIndex": "ji"},
                        {"title": "廉", "dataIndex": "lian"},
                    ],
                    "rows": [
                        {
                            "key": 1,
                            "member": "张强",
                            "dept": "总经理办公室",
                            "de": 95,
                            "neng": 90,
                            "qin": 92,
                            "ji": 88,
                            "lian": 98,
                            "detail": {
                                "title": "群众谈话与民主测评记录",
                                "content": "谈话时间：2025-04-11。共计开展个别谈话20人次，涉及各科室主要负责人。谈话反映该同志大局观强，业务能力扎实。"
                            },
                        },
                        {
                            "key": 2,
                            "member": "李静",
                            "dept": "工会",
                            "de": 92,
                            "neng": 88,
                            "qin": 90,
                            "ji": 85,
                            "lian": 95,
                            "detail": {
                                "title": "职工代表意见收集函",
                                "content": "发放职工满意度测评表50份，收回有效表48份。其中满意45票，基本满意3票，不满意0票。"
                            },
                        },
                        {
                            "key": 3,
                            "member": "王伟",
                            "dept": "审计监察部",
                            "de": 96,
                            "neng": 92,
                            "qin": 95,
                            "ji": 90,
                            "lian": 100,
                            "detail": {
                                "title": "个人廉政档案核查报告",
                                "content": "经调取历年个人事项报告与信访举报台账，未发现瞒报漏报情况，近三年无违纪违法举报线索。"
                            },
                        },
                    ],
                    "summary": "经总经理办公室、工会、审计监察部联合考察，未发现违反廉洁纪律问题，综合评定为“优秀”，建议提拔。",
                },
                "2": {
                    "type": "descriptions",
                    "items": [
                        {"label": "决议机构", "value": "总经理办公会"},
                        {"label": "会议议题", "value": "关于重要干部人事任免的决议"},
                        {"label": "决议结果", "value": "全票通过", "tone": "info"},
                        {"label": "风险排查结论", "value": "未发现吃拿卡要现象，严格符合公司议事规则", "tone": "success"},
                    ],
                },
                "3": {
                    "type": "descriptions",
                    "items": [
                        {"label": "公示范围", "value": "全院内网及公告栏"},
                        {"label": "公示期限", "value": "2025-04-15 至 2025-04-22（5个工作日）"},
                        {"label": "异议反馈", "value": "无异议反馈，流程完备", "tone": "success"},
                    ],
                },
                "4": {
                    "type": "descriptions",
                    "items": [
                        {"label": "试用期起止", "value": "2025-05-01 至 2026-04-30"},
                        {"label": "考核责任部门", "value": "办公室"},
                        {"label": "当前状态", "value": "发文试用，试用期考核跟进中", "tone": "processing"},
                    ],
                },
            },
        },
        "重大项目": {
            "steps": [
                {"title": "项目审查", "desc": "分管领导组织业务部门、工会对项目进行审查"},
                {"title": "专家论证", "desc": "专家论证评估，提交经营管理层会议参考"},
                {"title": "征求意见", "desc": "向利益相关方征求意见，提交经营管理层会议参考"},
                {
                    "title": "作出决策",
                    "desc": "会议讨论意见，对审批结论进行表决",
                    "riskPoint": "不按公司议事规则进行集体决议，项目安排中存在徇私舞弊和优亲厚友风险。",
                    "precaution": "严格执行项目论证、法审、党委前置和集体表决，不得以临时动议替代正式程序。",
                },
                {"title": "依法公示", "desc": "对项目审批过程、结论向社会公示"},
                {"title": "正式审批", "desc": "公示无异议，正式审批"},
            ],
            "details": {
                "0": {
                    "type": "descriptions",
                    "items": [
                        {"label": "项目审查小组", "value": "分管业务副院长牵头"},
                        {"label": "组织部门", "value": "项目管理部、财务管理部"},
                        {"label": "工会审查意见", "value": "项目涉及职工切身利益，工会代表一致同意立项"},
                    ],
                },
                "1": {
                    "type": "descriptions",
                    "items": [
                        {"label": "专家论证要点", "value": "项目可行性、环评测算与造价分析"},
                        {"label": "专家意见归总", "value": "已形成《专家综合评审书》并提交董事会/总经理办公会参考"},
                    ],
                },
                "2": {
                    "type": "descriptions",
                    "items": [
                        {"label": "征求意见受众", "value": "社会面公开及内部党代会代表"},
                        {"label": "流转动作", "value": "意见汇总材料已提交董事会/总经理办公会参考"},
                    ],
                },
                "3": {
                    "type": "descriptions",
                    "items": [
                        {"label": "会议结论", "value": "董事会/总经理办公会表决通过项目审批结论", "tone": "info"},
                        {"label": "风险防范排查", "value": "未发现徇私舞弊、优亲厚友现象，决策合法合规", "tone": "success"},
                    ],
                },
                "4": {
                    "type": "descriptions",
                    "items": [
                        {"label": "公示内容", "value": "项目审批全过程履历及中标候选结论"},
                        {"label": "防腐公开机制", "value": "设置审计监察举报邮箱及电话"},
                    ],
                },
                "5": {
                    "type": "descriptions",
                    "items": [
                        {"label": "异议处理", "value": "公示期未收到实质性异议"},
                        {"label": "最终状态", "value": "正式审批完成，项目进入实施执行阶段", "tone": "success"},
                    ],
                },
            },
        },
        "大额资金": {
            "steps": [
                {"title": "安排预算", "desc": "总经理办公会决定，新增资金须专门集体研究"},
                {
                    "title": "集体研究",
                    "desc": "提交大额资金报告，总经理办公会研究形成决议",
                    "riskPoint": "不按公司议事规则进行决议，资金使用过程中存在徇私舞弊和优亲厚友风险。",
                    "precaution": "严格执行双签、预算审核、专项审计留痕和公示程序，资金用途必须穿透到业务底稿。",
                },
                {"title": "公开公示", "desc": "将研究结论在公示栏公示"},
                {"title": "资金使用", "desc": "公示期结束无异议，财务室拨付资金"},
            ],
            "details": {
                "0": {
                    "type": "descriptions",
                    "items": [
                        {"label": "决议机构", "value": "总经理办公会"},
                        {"label": "资金用途", "value": "新增大型医疗器械专项采购款"},
                        {"label": "预算金额", "value": "￥12,500,000"},
                        {"label": "前置审批结论", "value": "已通过专门集体研究", "tone": "success"},
                    ],
                },
                "1": {
                    "type": "descriptions",
                    "items": [
                        {"label": "提交材料", "value": "《大额资金使用报告（编号：F-2025-081）》"},
                        {"label": "分管领导审核", "value": "已签字审核同意"},
                        {"label": "总经理办公会研究", "value": "同意专项下拨", "tone": "info"},
                        {"label": "廉政合规排查", "value": "未见徇私舞弊、优亲厚友，民主集中制落实到位", "tone": "success"},
                    ],
                },
                "2": {
                    "type": "descriptions",
                    "items": [
                        {"label": "公开位置", "value": "公司内网公告栏及 OA 公示区"},
                        {"label": "研究结论", "value": "关于拨付大型器械采购款的决定"},
                        {"label": "档案附件", "value": "已存档（附件：现场公示照片与截图凭证.pdf）"},
                    ],
                },
                "3": {
                    "type": "descriptions",
                    "items": [
                        {"label": "拨付状态", "value": "财务室已核签并拨付", "tone": "success"},
                        {"label": "流水号", "value": "TRX-20250428-9921"},
                        {"label": "资金回溯", "value": "公示期满无异议，款项已达国库对公账户"},
                    ],
                },
            },
        },
    },
}


DEMO_DASHBOARD: Dict[str, Any] = {
    "selectedYear": "2025",
    "years": [{"label": "2025年度", "value": "2025"}],
    "stats": [
        {
            "key": "party_meetings",
            "title": "本年度集体决策会议次数",
            "value": "34",
            "suffix": " 次",
            "bgStyle": "linear-gradient(135deg, #1890ff 0%, #0050b3 100%)",
            "icon": "bank",
            "trend": "up",
            "trendValue": "+12%",
        },
        {
            "key": "major_projects",
            "title": "研究重大项目数",
            "value": "128",
            "suffix": " 个",
            "bgStyle": "linear-gradient(135deg, #722ed1 0%, #391085 100%)",
            "icon": "project",
            "trend": "up",
            "trendValue": "+5%",
        },
        {
            "key": "capital_total",
            "title": "累计决策资金总额",
            "value": "45.6",
            "prefix": "¥ ",
            "suffix": " 亿",
            "bgStyle": "linear-gradient(135deg, #fa8c16 0%, #ad4e00 100%)",
            "icon": "fund",
            "trend": "up",
            "trendValue": "+2.1亿",
        },
        {
            "key": "temporary_items",
            "title": "紧急上会/临时动议",
            "value": "7",
            "suffix": " 项",
            "bgStyle": "linear-gradient(135deg, #ff4d4f 0%, #a8071a 100%)",
            "icon": "alert",
            "trend": "down",
            "trendValue": "-15%",
        },
    ],
    "complianceDistribution": [
        {"label": "合规通过", "percent": 85, "count": 108, "color": "#52c41a", "status": "active"},
        {"label": "存在瑕疵/部分整改", "percent": 11, "count": 14, "color": "#faad14", "status": "active"},
        {"label": "违规驳回", "percent": 4, "count": 6, "color": "#ff4d4f", "status": "exception"},
    ],
    "recentAnomalies": [
        {"key": 1, "date": "2025-03-04", "project": "新能源科创园三期扩建", "issue": "临时动议上会", "level": "高风险"},
        {"key": 2, "date": "2025-02-28", "project": "年度信息系统采购", "issue": "拆分立项避开大额资金审批", "level": "中风险"},
        {"key": 3, "date": "2025-02-15", "project": "城南地块收储", "issue": "法律审查意见缺失", "level": "中风险"},
    ],
    "pathOptions": [
        {"label": "重大事项决策", "value": "重大事项"},
        {"label": "重要干部任免", "value": "重要干部"},
        {"label": "重大项目安排", "value": "重大项目"},
        {"label": "大额资金使用", "value": "大额资金"},
    ],
    "defaultMatterType": "重大事项",
    "paths": {
        matter_type: {"steps": workflow["steps"]}
        for matter_type, workflow in DEMO_WORKFLOW_CONFIG["workflows"].items()
    },
    "alerts": {
        "重大项目": [
            {"type": "监管关注", "content": "近期省国资委开展“未批先建”专项巡查，请重点关注立项审批时间线。", "color": "error"},
            {"type": "政策更新", "content": "《关于加强城投公司重大项目融资监管的指导意见》正式下发。", "color": "warning"},
        ],
        "大额资金": [
            {"type": "债务红线", "content": "严禁通过“名股实债”方式变相举债，资金用途须穿透至底层。", "color": "error"},
            {"type": "合规提示", "content": "单笔超过 1000 万的非经营性支出建议增加外部审计环节。", "color": "processing"},
        ],
        "重大事项": [
            {"type": "流程提示", "content": "党委前置研究与会议纪要归档必须前后闭环一致。", "color": "warning"},
            {"type": "巡视重点", "content": "近期巡视关注“先上会后补材料”问题，请核查议题形成时序。", "color": "error"},
        ],
        "重要干部": [
            {"type": "干部监督", "content": "任前公示与纪检意见征询是高频抽查项。", "color": "warning"},
            {"type": "廉政提示", "content": "考察材料要体现德能勤绩廉全维度结论。", "color": "processing"},
        ],
    },
    "missingMaterialWarning": "该类型通常需要 5 份核心材料，检测到当前平均缺失《可行性研究报告》。",
}


DEMO_ARCHIVE_RECORDS: List[Dict[str, Any]] = [
    {
        "key": "demo-archive-001",
        "id": "SXZ-2025-1201-002",
        "matterType": "重大项目安排",
        "title": "新能源科创园三期扩建立项审议",
        "material": "围绕新能源科创园三期扩建开展前置审议、法审和资金测算。",
        "date": "2025-12-01 14:30:00",
        "status": "已归档",
        "report": "系统记录：重大项目已完成法审、风评和党委前置。",
        "results": {},
        "riskLevel": "中风险",
        "participants": "董事会成员、战略规划部、法务合规部、财务管理部",
    },
    {
        "key": "demo-archive-002",
        "id": "SXZ-2025-1118-004",
        "matterType": "大额度资金运作",
        "title": "存量债务置换专项资金审批",
        "material": "专项资金用于存量债务置换，已提交资金用途穿透说明。",
        "date": "2025-11-18 09:40:00",
        "status": "已归档",
        "report": "系统记录：已核验预算、审计意见和双签留痕。",
        "results": {},
        "riskLevel": "低风险",
        "participants": "总经理办公会、财务管理部、审计部、审计监察部",
    },
]


def get_demo_assets() -> Dict[str, Any]:
    return {
        "user": deepcopy(DEMO_USER),
        "workflow": deepcopy(DEMO_WORKFLOW_CONFIG),
        "dashboard": deepcopy(DEMO_DASHBOARD),
        "knowledgeLibrary": {
            "currentUser": deepcopy(DEMO_USER),
            "seedFiles": deepcopy(DEMO_KNOWLEDGE_FILES),
        },
        "rulesGallery": deepcopy(get_rules_gallery_items()),
    }


def get_seed_knowledge_files() -> List[Dict[str, Any]]:
    return deepcopy(DEMO_KNOWLEDGE_FILES)


def _archive_timeline_for(matter_type: str) -> List[Dict[str, str]]:
    mapping = {
        "重大项目安排": [
            {"color": "green", "title": "业务部门提交初审", "description": "战略规划部完成立项必要性、可研和预算测算材料汇总。"},
            {"color": "green", "title": "法律合规及风险审查", "description": "法律合规部完成法审意见、负面清单校验和风险提示。"},
            {"color": "blue", "title": "集体决策前置研究", "description": "董事会/总经理办公会对投资必要性、资金来源与程序合规性进行集体研判。"},
            {"color": "blue", "title": "董事会/总经理办公会审批", "description": "形成正式审批结论并进入实施公示期。"},
        ],
        "大额度资金运作": [
            {"color": "green", "title": "预算安排与资金计划", "description": "财务部门形成年度预算及专项资金使用计划。"},
            {"color": "green", "title": "审计与风控核验", "description": "审计部核查资金用途穿透和历史支付记录。"},
            {"color": "blue", "title": "集体研究决策", "description": "总经理办公会形成专项资金安排决议并完成双签留痕。"},
            {"color": "blue", "title": "公示拨付", "description": "公示期结束后执行拨付并生成回溯台账。"},
        ],
        "重要人事任免": [
            {"color": "green", "title": "民主推荐", "description": "组织部门完成民主推荐、票决和统计留痕。"},
            {"color": "green", "title": "联合考察", "description": "办公室、工会、纪检联合形成德能勤绩廉考察意见。"},
            {"color": "blue", "title": "集体研究决定", "description": "总经理办公会审议人选并形成会议纪要。"},
            {"color": "blue", "title": "任前公示与试用", "description": "完成公示、任前谈话和试用安排。"},
        ],
    }
    return deepcopy(mapping.get(matter_type, [
        {"color": "green", "title": "业务部门提交初审", "description": "主办部门完成事项申请、必要性说明和基础材料归集。"},
        {"color": "green", "title": "法律合规及风险审查", "description": "法律合规部完成制度匹配、程序核验和风险提示。"},
        {"color": "blue", "title": "集体决策前置研究", "description": "董事会/总经理办公会集体讨论并形成决议纪要。"},
        {"color": "blue", "title": "最终审批与归档", "description": "完成最终签批、公示和电子归档。"},
    ]))


def _archive_attachments_for(matter_type: str) -> List[Dict[str, str]]:
    mapping = {
        "重大项目安排": [
            {"name": "1_可行性研究报告及立项文件.pdf", "type": "pdf"},
            {"name": "2_集体决策会议纪要.pdf", "type": "pdf"},
            {"name": "3_法律意见书及风险评估汇总表.pdf", "type": "pdf"},
        ],
        "大额度资金运作": [
            {"name": "1_年度资金使用计划.pdf", "type": "pdf"},
            {"name": "2_专项审计意见书.pdf", "type": "pdf"},
            {"name": "3_资金拨付双签留痕表.pdf", "type": "pdf"},
        ],
        "重要人事任免": [
            {"name": "1_民主推荐结果汇总表.pdf", "type": "pdf"},
            {"name": "2_联合考察意见书.pdf", "type": "pdf"},
            {"name": "3_任前公示及反馈记录.pdf", "type": "pdf"},
        ],
    }
    return deepcopy(mapping.get(matter_type, [
        {"name": "1_审议事项申请表.pdf", "type": "pdf"},
        {"name": "2_合规审查意见书.pdf", "type": "pdf"},
        {"name": "3_会议纪要与附件汇编.pdf", "type": "pdf"},
    ]))


def _normalize_archive_record(record: Any, fallback_index: int = 0) -> Dict[str, Any]:
    if not isinstance(record, dict):
        text = str(record).strip() or "历史记录异常，已自动归档为文本快照。"
        return {
            "key": f"archive-fallback-{fallback_index}",
            "id": f"ARCHIVE-FALLBACK-{fallback_index:03d}",
            "matterType": "重大决策",
            "title": text[:100] + ("..." if len(text) > 100 else ""),
            "material": text,
            "date": "",
            "status": "已归档",
            "report": text,
            "results": {},
            "riskLevel": "中风险",
            "participants": "系统自动修复",
            "archiveSummary": "历史记录存在异常结构，系统已自动转换为可展示档案记录。",
            "sourceCorrupted": True,
        }

    normalized = deepcopy(record)
    normalized.setdefault("key", normalized.get("id") or f"archive-{fallback_index}")
    normalized.setdefault("id", f"ARCHIVE-{fallback_index:03d}")
    normalized.setdefault("matterType", "重大决策")
    normalized.setdefault("title", normalized.get("material") or normalized.get("report") or "未命名归档记录")
    normalized.setdefault("material", normalized.get("title") or "")
    normalized.setdefault("date", "")
    normalized.setdefault("status", "已归档")
    normalized.setdefault("report", normalized.get("material") or "")
    normalized.setdefault("results", {})
    normalized.setdefault("riskLevel", "中风险")
    normalized.setdefault("participants", "系统自动归档")
    return normalized


def enrich_archive_record(record: Dict[str, Any], fallback_index: int = 0) -> Dict[str, Any]:
    normalized = _normalize_archive_record(record, fallback_index=fallback_index)
    matter_type = normalized.get("matterType", "重大决策")
    enriched = deepcopy(normalized)
    enriched.setdefault("timeline", _archive_timeline_for(matter_type))
    enriched.setdefault("attachments", _archive_attachments_for(matter_type))
    enriched.setdefault("archiveSummary", "系统已自动归集原始材料、会议纪要、风险提示和整改留痕，可一键生成迎检档案。")
    return enriched


def build_archive_history(history_records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    safe_history = history_records if isinstance(history_records, list) else []
    base_records = [enrich_archive_record(record, fallback_index=index) for index, record in enumerate(safe_history)]
    if len(base_records) >= 3:
        return base_records

    existing_ids = {record.get("id") for record in base_records}
    for demo_record in DEMO_ARCHIVE_RECORDS:
        if demo_record["id"] in existing_ids:
            continue
        enriched = enrich_archive_record({**demo_record, "isDemo": True})
        base_records.append(enriched)
        if len(base_records) >= 3:
            break
    return base_records


def get_rules_gallery_items() -> List[Dict[str, Any]]:
    return [
        {
            "id": "rule_flow_overview",
            "filename": "1.jpg",
            "title": "三重一大事项总流程",
            "matterType": "总览",
            "summary": "建议提出、书面议题、部门研究、承办方案、意见征求、办公室报告、集体会议决策、执行与督查。",
            "steps": ["建议提出", "书面建议", "支部研究", "承办方案", "征求意见", "院办报告", "集体决策", "执行调整", "督查检查"],
        },
        {
            "id": "rule_major_fund_flow",
            "filename": "4.jpg",
            "title": "大额资金使用流程",
            "matterType": "大额度资金运作",
            "summary": "安排预算、集体研究、公开公示、资金使用四段式闭环，公示期满无异议后执行支付。",
            "steps": ["安排预算", "集体研究", "公开公示", "资金使用"],
        },
        {
            "id": "rule_major_fund_risk",
            "filename": "7.jpg",
            "title": "大额资金风险与防控",
            "matterType": "大额度资金运作",
            "summary": "风险集中在集体研究环节，核心防控点是严格按议事规则集体讨论并留痕。",
            "steps": ["安排预算", "集体研究", "风险识别", "防控措施", "公开公示", "资金使用"],
        },
        {
            "id": "rule_hr_risk",
            "filename": "9.jpg",
            "title": "干部任免风险与防控",
            "matterType": "重要人事任免",
            "summary": "民主推荐、组织考察、会议决定、任前公示、人员试用五步走，重点约束人事任免中的滥用权力。",
            "steps": ["民主推荐", "组织考察", "会议决定", "任前公示", "人员试用"],
        },
        {
            "id": "rule_major_project_flow",
            "filename": "2.jpg",
            "title": "重大项目安排流程",
            "matterType": "重大项目安排",
            "summary": "项目审查、专家论证、征求意见、会议决策、公示、正式审批，强调前置论证和程序完整。",
            "steps": ["项目审查", "专家论证", "征求意见", "会议决策", "公示", "正式审批"],
        },
        {
            "id": "rule_decision_flow",
            "filename": "3.jpg",
            "title": "重大事项决策流程",
            "matterType": "重大决策",
            "summary": "调查定议、确定议题、酝酿意见、专家论证、征求意见、作出决策、依法公开。",
            "steps": ["调查定议", "确定议题", "酝酿意见", "专家论证", "征求意见", "作出决策", "依法公开"],
        },
    ]
