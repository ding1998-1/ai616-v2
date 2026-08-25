"""Guard the modular API surface against accidental legacy route loss."""

from __future__ import annotations

import ast
from pathlib import Path

from backend.app_factory import create_core_app


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REMOVED_ONLYOFFICE_ROUTES = {
    ("GET", "/doc/editor_page/{saved_name}"),
    ("GET", "/doc/plugin/audit_navigator"),
    ("GET", "/doc/plugin/audit_navigator/config.json"),
    ("GET", "/doc/plugin/audit_navigator/icon.png"),
    ("GET", "/doc/plugin/audit_navigator/index.html"),
    ("POST", "/doc/callback"),
    ("POST", "/doc/edit_url"),
    ("POST", "/doc/selection"),
    ("POST", "/doc/submit_suggestion"),
}


def _legacy_route_keys() -> set[tuple[str, str]]:
    tree = ast.parse((PROJECT_ROOT / "backend_full.py").read_text(encoding="utf-8"))
    result: set[tuple[str, str]] = set()
    verbs = {"get", "post", "put", "patch", "delete", "websocket"}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            owner = decorator.func.value
            verb = decorator.func.attr
            if not isinstance(owner, ast.Name) or owner.id != "app" or verb not in verbs:
                continue
            if not decorator.args or not isinstance(decorator.args[0], ast.Constant):
                continue
            path = decorator.args[0].value
            if isinstance(path, str):
                result.add(("WS" if verb == "websocket" else verb.upper(), path))
    return result


def _modular_route_keys() -> set[tuple[str, str]]:
    result: set[tuple[str, str]] = set()
    for route in create_core_app().routes:
        path = getattr(route, "path", "")
        if path in {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}:
            continue
        methods = getattr(route, "methods", None)
        if methods:
            result.update((method, path) for method in methods if method not in {"HEAD", "OPTIONS"})
        else:
            result.add(("WS", path))
    return result


def test_modular_app_keeps_all_non_onlyoffice_legacy_routes():
    missing = _legacy_route_keys() - _modular_route_keys()
    assert missing == REMOVED_ONLYOFFICE_ROUTES
