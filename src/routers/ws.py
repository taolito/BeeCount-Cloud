import logging

from fastapi import APIRouter, Query, WebSocket
from sqlalchemy import select

from ..database import SessionLocal
from ..models import User
from ..security import SCOPE_APP_WRITE, SCOPE_WEB_WRITE, decode_token

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(default="")) -> None:
    if not token:
        await websocket.close(code=1008)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=1008)
            return
        scopes = payload.get("scopes", [])
        if not isinstance(scopes, list):
            await websocket.close(code=1008)
            return
        normalized = {str(scope) for scope in scopes if isinstance(scope, str)}
        if SCOPE_APP_WRITE not in normalized and SCOPE_WEB_WRITE not in normalized:
            await websocket.close(code=1008)
            return
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=1008)
            return
    except Exception:
        await websocket.close(code=1008)
        return

    # with 语义:握手期查询抛错(池超时 / 库锁)时也要把连接还回池里,
    # 否则每个失败的握手都会永久吞掉一条连接,池打满后整站请求排队到超时。
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        await websocket.close(code=1008)
        return

    manager = websocket.app.state.ws_manager
    await manager.connect(user_id, websocket)
    logger.info("ws.connect user=%s", user_id)
    try:
        while True:
            msg = await websocket.receive_text()
            # Support client-initiated heartbeat: the client sends {"type":"ping"}
            # every ~25s and waits for a pong. If the socket is silently broken,
            # the pong won't arrive and the client's no-frames timer forces a
            # reconnect. Tolerate malformed payloads silently.
            if msg and '"ping"' in msg:
                try:
                    await websocket.send_text('{"type":"pong"}')
                except Exception:
                    break
    except Exception:
        pass
    finally:
        manager.disconnect(user_id, websocket)
        logger.info("ws.disconnect user=%s", user_id)
