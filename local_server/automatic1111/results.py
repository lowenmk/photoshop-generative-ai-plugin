from __future__ import annotations

from typing import Optional, List, Any
import json

from pydantic import BaseModel

from utils.exceptions import bad_request


class Automatic1111Result(BaseModel):
    timestamp: str
    image_file_name: str
    thumbnail_file_name: str
    document_id: int
    request_id: str
    seed: int
    subseed: int
    cfg_scale: float
    denoising_strength: Optional[float]
    prompt: str
    negative_prompt: str
    sampler_name: Optional[str] = None
    sampling_steps: Optional[int] = None
    model_hash: Optional[str] = None
    model_name: Optional[str] = None
    generated_width: Optional[int] = None
    generated_height: Optional[int] = None
    inference_type: Optional[str] = None
    loras: List[dict] = []

    def to_log_line(self) -> str:
        metadata = json.dumps({
            "sampler_name": self.sampler_name,
            "sampling_steps": self.sampling_steps,
            "model_hash": self.model_hash,
            "model_name": self.model_name,
            "generated_width": self.generated_width,
            "generated_height": self.generated_height,
            "inference_type": self.inference_type,
            "loras": self.loras,
        }, separators=(",", ":"))
        return f"{self.timestamp}\t{self.image_file_name}\t{self.thumbnail_file_name}\t" \
               f"{self.document_id}\t{self.request_id}\t" \
               f"{self.seed}\t{self.subseed}\t" \
               f"{self.cfg_scale}\t{self.denoising_strength}\t" \
               f"{self.prompt}\t{self.negative_prompt}\t{metadata}\n"

    @staticmethod
    def from_log_line(log_line: str) -> Automatic1111Result:
        splits = log_line.replace("\n", "").split("\t")
        if len(splits) < 11:
            raise bad_request(f"Cannot parse response log line {splits}")
        timestamp, image_file_name, thumbnail_file_name, \
            document_id, request_id, \
            seed, subseed, \
            cfg_scale, denoising_strength, \
            prompt, negative_prompt = splits[:11]
        metadata = {}
        if len(splits) > 11 and splits[11]:
            try:
                metadata = json.loads(splits[11])
            except json.JSONDecodeError:
                metadata = {}
        return Automatic1111Result(
            timestamp=timestamp,
            image_file_name=image_file_name,
            thumbnail_file_name=thumbnail_file_name,
            document_id=document_id,
            request_id=request_id,
            seed=int(seed),
            subseed=int(subseed),
            cfg_scale=float(cfg_scale),
            denoising_strength=None if denoising_strength == "None" else float(denoising_strength),
            prompt=prompt,
            negative_prompt=negative_prompt,
            sampler_name=metadata.get("sampler_name"),
            sampling_steps=metadata.get("sampling_steps"),
            model_hash=metadata.get("model_hash"),
            model_name=metadata.get("model_name"),
            generated_width=metadata.get("generated_width"),
            generated_height=metadata.get("generated_height"),
            inference_type=metadata.get("inference_type"),
            loras=metadata.get("loras") or [],
        )


class Automatic1111ResultGroupItem(BaseModel):
    image_file_name: str
    thumbnail_file_name: str
    seed: int
    subseed: int
    cfg_scale: float
    denoising_strength: Optional[float]


class Automatic1111ResultGroup(BaseModel):
    timestamp: str
    document_id: int
    request_id: str
    prompt: str
    negative_prompt: str
    group_items: List[Automatic1111ResultGroupItem]
    sampler_name: Optional[str] = None
    sampling_steps: Optional[int] = None
    model_hash: Optional[str] = None
    model_name: Optional[str] = None
    generated_width: Optional[int] = None
    generated_height: Optional[int] = None
    inference_type: Optional[str] = None
    loras: List[dict] = []
