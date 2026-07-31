from audit_persistence import persistence

def add_mock_audit():
    print("Manually adding a mock audit record...")
    record = persistence.save_audit(
        matter_type="重大决策",
        material="测试材料：公司拟进行重大资产重组。",
        report="## 审核报告\n\n1. 整体合规结论：🟢 合规\n2. 风险等级：🟢 低风险",
        results={"test": "data"}
    )
    print(f"Record saved with ID: {record['id']}")

if __name__ == "__main__":
    add_mock_audit()
