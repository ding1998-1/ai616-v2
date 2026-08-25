"""用户资料管理路由。账号创建和部门接口保留在 auth 路由，更新/删除单独归域。"""

from fastapi import APIRouter, HTTPException, Request

from backend.deps import _require_admin
from backend.services.user_service import delete_user, update_user


router = APIRouter(prefix="/api/users", tags=["users"])


@router.put("/{user_id}")
async def update_user_route(request: Request, user_id: str):
    _require_admin(request)
    try:
        user = update_user(user_id, await request.json())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        status = 409 if "用户名" in str(exc) and "存在" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return {"success": True, "user": user}


@router.delete("/{user_id}")
async def delete_user_route(request: Request, user_id: str):
    current_user = _require_admin(request)
    try:
        delete_user(user_id, current_user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True}
