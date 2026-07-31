import asyncio
import json
import httpx

async def test_audit():
    async with httpx.AsyncClient() as client:
        req = {"matter_type": "重大决策", "material_text": "这是一个测试大额度资金的使用。"}
        async with client.stream("POST", "http://localhost:8000/audit_stream", json=req, timeout=30) as r:
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    print("RECEIVED:", line)

asyncio.run(test_audit())
