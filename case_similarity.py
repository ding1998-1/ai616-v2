try:
    from sentence_transformers import SentenceTransformer, util
    import torch
except Exception:  # 可选依赖：无 sentence_transformers/torch 环境下降级（与 backend_full 同类模式）
    SentenceTransformer = None
    util = None
    torch = None
from typing import List, Dict, Tuple
from legal_case_db import LegalCase, LegalCaseDatabase

if SentenceTransformer is None:
    class _UnavailableCaseSimilarityMatcher:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("法务相似度比对不可用：缺少 sentence_transformers/torch 依赖")

        def find_similar_cases(self, *a, **k):
            raise RuntimeError("法务相似度比对不可用：缺少 sentence_transformers/torch 依赖")

        def calculate_win_rate(self, *a, **k):
            raise RuntimeError("法务相似度比对不可用：缺少 sentence_transformers/torch 依赖")

        def analyze_case_risk(self, *a, **k):
            raise RuntimeError("法务相似度比对不可用：缺少 sentence_transformers/torch 依赖")

        def get_case_comparison_details(self, *a, **k):
            raise RuntimeError("法务相似度比对不可用：缺少 sentence_transformers/torch 依赖")

    CaseSimilarityMatcher = _UnavailableCaseSimilarityMatcher
else:
    class CaseSimilarityMatcher:
        def __init__(self, model_name: str = 'paraphrase-multilingual-mpnet-base-v2'):
            self.model = SentenceTransformer(model_name)
            self.case_db = LegalCaseDatabase()

    def preprocess_case_text(self, case_content: str) -> str:
        case_type_keywords = ['合同纠纷', '劳动争议', '侵权责任', '建设工程', '采购合同']
        for keyword in case_type_keywords:
            if keyword in case_content:
                case_content = case_content.replace(keyword, f" {keyword} ")
        return case_content.strip()

    def encode_cases(self, cases: List[LegalCase]) -> torch.Tensor:
        case_texts = [self.preprocess_case_text(case.case_content) for case in cases]
        return self.model.encode(case_texts, convert_to_tensor=True)

    def find_similar_cases(
        self,
        current_case_text: str,
        case_type: str = None,
        top_k: int = 5,
        similarity_threshold: float = 0.3
    ) -> List[Tuple[LegalCase, float]]:
        current_case_text = self.preprocess_case_text(current_case_text)
        current_embedding = self.model.encode(current_case_text, convert_to_tensor=True)

        cases = self.case_db.get_all_cases()

        if case_type:
            cases = [case for case in cases if case.case_type == case_type]

        if not cases:
            return []

        historical_embeddings = self.encode_cases(cases)

        cos_similarities = util.cos_sim(current_embedding, historical_embeddings)[0]

        case_similarities = list(zip(cases, cos_similarities.tolist()))

        filtered_cases = [
            (case, sim)
            for case, sim in case_similarities
            if sim >= similarity_threshold
        ]

        sorted_cases = sorted(filtered_cases, key=lambda x: x[1], reverse=True)

        self.case_db.update_similarity_scores(sorted_cases[0][0].case_id, sorted_cases[0][1])

        return sorted_cases[:top_k]

    def calculate_win_rate(
        self,
        current_case_text: str,
        case_type: str = None,
        top_k: int = 5
    ) -> Dict:
        similar_cases = self.find_similar_cases(current_case_text, case_type, top_k)

        if not similar_cases:
            return {
                "win_rate": 0.0,
                "confidence": 0.0,
                "similar_cases_count": 0,
                "recommendation": "案例库中无相似案例，无法预测胜诉率"
            }

        total_cases = len(similar_cases)
        wins = sum(1 for case, _ in similar_cases if case.outcome == "胜诉")
        partial_wins = sum(1 for case, _ in similar_cases if case.outcome == "部分胜诉")
        losses = sum(1 for case, _ in similar_cases if case.outcome == "败诉")

        weighted_wins = wins + partial_wins * 0.5
        win_rate = weighted_wins / total_cases

        avg_similarity = sum(sim for _, sim in similar_cases) / total_cases
        confidence = min(avg_similarity * 1.5, 1.0)

        if win_rate >= 0.7:
            recommendation = "胜诉概率较高，建议积极应诉"
        elif win_rate >= 0.5:
            recommendation = "胜诉概率中等，建议准备充分证据"
        else:
            recommendation = "胜诉概率较低，建议考虑和解或其他方案"

        return {
            "win_rate": round(win_rate, 3),
            "confidence": round(confidence, 3),
            "similar_cases_count": total_cases,
            "wins": wins,
            "partial_wins": partial_wins,
            "losses": losses,
            "recommendation": recommendation,
            "avg_similarity": round(avg_similarity, 3)
        }

    def get_case_comparison_details(
        self,
        current_case_text: str,
        case_type: str = None,
        top_k: int = 3
    ) -> Dict:
        similar_cases = self.find_similar_cases(current_case_text, case_type, top_k)

        if not similar_cases:
            return {
                "status": "no_similar_cases",
                "message": "案例库中无相似案例"
            }

        comparison_details = []
        for case, similarity in similar_cases:
            comparison_details.append({
                "case_id": case.case_id,
                "case_title": case.case_title,
                "similarity": round(similarity, 3),
                "outcome": case.outcome,
                "court_level": case.court_level,
                "case_amount": case.case_amount,
                "key_facts": case.key_facts,
                "relevant_laws": case.relevant_laws,
                "win_party": case.win_party
            })

        win_rate_result = self.calculate_win_rate(current_case_text, case_type, top_k)

        return {
            "status": "found_similar_cases",
            "win_rate_analysis": win_rate_result,
            "similar_cases": comparison_details
        }

    def analyze_case_risk(self, current_case_text: str, case_type: str = None) -> Dict:
        similar_cases = self.find_similar_cases(current_case_text, case_type, top_k=10)

        if not similar_cases:
            return {
                "risk_level": "未知",
                "risk_factors": ["无相似案例可参考"],
                "suggestions": ["建议咨询专业律师", "准备完整证据材料"]
            }

        win_rate_result = self.calculate_win_rate(current_case_text, case_type, top_k=10)

        risk_level = "低"
        if win_rate_result["win_rate"] < 0.3:
            risk_level = "高"
        elif win_rate_result["win_rate"] < 0.6:
            risk_level = "中"

        risk_factors = []
        suggestions = []

        losses = sum(1 for case, _ in similar_cases if case.outcome == "败诉")
        if losses > len(similar_cases) * 0.5:
            risk_factors.append("历史类似案件败诉率超过50%")

        avg_similarity = sum(sim for _, sim in similar_cases) / len(similar_cases)
        if avg_similarity < 0.6:
            risk_factors.append("案例相似度不高，参考价值有限")

        if win_rate_result["win_rate"] < 0.5:
            suggestions.append("建议考虑和解方案")
            suggestions.append("准备更加充分的证据材料")

        suggestions.append("咨询专业律师获取更详细的法律意见")
        suggestions.append("关注相关法律法规的最新变化")

        return {
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "suggestions": suggestions,
            "win_rate": win_rate_result["win_rate"],
            "confidence": win_rate_result["confidence"]
        }
