"""模块化应用装配器。

会议主流程与业务工具域都按路由模块装配。生产入口切换仍由上层部署步骤控制，
本文件不改变 ``backend_full:app`` 的兼容入口。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.agendas import router as agendas_router
from backend.routes.agenda_timer import router as agenda_timer_router
from backend.routes.audit import router as audit_router
from backend.routes.auth import router as auth_router
from backend.routes.asr import router as asr_router
from backend.routes.contract import router as contract_router
from backend.routes.documents import router as documents_router
from backend.routes.health import router as health_router
from backend.routes.knowledge import router as knowledge_router
from backend.routes.meetings import router as meetings_router
from backend.routes.meeting_support import router as meeting_support_router
from backend.routes.meeting_review import router as meeting_review_router
from backend.routes.materials import router as materials_router
from backend.routes.misc import router as misc_router
from backend.routes.outcomes import router as outcomes_router
from backend.routes.permissions import router as permissions_router
from backend.routes.recordings import router as recordings_router
from backend.routes.rules import router as rules_router
from backend.routes.signatures import router as signatures_router
from backend.routes.transcripts import router as transcripts_router
from backend.routes.users import router as users_router
from backend.routes.voiceprint import router as voiceprint_router


def create_core_app() -> FastAPI:
    app = FastAPI(title="AI 会议工作台 API（模块化核心）")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for router in (
        health_router,
        misc_router,
        auth_router,
        asr_router,
        voiceprint_router,
        users_router,
        meetings_router,
        meeting_support_router,
        meeting_review_router,
        materials_router,
        agenda_timer_router,
        agendas_router,
        recordings_router,
        transcripts_router,
        outcomes_router,
        permissions_router,
        signatures_router,
        rules_router,
        knowledge_router,
        audit_router,
        documents_router,
        contract_router,
    ):
        app.include_router(router)
    return app
