import logging
from typing import Any, Optional

from .protocol import KIMI_DELETE_CHAT_PATH
from .transport import build_kimi_headers

logger = logging.getLogger("kimi2api.kimi_cleanup")


async def try_delete_chat_for_runtime(
    *,
    runtime: Any,
    base_url: str,
    chat_id: Optional[str],
) -> None:
    if not chat_id:
        return

    async def _get_headers() -> dict[str, str]:
        token = await runtime.token_manager.get_access_token()
        return build_kimi_headers(
            base_url=base_url,
            token=token,
            device_id=runtime.account.device_id,
            session_id=runtime.session_id,
            extra={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Connect-Protocol-Version": "1",
            },
        )

    try:
        headers = await _get_headers()
        response = await runtime.transport.request(
            "POST",
            KIMI_DELETE_CHAT_PATH,
            json={"chat_id": chat_id},
            headers=headers,
            timeout=15.0,
        )
        if response.status_code == 401:
            await runtime.token_manager.invalidate_and_retry()
            headers = await _get_headers()
            response = await runtime.transport.request(
                "POST",
                KIMI_DELETE_CHAT_PATH,
                json={"chat_id": chat_id},
                headers=headers,
                timeout=15.0,
            )
        if response.status_code != 200:
            body = response.text[:200]
            logger.warning(
                "Failed to delete upstream chat %s for account %s: %s %s",
                chat_id,
                runtime.account_id or "legacy",
                response.status_code,
                body or "<empty>",
            )
    except Exception as exc:
        logger.warning(
            "Failed to delete upstream chat %s for account %s: %s",
            chat_id,
            runtime.account_id or "legacy",
            exc,
        )