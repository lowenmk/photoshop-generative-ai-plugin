from __future__ import annotations

from typing import Optional

import cv2
from fastapi import APIRouter

from automatic1111.client import automatic1111_client
from automatic1111.image_generation_service import image_generation_service
from automatic1111.models import Automatic1111CheckProgressResponse, Automatic1111GenerateTxt2ImgRequest, \
    Automatic1111GenerateImg2ImgRequest, Automatic1111GenerateInpaintRequest, Automatic1111GetModelsResponse, \
    SelectionArea, Automatic1111ChangeCurrentModelResponse, \
    Automatic1111GetSamplersResponse, Automatic1111BatchGenerateImageRequest, Automatic1111StatusResponse, \
    Automatic1111ControlNetStatusResponse, ControlNetInstallRequest
from automatic1111.run_configuration_provider import run_configuration_provider
from automatic1111.controlnet_installer import install_controlnet
from utils.constants import OUTPUT_FOLDER_PATH
from utils.image_utils import extract_image_from_selection_and_scale, convert_mask_image, get_scale_factor, \
    read_image_as_full_sized_layer, adjust_selection_area

router = APIRouter()


def _read_controlnet_source(request, document_width, document_height):
    controlnet = request.controlnet
    if not controlnet or not controlnet.enabled or not controlnet.source_image_path:
        return None, None
    return read_image_as_full_sized_layer(
        document_width=document_width,
        document_height=document_height,
        image_file_path=controlnet.source_image_path,
        image_x=controlnet.source_image_x or 0,
        image_y=controlnet.source_image_y or 0,
        layer_description="ControlNet source layer",
    )


@router.get("/sd/automatic1111/status")
def get_status() -> Automatic1111StatusResponse:
    is_reachable = automatic1111_client.is_reachable()
    return Automatic1111StatusResponse(
        is_reachable=is_reachable,
    )


@router.post("/sd/automatic1111/progress")
def check_progress() -> Automatic1111CheckProgressResponse:
    return image_generation_service.check_progress()


@router.get("/sd/automatic1111/models")
def get_models() -> Automatic1111GetModelsResponse:
    models = automatic1111_client.get_sd_models()
    return Automatic1111GetModelsResponse(
        models=models,
    )


@router.post("/sd/automatic1111/models/refresh")
def refresh_models() -> Automatic1111GetModelsResponse:
    automatic1111_client.refresh_sd_models()
    models = automatic1111_client.get_sd_models()
    return Automatic1111GetModelsResponse(
        models=models,
    )


@router.post("/sd/automatic1111/models/current")
def change_model(request: Automatic1111ChangeCurrentModelResponse):
    automatic1111_client.change_current_sd_model(request.model_hash)


@router.get("/sd/automatic1111/samplers")
def get_samplers() -> Automatic1111GetSamplersResponse:
    samplers = automatic1111_client.get_samplers()
    return Automatic1111GetSamplersResponse(
        samplers=samplers,
    )


@router.get("/sd/automatic1111/loras")
def get_loras():
    return {"loras": automatic1111_client.get_loras()}


@router.post("/sd/automatic1111/loras/refresh")
def refresh_loras():
    automatic1111_client.refresh_loras()
    return {"loras": automatic1111_client.get_loras()}


@router.get("/sd/automatic1111/controlnet/status")
def get_controlnet_status() -> Automatic1111ControlNetStatusResponse:
    return Automatic1111ControlNetStatusResponse(**automatic1111_client.get_controlnet_status())


@router.get("/sd/automatic1111/controlnet/models")
def get_controlnet_models():
    status = automatic1111_client.get_controlnet_status()
    return {"available": status["available"], "models": status["models"], "reason": status.get("reason")}


@router.get("/sd/automatic1111/controlnet/modules")
def get_controlnet_modules():
    status = automatic1111_client.get_controlnet_status()
    return {"available": status["available"], "modules": status["modules"], "reason": status.get("reason")}


@router.post("/sd/automatic1111/controlnet/refresh")
def refresh_controlnet() -> Automatic1111ControlNetStatusResponse:
    return Automatic1111ControlNetStatusResponse(**automatic1111_client.refresh_controlnet())


@router.post("/sd/automatic1111/controlnet/install")
def install_controlnet_extension(request: ControlNetInstallRequest):
    try:
        return install_controlnet(request.automatic1111_root, request.replace_existing)
    except ValueError as error:
        return {"status": "invalid", "message": str(error)}
    except OSError as error:
        return {"status": "error", "message": f"ControlNet installation failed: {error}"}
    except RuntimeError as error:
        return {"status": "error", "message": str(error)}


@router.post("/sd/automatic1111/controlnet/install")
def install_controlnet_extension(request: ControlNetInstallRequest):
    try:
        return install_controlnet(request.automatic1111_root, request.replace_existing)
    except ValueError as error:
        return {"status": "invalid", "message": str(error)}
    except OSError as error:
        return {"status": "error", "message": f"ControlNet installation failed: {error}"}


@router.post("/sd/automatic1111/generate/stop")
def stop_generation():
    # Since image generation is a blocking request, making this call should stop that request asap and make it
    # return to front-end
    image_generation_service.stop_image_generation()


@router.post("/sd/automatic1111/generate/process")
def process_enqueued_request():
    """
    This will start generating images based on the enqueued request
    """
    image_generation_service.process_enqueued_generate_images_request()


@router.post("/sd/automatic1111/generate/txt2img")
def generate_txt2img(request: Automatic1111GenerateTxt2ImgRequest):
    request.inference_type = "txt2img"
    document_width = request.document_width
    document_height = request.document_height
    controlnet_source, controlnet_source_area = _read_controlnet_source(request, document_width, document_height)

    selection_area = adjust_selection_area(
        user_input_selection_area=request.selection_area,
        source_image_area=controlnet_source_area,
        mask_image_area=None,
        document_width=document_width,
        document_height=document_height,
    )
    scaled_width, scaled_height, scale_factor = get_scale_factor(selection_area)

    run_configurations = run_configuration_provider.build_txt2img_run_configurations(
        image_count=request.image_count,
        requested_cfg_scale=request.cfg_scale,
    )

    # We are only enqueuing request so that backend can track the current progress as busy
    # Another request would kick off the generation process
    image_generation_service.enqueue_batch_generate_images_request(
        Automatic1111BatchGenerateImageRequest(
            request=request,
            run_configurations=run_configurations,
            document_width=document_width,
            document_height=document_height,
            generate_image_width=scaled_width,
            generate_image_height=scaled_height,
            scale_factor=scale_factor,
            selection_area=selection_area,
            controlnet_source_image_cropped_to_selection=(
                extract_image_from_selection_and_scale(controlnet_source, selection_area)[0]
                if controlnet_source is not None else None
            ),
        )
    )


@router.post("/sd/automatic1111/generate/img2img")
def generate_img2img(request: Automatic1111GenerateImg2ImgRequest):
    request.inference_type = "img2img"
    document_width = request.document_width
    document_height = request.document_height
    controlnet_source, controlnet_source_area = _read_controlnet_source(request, document_width, document_height)

    source_image, source_image_area = read_image_as_full_sized_layer(
        document_width=document_width,
        document_height=document_height,
        image_file_path=request.source_image_path,
        image_x=request.source_image_x,
        image_y=request.source_image_y,
        layer_description='picked source layer',
    )
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_source_input.png"), source_image)

    selection_area = adjust_selection_area(
        user_input_selection_area=request.selection_area,
        source_image_area=source_image_area,
        mask_image_area=None,
        document_width=document_width,
        document_height=document_height,
    )
    print(f"Inpaint selection area: {selection_area}")

    source_image_cropped_scaled, scale_factor = extract_image_from_selection_and_scale(source_image, selection_area)
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_source_cropped_scaled.png"), source_image_cropped_scaled)

    run_configurations = run_configuration_provider.build_img2img_run_configurations(
        image_count=request.image_count,
        requested_cfg_scale=request.cfg_scale,
        requested_denoising_strength=request.denoising_strength,
    )

    image_generation_service.enqueue_batch_generate_images_request(
        Automatic1111BatchGenerateImageRequest(
            request=request,
            run_configurations=run_configurations,
            document_width=document_width,
            document_height=document_height,
            generate_image_width=source_image_cropped_scaled.shape[1],
            generate_image_height=source_image_cropped_scaled.shape[0],
            selection_area=selection_area,
            scale_factor=scale_factor,
            source_image_cropped_to_selection=source_image_cropped_scaled,
            controlnet_source_image_cropped_to_selection=(
                extract_image_from_selection_and_scale(controlnet_source, selection_area)[0]
                if controlnet_source is not None else None
            ),
        )
    )


@router.post("/sd/automatic1111/generate/inpaint")
def generate_inpaint(request: Automatic1111GenerateInpaintRequest):
    request.inference_type = "inpaint"
    document_width = request.document_width
    document_height = request.document_height
    controlnet_source, controlnet_source_area = _read_controlnet_source(request, document_width, document_height)

    source_image, source_image_area = read_image_as_full_sized_layer(
        document_width=document_width,
        document_height=document_height,
        image_file_path=request.source_image_path,
        image_x=request.source_image_x,
        image_y=request.source_image_y,
        layer_description='picked source layer',
    )
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_source_input.png"), source_image)

    user_input_mask_image, mask_image_area = read_image_as_full_sized_layer(
        document_width=document_width,
        document_height=document_height,
        image_file_path=request.mask_image_path,
        image_x=request.mask_image_x,
        image_y=request.mask_image_y,
        layer_description='mask layer',
    )
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_mask_input.png"), user_input_mask_image)

    selection_area = adjust_selection_area(
        user_input_selection_area=request.selection_area,
        source_image_area=source_image_area,
        mask_image_area=mask_image_area,
        document_width=document_width,
        document_height=document_height,
    )

    source_image_cropped_scaled, scale_factor = extract_image_from_selection_and_scale(source_image, selection_area)
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_source_cropped_scaled.png"), source_image_cropped_scaled)

    mask_image_cropped_scaled, _ = extract_image_from_selection_and_scale(user_input_mask_image, selection_area)
    mask_image_cropped_scaled_converted = convert_mask_image(mask_image_cropped_scaled)
    print(f"Inpaint generation size: {source_image_cropped_scaled.shape[1]}x{source_image_cropped_scaled.shape[0]}, mask size: {mask_image_cropped_scaled_converted.shape[1]}x{mask_image_cropped_scaled_converted.shape[0]}, result paste area: {selection_area}")
    # cv2.imwrite(str(OUTPUT_FOLDER_PATH / f"debug_{request.request_id}_mask_cropped_scaled.png"), mask_image_cropped_scaled_converted)

    run_configurations = run_configuration_provider.build_img2img_run_configurations(
        image_count=request.image_count,
        requested_cfg_scale=request.cfg_scale,
        requested_denoising_strength=request.denoising_strength,
    )

    image_generation_service.enqueue_batch_generate_images_request(
        Automatic1111BatchGenerateImageRequest(
            request=request,
            run_configurations=run_configurations,
            document_width=document_width,
            document_height=document_height,
            generate_image_width=source_image_cropped_scaled.shape[1],
            generate_image_height=source_image_cropped_scaled.shape[0],
            selection_area=selection_area,
            scale_factor=scale_factor,
            source_image_cropped_to_selection=source_image_cropped_scaled,
            controlnet_source_image_cropped_to_selection=(
                extract_image_from_selection_and_scale(controlnet_source, selection_area)[0]
                if controlnet_source is not None else None
            ),
            mask_image_cropped_to_selection=mask_image_cropped_scaled_converted,
            mask_blur=request.mask_blur,
            masked_content=request.masked_content,
        )
    )
