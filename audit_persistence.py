import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any

class AuditPersistence:
    def __init__(self, base_dir: str = "data"):
        self.base_dir = base_dir
        self.history_file = os.path.join(base_dir, "audit_history.json")
        self.upload_dir = os.path.join(base_dir, "uploads")
        
        # Ensure directories exist
        os.makedirs(self.upload_dir, exist_ok=True)
        if not os.path.exists(self.history_file):
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump([], f)

    def save_audit(self, matter_type: str, material: str, report: str, results: Dict[str, Any] = None) -> Dict[str, Any]:
        """Save a new audit record to the JSON history."""
        try:
            with open(self.history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            history = []

        record = {
            "key": str(uuid.uuid4()),
            "id": f"SXZ-{datetime.now().strftime('%Y-%m%d')}-{len(history)+1:03d}",
            "matterType": matter_type,
            "title": material[:100] + ("..." if len(material) > 100 else ""),
            "material": material,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "status": "已归档",
            "report": report,
            "results": results or {},
            "riskLevel": self._infer_risk_level(report),
            "participants": "系统自动审核"
        }
        
        history.insert(0, record)  # Newest first
        
        with open(self.history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
            
        return record

    def get_history(self) -> List[Dict[str, Any]]:
        """Retrieve the audit history."""
        try:
            with open(self.history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []

    def save_file(self, filename: str, content: bytes) -> str:
        """Save an uploaded file to the uploads directory."""
        # Clean filename to avoid path injection
        base_name = os.path.basename(filename)
        unique_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{base_name}"
        file_path = os.path.join(self.upload_dir, unique_name)
        
        with open(file_path, 'wb') as f:
            f.write(content)
            
        return unique_name

    def _infer_risk_level(self, report: str) -> str:
        """Roughly infer risk level from the report text."""
        if "⚠️ 不合规" in report or "red" in report.lower() or "高风险" in report:
            return "高风险"
        if "缺失" in report or "yellow" in report.lower() or "中风险" in report:
            return "中风险"
        return "低风险"

# Singleton instance
persistence = AuditPersistence()
