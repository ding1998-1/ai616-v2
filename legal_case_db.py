import json
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
from datetime import datetime

@dataclass
class LegalCase:
    case_id: str
    case_type: str
    case_title: str
    case_content: str
    court_level: str
    court_name: str
    case_date: str
    outcome: str
    win_party: str
    relevant_laws: List[str]
    key_facts: List[str]
    evidence_summary: str
    plaintiff: str
    defendant: str
    case_amount: float
    similarity_score: float = 0.0

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'LegalCase':
        return cls(**data)

class LegalCaseDatabase:
    def __init__(self, db_path: str = 'data/legal_cases.json'):
        self.db_path = db_path
        self.cases: Dict[str, LegalCase] = {}
        self._load_database()

    def _load_database(self):
        try:
            with open(self.db_path, 'r', encoding='utf-8') as f:
                cases_data = json.load(f)
                for case_data in cases_data:
                    case = LegalCase.from_dict(case_data)
                    self.cases[case.case_id] = case
        except FileNotFoundError:
            self._initialize_sample_data()

    def _initialize_sample_data(self):
        sample_cases = [
            {
                "case_id": "CASE_001",
                "case_type": "合同纠纷",
                "case_title": "某国企与供应商设备采购合同纠纷案",
                "case_content": "原告某国有企业与被告某设备供应商签订设备采购合同，合同约定被告应在30日内交付设备。被告逾期交付超过60日，且设备存在质量问题。原告要求解除合同并赔偿损失。",
                "court_level": "中级人民法院",
                "court_name": "北京市第三中级人民法院",
                "case_date": "2023-06-15",
                "outcome": "胜诉",
                "win_party": "原告",
                "relevant_laws": ["合同法第107条", "合同法第113条", "民法典第509条"],
                "key_facts": [
                    "合同明确约定交付期限",
                    "被告逾期交付60日",
                    "设备存在质量问题",
                    "原告已支付部分款项"
                ],
                "evidence_summary": "采购合同原件、付款凭证、验收不合格报告、催告函",
                "plaintiff": "某国有企业",
                "defendant": "某设备供应商",
                "case_amount": 5000000.0,
                "similarity_score": 0.0
            },
            {
                "case_id": "CASE_002",
                "case_type": "劳动争议",
                "case_title": "某国企员工劳动合同纠纷案",
                "case_content": "原告某国企员工因工作调整与被告某国有企业发生劳动争议。被告以组织架构调整为由单方面变更原告工作岗位并降薪，原告认为被告违反劳动合同约定。",
                "court_level": "基层人民法院",
                "court_name": "北京市朝阳区人民法院",
                "case_date": "2023-08-20",
                "outcome": "部分胜诉",
                "win_party": "原告",
                "relevant_laws": ["劳动合同法第35条", "劳动合同法第40条", "劳动法第17条"],
                "key_facts": [
                    "劳动合同约定工作岗位",
                    "公司未协商单方面调岗",
                    "薪资被降低",
                    "员工同意过组织架构调整"
                ],
                "evidence_summary": "劳动合同原件、调岗通知、工资流水、协商记录",
                "plaintiff": "某国企员工",
                "defendant": "某国有企业",
                "case_amount": 150000.0,
                "similarity_score": 0.0
            },
            {
                "case_id": "CASE_003",
                "case_type": "建设工程合同纠纷",
                "case_title": "某国企工程款纠纷案",
                "case_content": "原告某建筑公司承建被告某国有企业的工程项目。工程竣工验收合格后，被告以审计未完成为由拒付工程款，原告多次催告未果。",
                "court_level": "高级人民法院",
                "court_name": "上海市高级人民法院",
                "case_date": "2023-10-05",
                "outcome": "胜诉",
                "win_party": "原告",
                "relevant_laws": ["合同法第286条", "建设工程质量管理条例", "民法典第799条"],
                "key_facts": [
                    "工程已竣工验收合格",
                    "被告以审计未完成为由拒付",
                    "原告多次催告",
                    "合同明确约定付款条件"
                ],
                "evidence_summary": "工程竣工验收报告、合同原件、付款申请、催告函",
                "plaintiff": "某建筑公司",
                "defendant": "某国有企业",
                "case_amount": 8500000.0,
                "similarity_score": 0.0
            },
            {
                "case_id": "CASE_004",
                "case_type": "合同纠纷",
                "case_title": "某国企采购合同违约案",
                "case_content": "原告某国有企业向被告供应商采购原材料，合同约定质量标准。被告交付的原材料不符合约定标准，造成原告生产停滞。",
                "court_level": "中级人民法院",
                "court_name": "广东省广州市中级人民法院",
                "case_date": "2023-07-10",
                "outcome": "胜诉",
                "win_party": "原告",
                "relevant_laws": ["合同法第111条", "合同法第113条", "民法典第615条"],
                "key_facts": [
                    "合同约定明确的质量标准",
                    "原材料不符合标准",
                    "造成生产停滞损失",
                    "被告明知质量问题仍交付"
                ],
                "evidence_summary": "采购合同、质量检测报告、停产损失证明、沟通记录",
                "plaintiff": "某国有企业",
                "defendant": "某供应商",
                "case_amount": 3200000.0,
                "similarity_score": 0.0
            },
            {
                "case_id": "CASE_005",
                "case_type": "侵权责任纠纷",
                "case_title": "某国企环境污染责任案",
                "case_content": "原告周边村民起诉被告某国有企业，称被告的生产活动造成环境污染，影响村民健康和农作物生长，要求赔偿损失。",
                "court_level": "中级人民法院",
                "court_name": "江苏省南京市中级人民法院",
                "case_date": "2023-09-25",
                "outcome": "败诉",
                "win_party": "被告",
                "relevant_laws": ["环境保护法", "侵权责任法第65条", "民法典第1229条"],
                "key_facts": [
                    "村民声称环境污染",
                    "要求赔偿损失",
                    "被告有环保审批手续",
                    "环境监测合格"
                ],
                "evidence_summary": "环境监测报告、环评审批文件、村民损失清单、医疗记录",
                "plaintiff": "周边村民",
                "defendant": "某国有企业",
                "case_amount": 2000000.0,
                "similarity_score": 0.0
            }
        ]

        for case_data in sample_cases:
            case = LegalCase.from_dict(case_data)
            self.cases[case.case_id] = case
        self._save_database()

    def _save_database(self):
        import os
        os.makedirs(os.path.dirname(self.db_path) if os.path.dirname(self.db_path) else '.', exist_ok=True)
        with open(self.db_path, 'w', encoding='utf-8') as f:
            cases_list = [case.to_dict() for case in self.cases.values()]
            json.dump(cases_list, f, ensure_ascii=False, indent=2)

    def add_case(self, case: LegalCase):
        self.cases[case.case_id] = case
        self._save_database()

    def get_case(self, case_id: str) -> Optional[LegalCase]:
        return self.cases.get(case_id)

    def get_cases_by_type(self, case_type: str) -> List[LegalCase]:
        return [case for case in self.cases.values() if case.case_type == case_type]

    def get_all_cases(self) -> List[LegalCase]:
        return list(self.cases.values())

    def search_cases(self, keyword: str) -> List[LegalCase]:
        keyword = keyword.lower()
        return [
            case for case in self.cases.values()
            if keyword in case.case_title.lower() or
               keyword in case.case_content.lower() or
               keyword in case.plaintiff.lower() or
               keyword in case.defendant.lower()
        ]

    def update_similarity_scores(self, case_id: str, similarity_score: float):
        if case_id in self.cases:
            self.cases[case_id].similarity_score = similarity_score
            self._save_database()

    def get_win_rate_by_type(self, case_type: str, plaintiff_type: str = "某国企") -> float:
        cases = self.get_cases_by_type(case_type)
        if not cases:
            return 0.0

        plaintiff_wins = sum(1 for case in cases if plaintiff_type in case.plaintiff and case.outcome == "胜诉")
        plaintiff_partial_wins = sum(1 for case in cases if plaintiff_type in case.plaintiff and case.outcome == "部分胜诉")

        total = sum(1 for case in cases if plaintiff_type in case.plaintiff)
        if total == 0:
            return 0.0

        return (plaintiff_wins + plaintiff_partial_wins * 0.5) / total

    def get_similar_cases_stats(self, top_n: int = 5) -> Dict:
        sorted_cases = sorted(self.cases.values(), key=lambda x: x.similarity_score, reverse=True)[:top_n]
        similar_cases = [case for case in sorted_cases if case.similarity_score > 0.3]

        if not similar_cases:
            return {"total": 0, "wins": 0, "losses": 0, "partial": 0, "win_rate": 0.0}

        wins = sum(1 for case in similar_cases if case.outcome == "胜诉")
        losses = sum(1 for case in similar_cases if case.outcome == "败诉")
        partial = sum(1 for case in similar_cases if case.outcome == "部分胜诉")

        win_rate = (wins + partial * 0.5) / len(similar_cases)

        return {
            "total": len(similar_cases),
            "wins": wins,
            "losses": losses,
            "partial": partial,
            "win_rate": round(win_rate, 3)
        }
