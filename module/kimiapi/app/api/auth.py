from typing import Optional

from fastapi import Header, HTTPException, Request, status


async def verify_api_key(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "Missing bearer token",
                "type": "invalid_request_error",
            },
        )
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "Missing bearer token",
                "type": "invalid_request_error",
            },
        )
    request.state.kimi_token = token
