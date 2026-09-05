from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class DevCommandRequest(BaseModel):
    command_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class DevCommandResult(BaseModel):
    ok: bool
    result: Optional[Any] = None
    error: Optional[Dict[str, str]] = None
    duration_ms: int = 0
