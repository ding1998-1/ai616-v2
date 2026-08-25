"""旧模块名兼容层。

模块化文档域统一实现于 :mod:`backend.routes.documents`；该文件仅让旧启动器
``backend.main`` 的导入路径继续可用，不重新引入 OnlyOffice 接口。
"""

from backend.routes.documents import router

__all__ = ["router"]
