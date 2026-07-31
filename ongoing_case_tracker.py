import json
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field
from datetime import datetime, timedelta
import random

@dataclass
class OngoingCase:
    case_id: str
    case_type: str
    case_title: str
    plaintiff: str
    defendant: str
    court_name: str
    court_level: str
    start_date: str
    status: str
    next_hearing_date: Optional[str] = None
    case_amount: float = 0.0
    case_description: str = ""
    related_announcements: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'OngoingCase':
        return cls(**data)

class OngoingCaseTracker:
    def __init__(self, data_path: str = 'data/ongoing_cases.json'):
        self.data_path = data_path
        self.ongoing_cases: Dict[str, OngoingCase] = {}
        self._load_data()

    def _load_data(self):
        try:
            with open(self.data_path, 'r', encoding='utf-8') as f:
                cases_data = json.load(f)
                for case_data in cases_data:
                    case = OngoingCase.from_dict(case_data)
                    self.ongoing_cases[case.case_id] = case
        except FileNotFoundError:
            self._initialize_sample_data()

    def _initialize_sample_data(self):
        base_date = datetime.now()

        sample_cases = [
            {
                "case_id": "ONGOING_001",
                "case_type": "合同纠纷",
                "case_title": "某国企与供应商采购合同纠纷",
                "plaintiff": "某国有企业",
                "defendant": "某科技有限公司",
                "court_name": "北京市海淀区人民法院",
                "court_level": "基层人民法院",
                "start_date": (base_date - timedelta(days=45)).strftime("%Y-%m-%d"),
                "status": "审理中",
                "next_hearing_date": (base_date + timedelta(days=15)).strftime("%Y-%m-%d"),
                "case_amount": 3500000.0,
                "case_description": "涉及设备采购合同违约，被告逾期交付且设备存在质量问题",
                "related_announcements": [
                    "2024-01-15 案件立案公告",
                    "2024-02-01 第一次庭审公告"
                ]
            },
            {
                "case_id": "ONGOING_002",
                "case_type": "劳动争议",
                "case_title": "某国企员工劳动合同纠纷",
                "plaintiff": "某国企员工",
                "defendant": "某国有企业",
                "court_name": "上海市浦东新区人民法院",
                "court_level": "基层人民法院",
                "start_date": (base_date - timedelta(days=30)).strftime("%Y-%m-%d"),
                "status": "调解中",
                "next_hearing_date": (base_date + timedelta(days=7)).strftime("%Y-%m-%d"),
                "case_amount": 80000.0,
                "case_description": "涉及单方面调岗降薪，员工主张违法解除劳动合同",
                "related_announcements": [
                    "2024-02-01 劳动仲裁裁决书公告"
                ]
            },
            {
                "case_id": "ONGOING_003",
                "case_type": "建设工程合同纠纷",
                "case_title": "某国企工程项目款纠纷",
                "plaintiff": "某建筑公司",
                "defendant": "某国有企业",
                "court_name": "广东省广州市中级人民法院",
                "court_level": "中级人民法院",
                "start_date": (base_date - timedelta(days=60)).strftime("%Y-%m-%d"),
                "status": "二审中",
                "next_hearing_date": (base_date + timedelta(days=25)).strftime("%Y-%m-%d"),
                "case_amount": 12000000.0,
                "case_description": "涉及工程款支付纠纷，一审原告胜诉，被告提起上诉",
                "related_announcements": [
                    "2023-12-15 一审判决公告",
                    "2024-01-20 上诉状公告"
                ]
            },
            {
                "case_id": "ONGOING_004",
                "case_type": "侵权责任纠纷",
                "case_title": "某国企知识产权侵权纠纷",
                "plaintiff": "某技术公司",
                "defendant": "某国有企业",
                "court_name": "江苏省南京市中级人民法院",
                "court_level": "中级人民法院",
                "start_date": (base_date - timedelta(days=20)).strftime("%Y-%m-%d"),
                "status": "等待立案",
                "next_hearing_date": None,
                "case_amount": 5000000.0,
                "case_description": "原告主张被告侵犯其软件著作权，要求停止侵权并赔偿",
                "related_announcements": []
            },
            {
                "case_id": "ONGOING_005",
                "case_type": "采购合同纠纷",
                "case_title": "某国企供应商合同违约案",
                "plaintiff": "某国有企业",
                "defendant": "某材料公司",
                "court_name": "四川省成都市中级人民法院",
                "court_level": "中级人民法院",
                "start_date": (base_date - timedelta(days=90)).strftime("%Y-%m-%d"),
                "status": "执行中",
                "next_hearing_date": None,
                "case_amount": 2800000.0,
                "case_description": "被告提供的材料不符合合同标准，法院判决被告赔偿",
                "related_announcements": [
                    "2024-01-10 判决生效公告",
                    "2024-02-01 执行立案公告"
                ]
            }
        ]

        for case_data in sample_cases:
            case = OngoingCase.from_dict(case_data)
            self.ongoing_cases[case.case_id] = case
        self._save_data()

    def _save_data(self):
        import os
        os.makedirs(os.path.dirname(self.data_path) if os.path.dirname(self.data_path) else '.', exist_ok=True)
        with open(self.data_path, 'w', encoding='utf-8') as f:
            cases_list = [case.to_dict() for case in self.ongoing_cases.values()]
            json.dump(cases_list, f, ensure_ascii=False, indent=2)

    def add_ongoing_case(self, case: OngoingCase):
        self.ongoing_cases[case.case_id] = case
        self._save_data()

    def get_ongoing_case(self, case_id: str) -> Optional[OngoingCase]:
        return self.ongoing_cases.get(case_id)

    def get_all_ongoing_cases(self) -> List[OngoingCase]:
        return list(self.ongoing_cases.values())

    def get_cases_by_status(self, status: str) -> List[OngoingCase]:
        return [case for case in self.ongoing_cases.values() if case.status == status]

    def get_cases_by_type(self, case_type: str) -> List[OngoingCase]:
        return [case for case in self.ongoing_cases.values() if case.case_type == case_type]

    def get_upcoming_hearings(self, days_ahead: int = 30) -> List[OngoingCase]:
        cutoff_date = datetime.now() + timedelta(days=days_ahead)
        upcoming_cases = []

        for case in self.ongoing_cases.values():
            if case.next_hearing_date:
                hearing_date = datetime.strptime(case.next_hearing_date, "%Y-%m-%d")
                if datetime.now() <= hearing_date <= cutoff_date:
                    upcoming_cases.append(case)

        return sorted(upcoming_cases, key=lambda x: datetime.strptime(x.next_hearing_date, "%Y-%m-%d"))

    def search_ongoing_cases(self, keyword: str) -> List[OngoingCase]:
        keyword = keyword.lower()
        return [
            case for case in self.ongoing_cases.values()
            if keyword in case.case_title.lower() or
               keyword in case.plaintiff.lower() or
               keyword in case.defendant.lower() or
               keyword in case.case_type.lower()
        ]

    def get_case_summary(self) -> Dict:
        cases = self.get_all_ongoing_cases()

        status_counts = {}
        type_counts = {}
        total_amount = 0.0

        for case in cases:
            status_counts[case.status] = status_counts.get(case.status, 0) + 1
            type_counts[case.case_type] = type_counts.get(case.case_type, 0) + 1
            total_amount += case.case_amount

        upcoming = self.get_upcoming_hearings(30)

        return {
            "total_cases": len(cases),
            "total_amount": total_amount,
            "status_distribution": status_counts,
            "type_distribution": type_counts,
            "upcoming_hearings_count": len(upcoming),
            "upcoming_hearings": [
                {
                    "case_id": case.case_id,
                    "case_title": case.case_title,
                    "hearing_date": case.next_hearing_date,
                    "court_name": case.court_name
                }
                for case in upcoming[:5]
            ]
        }

    def get_high_risk_cases(self, amount_threshold: float = 5000000.0) -> List[OngoingCase]:
        return [
            case for case in self.ongoing_cases.values()
            if case.case_amount >= amount_threshold
        ]

    def update_case_status(self, case_id: str, new_status: str, next_hearing_date: str = None):
        if case_id in self.ongoing_cases:
            self.ongoing_cases[case_id].status = new_status
            if next_hearing_date:
                self.ongoing_cases[case_id].next_hearing_date = next_hearing_date
            self._save_data()

    def get_court_case_distribution(self) -> Dict:
        court_distribution = {}

        for case in self.ongoing_cases.values():
            court_name = case.court_name
            if court_name not in court_distribution:
                court_distribution[court_name] = {
                    "count": 0,
                    "cases": []
                }
            court_distribution[court_name]["count"] += 1
            court_distribution[court_name]["cases"].append({
                "case_id": case.case_id,
                "case_title": case.case_title,
                "status": case.status
            })

        return court_distribution
