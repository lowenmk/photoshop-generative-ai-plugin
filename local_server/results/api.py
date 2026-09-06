from __future__ import annotations

from typing import List
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from automatic1111.results import Automatic1111Result, Automatic1111ResultGroup, Automatic1111ResultGroupItem
from utils.collection_utils import group_by
from utils.constants import RESULTS_LOG_PATH

router = APIRouter()


MAX_RESULT_GROUPS = 20


def _safe_output_file(name: str) -> Path:
    path = Path(name)
    if path.name != name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid result filename")
    resolved = (RESULTS_LOG_PATH.parent / name).resolve()
    try:
        resolved.relative_to(RESULTS_LOG_PATH.parent.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid result filename")
    return resolved


def _read_log_lines():
    try:
        with open(RESULTS_LOG_PATH) as f:
            return f.readlines()
    except FileNotFoundError:
        return []


def _rewrite_log(lines):
    temporary_path = RESULTS_LOG_PATH.with_suffix(".tmp")
    with open(temporary_path, "w") as f:
        f.writelines(lines)
    os.replace(temporary_path, RESULTS_LOG_PATH)


class GetResultsResponse(BaseModel):
    result_groups: List[Automatic1111ResultGroup]


@router.post("/results/get-all")
def get_all_results():
    results = []
    try:
        with open(RESULTS_LOG_PATH) as f:
            lines = f.readlines()
            for line in lines:
                results.append(Automatic1111Result.from_log_line(line))
    except FileNotFoundError:
        # This can happen on the first launch
        return GetResultsResponse(result_groups=[])

    result_groups_by_request_id = group_by(results, lambda result: result.request_id)
    result_groups = sorted(list(map(
        lambda result_group: Automatic1111ResultGroup(
            timestamp=result_group[0].timestamp,
            document_id=result_group[0].document_id,
            request_id=result_group[0].request_id,
            prompt=result_group[0].prompt,
            negative_prompt=result_group[0].negative_prompt,
            sampler_name=result_group[0].sampler_name,
            sampling_steps=result_group[0].sampling_steps,
            model_hash=result_group[0].model_hash,
            model_name=result_group[0].model_name,
            generated_width=result_group[0].generated_width,
            generated_height=result_group[0].generated_height,
            inference_type=result_group[0].inference_type,
            loras=result_group[0].loras,
            controlnet=result_group[0].controlnet,
            group_items=sorted(list(map(
                lambda result: Automatic1111ResultGroupItem(
                    image_file_name=result.image_file_name,
                    thumbnail_file_name=result.thumbnail_file_name,
                    seed=result.seed,
                    subseed=result.subseed,
                    cfg_scale=result.cfg_scale,
                    denoising_strength=result.denoising_strength,
                ),
                result_group,
                # Sort results within group by file name
            )), key=lambda group_item: group_item.image_file_name),
        ),
        result_groups_by_request_id.values(),
        # Sort groups by timestamp decreasing
    )), key=lambda result_group: result_group.timestamp, reverse=True)
    return GetResultsResponse(
        # Limit the number of results to avoid taking too much memory/making it too slow
        result_groups=result_groups[:MAX_RESULT_GROUPS],
    )


@router.delete("/results/result/{image_file_name}")
def delete_result(image_file_name: str):
    _safe_output_file(image_file_name)
    lines = _read_log_lines()
    kept = []
    removed = None
    for line in lines:
        result = Automatic1111Result.from_log_line(line)
        if result.image_file_name == image_file_name:
            removed = result
        else:
            kept.append(line)
    if removed:
        for name in (removed.image_file_name, removed.thumbnail_file_name):
            _safe_output_file(name).unlink(missing_ok=True)
        _rewrite_log(kept)
    return {"deleted": removed is not None, "image_file_name": image_file_name}


@router.delete("/results/batch/{request_id}")
def delete_batch(request_id: str):
    lines = _read_log_lines()
    kept = []
    removed = []
    for line in lines:
        result = Automatic1111Result.from_log_line(line)
        if result.request_id == request_id:
            removed.append(result)
        else:
            kept.append(line)
    for result in removed:
        for name in (result.image_file_name, result.thumbnail_file_name):
            _safe_output_file(name).unlink(missing_ok=True)
    if removed:
        _rewrite_log(kept)
    return {"deleted_count": len(removed), "request_id": request_id}
