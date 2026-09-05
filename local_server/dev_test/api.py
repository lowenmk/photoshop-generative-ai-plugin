import asyncio
import os
import time

from fastapi import APIRouter, HTTPException, Response

from .command_service import ALLOWED_COMMAND_TYPES, broker
from .models import DevCommandRequest


router = APIRouter(prefix="/dev/photoshop")
COMMAND_TIMEOUT_SECONDS = 10


def _enqueue(command_type, payload):
    if command_type not in ALLOWED_COMMAND_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown development command type: {command_type}")
    return broker.enqueue(command_type, payload)


async def _run(command_type, payload):
    command = _enqueue(command_type, payload)
    completed = await asyncio.to_thread(broker.wait, command["command_id"], COMMAND_TIMEOUT_SECONDS)
    if not completed or completed["status"] not in {"completed", "failed"}:
        broker.expire(command["command_id"])
        raise HTTPException(status_code=504, detail="Photoshop test command timed out")
    if completed["status"] == "failed":
        raise HTTPException(status_code=500, detail=completed["error"] or "Photoshop test command failed")
    return completed["result"]


@router.get("/health")
async def health():
    return broker.health()


@router.post("/command")
async def enqueue_command(request: DevCommandRequest):
    command = _enqueue(request.command_type, request.payload)
    return {"command_id": command["command_id"], "status": command["status"]}


@router.get("/command/next")
async def next_command():
    command = broker.claim_next()
    if not command:
        return Response(status_code=204)
    return {
        "command_id": command["command_id"],
        "command_type": command["command_type"],
        "payload": command["payload"],
    }


@router.post("/command/{command_id}/result")
async def command_result(command_id: str, body: dict):
    duration_ms = int(body.get("duration_ms", 0))
    if body.get("ok") is True:
        if not broker.complete(command_id, body.get("result"), duration_ms):
            raise HTTPException(status_code=404, detail="Unknown development command")
    else:
        error = body.get("error") or {"type": "Error", "message": "Unknown Photoshop test error"}
        if not broker.fail(command_id, error, duration_ms):
            raise HTTPException(status_code=404, detail="Unknown development command")
    return {"ok": True}


@router.get("/command/{command_id}")
async def command_status(command_id: str):
    command = broker.get(command_id)
    if not command:
        raise HTTPException(status_code=404, detail="Unknown development command")
    return command


@router.get("/state")
async def state():
    return await _run("get_state", {})


@router.post("/test/create-document")
async def create_document(payload: dict = None):
    return await _run("create_test_document", payload or {})


@router.post("/test/selection")
async def set_selection(payload: dict):
    return await _run("set_selection", payload)


@router.delete("/test/selection")
async def clear_selection():
    return await _run("clear_selection", {})


@router.post("/test/export-current-selection")
async def export_current_selection(payload: dict = None):
    return await _run("export_current_selection_mask", payload or {})


@router.post("/test/place/new-layer")
async def place_new_layer(payload: dict):
    return await _run("place_new_layer", payload)


@router.post("/test/place/replace-area")
async def place_replace_area(payload: dict):
    return await _run("place_replace_area", payload)


@router.post("/test/place/open-image")
async def place_open_image(payload: dict):
    return await _run("place_open_image", payload)


@router.post("/test/failure-mode")
async def set_failure_mode(payload: dict):
    return await _run("set_failure_mode", payload)


@router.delete("/test/failure-mode")
async def clear_failure_mode():
    return await _run("clear_failure_mode", {})


@router.post("/test/close-document")
async def close_document(payload: dict):
    return await _run("close_test_document", payload)
