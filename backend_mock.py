from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(title="三重一大合规审核与法务对比 API（模拟版本）")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request models
class AuditRequest(BaseModel):
    matter_type: str
    material_text: str

class LegalCompareRequest(BaseModel):
    case_type: str
    case_description: str
    case_amount: float = 0.0

class ChatResponse(BaseModel):
    success: bool
    message: str
    report: Optional[str] = None
    legal_analysis: Optional[dict] = None

# Rules database
RULES_DB = {
    "重大决策": {
        "强制要求": "必须经党委前置研究讨论；集体决策；法律审查；会议纪要存档。",
        "禁止事项": "禁止个人或少数人决定；无会议纪要；未经法律审查。",
        "决策程序": ["提出书面建议书", "党支部审查列入", "承办部门拟方案", "征求意见", "院办公室报告", "院务会议集体讨论表决", "实施与监督"],
        "责任主体": "党委书记/董事长主持；主管领导论证；法律合规部审查；纪检监督部监督。"
    },
    "重大项目安排": {
        "强制要求": "必须可行性报告、风险评估、法律审查；党委前置。",
        "禁止事项": "禁止超预算、无审批。",
        "决策程序": ["项目审查", "专家论证", "征求意见", "会议决策", "公示", "正式审批"],
        "责任主体": "战略规划部论证；法律合规部审查。"
    },
    "大额度资金运作": {
        "强制要求": "必须资金使用计划；双人签字或集体审批。",
        "禁止事项": "禁止私下转账、无审计记录。",
        "决策程序": ["安排预算", "党组集体研究", "公开公示", "资金拨付"],
        "责任主体": "财务部门执行；审计部监督。"
    },
    "重要人事任免": {
        "强制要求": "坚持党管干部；事先征求纪检意见；集体决定；任前公示；试用期考核。",
        "禁止事项": "禁止个人决定。",
        "决策程序": ["民主推荐", "组织考察", "会议决定", "任前公示", "试用1年", "正式任免"],
        "责任主体": "人力资源部考察；纪检监督部意见。"
    }
}

# Mock legal cases
MOCK_CASES = {
    "合同纠纷": [
        {"case_id": "CASE_001", "case_title": "某国企与供应商设备采购合同纠纷案", "outcome": "胜诉", "similarity": 0.85},
        {"case_id": "CASE_002", "case_title": "某国企采购合同违约案", "outcome": "胜诉", "similarity": 0.78},
        {"case_id": "CASE_003", "case_title": "某原材料供应合同纠纷", "outcome": "部分胜诉", "similarity": 0.72}
    ],
    "劳动争议": [
        {"case_id": "CASE_004", "case_title": "某国企员工劳动合同纠纷案", "outcome": "部分胜诉", "similarity": 0.81},
        {"case_id": "CASE_005", "case_title": "某国企调岗降薪纠纷", "outcome": "胜诉", "similarity": 0.76}
    ],
    "侵权责任": [
        {"case_id": "CASE_006", "case_title": "某国企环境污染责任案", "outcome": "败诉", "similarity": 0.75}
    ],
    "建设工程": [
        {"case_id": "CASE_007", "case_title": "某国企工程款纠纷案", "outcome": "胜诉", "similarity": 0.82}
    ]
}

# Mock ongoing cases
MOCK_ONGOING_CASES = [
    {
        "case_id": "ONGOING_001",
        "case_type": "合同纠纷",
        "case_title": "某国企与供应商采购合同纠纷",
        "plaintiff": "某国有企业",
        "defendant": "某科技有限公司",
        "court_name": "北京市海淀区人民法院",
        "court_level": "基层人民法院",
        "start_date": "2024-01-15",
        "status": "审理中",
        "next_hearing_date": "2024-03-17",
        "case_amount": 3500000.0,
        "case_description": "涉及设备采购合同违约，被告逾期交付且设备存在质量问题"
    },
    {
        "case_id": "ONGOING_002",
        "case_type": "劳动争议",
        "case_title": "某国企员工劳动合同纠纷",
        "plaintiff": "某国企员工",
        "defendant": "某国有企业",
        "court_name": "上海市浦东新区人民法院",
        "court_level": "基层人民法院",
        "start_date": "2024-02-01",
        "status": "调解中",
        "next_hearing_date": "2024-03-09",
        "case_amount": 80000.0,
        "case_description": "涉及单方面调岗降薪，员工主张违法解除劳动合同"
    },
    {
        "case_id": "ONGOING_003",
        "case_type": "建设工程",
        "case_title": "某国企工程项目款纠纷",
        "plaintiff": "某建筑公司",
        "defendant": "某国有企业",
        "court_name": "广东省广州市中级人民法院",
        "court_level": "中级人民法院",
        "start_date": "2024-01-01",
        "status": "二审中",
        "next_hearing_date": "2024-03-27",
        "case_amount": 12000000.0,
        "case_description": "涉及工程款支付纠纷，一审原告胜诉，被告提起上诉"
    }
]

@app.get("/")
async def root():
    return {"message": "三重一大合规审核与法务对比 API 服务已启动（模拟版本）"}

@app.get("/matter-types")
async def get_matter_types():
    """获取可用的事项类型"""
    return {"matter_types": list(RULES_DB.keys())}

@app.get("/legal-case-types")
async def get_legal_case_types():
    """获取可用的案件类型"""
    return {"legal_case_types": list(MOCK_CASES.keys())}

@app.post("/audit", response_model=ChatResponse)
async def audit(request: AuditRequest):
    """执行合规审核"""
    try:
        logger.info(f"收到合规审核请求 - 事项类型: {request.matter_type}")

        # Extract rules
        rules = RULES_DB.get(request.matter_type, {"error": "未匹配事项类型"})

        # Simple validation
        validation_report = []
        for key in ["强制要求", "禁止事项"]:
            if key in rules:
                # Simple keyword matching
                status = "合规" if any(word in request.material_text for word in rules[key].split("；")) else "⚠️ 不合规"
                validation_report.append({"规则": rules[key], "状态": status})

        # Procedure check
        procedure_report = []
        steps = rules.get("决策程序", [])
        for step in steps:
            status = "已覆盖" if step in request.material_text else "缺失"
            procedure_report.append({"环节": step, "状态": status})

        # Responsibility check
        subject = rules.get("责任主体", "")
        responsibility_status = "责任主体明确，监督机制提及。" if subject in request.material_text else "责任主体或监督缺失，请补充。"

        # Generate report
        report = f"""# 三重一大合规审核报告

## 整体合规结论
**部分不合规** - 存在部分合规项和部分缺失项

## 规则匹配情况
"""
        for item in validation_report:
            report += f"\n- **{item['规则']}**: {item['状态']}"

        report += f"""

## 程序完整性结果
"""
        for item in procedure_report:
            report += f"- {item['环节']}: {item['状态']}\n"

        report += f"""
## 责任与监督落实情况
{responsibility_status}

## 主要缺失或风险点
- 决策程序存在缺失环节
- 建议补充完整的会议记录和审查意见

## 整改建议
1. 补充缺失的决策程序环节
2. 完善会议纪要存档
3. 强化法律合规审查流程
4. 明确责任主体和监督机制
"""

        logger.info("合规审核完成")
        return ChatResponse(
            success=True,
            message="审核完成",
            report=report
        )

    except Exception as e:
        logger.error(f"审核失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/legal-compare", response_model=ChatResponse)
async def legal_compare(request: LegalCompareRequest):
    """执行法务对比分析"""
    try:
        logger.info(f"收到法务对比请求 - 案件类型: {request.case_type}")

        # Get similar cases
        similar_cases = MOCK_CASES.get(request.case_type, [])
        if not similar_cases:
            return ChatResponse(
                success=False,
                message="未找到该类型的案例"
            )

        # Calculate win rate
        wins = sum(1 for case in similar_cases if case["outcome"] == "胜诉")
        partial_wins = sum(1 for case in similar_cases if case["outcome"] == "部分胜诉")
        total = len(similar_cases)
        win_rate = (wins + partial_wins * 0.5) / total

        # Determine risk level
        if win_rate >= 0.7:
            risk_level = "低"
            recommendation = "胜诉概率较高，建议积极应诉"
        elif win_rate >= 0.5:
            risk_level = "中"
            recommendation = "胜诉概率中等，建议准备充分证据"
        else:
            risk_level = "高"
            recommendation = "胜诉概率较低，建议考虑和解或其他方案"

        # Generate report
        report = f"""# 法务对比分析报告

## 案件类型
{request.case_type}

## 相似案例分析
找到 {total} 个相似案例：
"""
        for case in similar_cases:
            report += f"""
- **{case['case_title']}**
  - 判决结果: {case['outcome']}
  - 相似度: {case['similarity']}
"""

        report += f"""
## 胜诉率预测
**预测胜诉率**: {win_rate * 100:.1f}%
**置信度**: 0.82
**风险等级**: {risk_level}

## 风险评估
- 风险等级: {risk_level}
- 建议: {recommendation}

## 应诉建议
1. 准备充分的证据材料
2. 关注关键争议焦点
3. 制定完善的应诉策略
4. 考虑调解和解的可行性
"""

        logger.info("法务对比分析完成")
        return ChatResponse(
            success=True,
            message="分析完成",
            report=report,
            legal_analysis={
                "win_rate": round(win_rate, 3),
                "confidence": 0.82,
                "risk_level": risk_level,
                "similar_cases": similar_cases
            }
        )

    except Exception as e:
        logger.error(f"法务分析失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/ongoing-cases")
async def get_ongoing_cases():
    """获取所有正在进行的案件"""
    try:
        return {
            "success": True,
            "total": len(MOCK_ONGOING_CASES),
            "cases": MOCK_ONGOING_CASES
        }
    except Exception as e:
        logger.error(f"获取案件失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/upcoming-hearings")
async def get_upcoming_hearings():
    """获取即将开庭的案件"""
    try:
        upcoming = [case for case in MOCK_ONGOING_CASES if case.get("next_hearing_date")]
        return {
            "success": True,
            "total": len(upcoming),
            "hearings": upcoming
        }
    except Exception as e:
        logger.error(f"获取开庭信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
