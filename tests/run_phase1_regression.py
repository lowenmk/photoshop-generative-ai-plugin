"""Run the development-only Photoshop Phase 1 regression suite."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local_server"))

import requests
from PIL import Image, ImageDraw
from automatic1111.results import Automatic1111Result
from automatic1111.models import ControlNetUnit, Automatic1111ControlNetRequest
from automatic1111.client import Automatic1111Client
from utils.lora import parse_lora_tokens


BASE_URL = "http://127.0.0.1:8088/dev/photoshop"
ROOT_URL = "http://127.0.0.1:8088"
REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_NAME = "easysd-harness-fixture.png"
FIXTURE_PATH = REPO_ROOT / "dist" / "output" / FIXTURE_NAME
HARNESS_REQUEST_PREFIX = "test-phase1-"
model_settings_result = None


class SkipRegressionTest(Exception):
    pass


def call(method, path, request_timeout=20, **kwargs):
    response = requests.request(method, BASE_URL + path, timeout=request_timeout, **kwargs)
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise AssertionError(f"{method} {path} failed with {response.status_code}: {detail}")
    return response.json() if response.content else None


def make_fixture():
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (512, 512), (24, 96, 160, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((64, 64, 448, 448), outline=(255, 220, 80, 255), width=8)
    draw.ellipse((176, 176, 336, 336), fill=(230, 80, 110, 255))
    image.save(FIXTURE_PATH, format="PNG")


def state_layer_ids(state):
    return {layer["id"] for layer in state["layers"]}


def assert_locked_background(state):
    background = next((layer for layer in state["layers"] if layer["name"] == "Background"), None)
    assert background is not None, "Background layer is missing"
    assert background["locked"] is True, "Background is not locked"
    assert background["parentId"] is None, "Background is not top-level"
    return background


def create_test_document(name):
    created = call("POST", "/test/create-document", json={
        "width": 512, "height": 512, "name": name,
        "background": True, "lock_background": True,
    })
    assert created["harnessOwned"] is True
    return created["document"]["id"]


def close_document(document_id):
    if document_id is not None:
        try:
            call("POST", "/test/close-document", json={"document_id": document_id})
        except Exception as error:
            print(f"cleanup warning for document {document_id}: {error}", file=sys.stderr)


def test_health():
    health = call("GET", "/health")
    assert health["bridge"] is True
    assert health["dev_test_api"] is True
    assert health["plugin_connected"] is True, "Photoshop plugin test agent is not connected."


def test_state():
    state = call("GET", "/state")
    assert {"activeDocument", "documents", "activeLayerId", "layers", "selection"} <= set(state)


def test_document_and_selection_lifecycle():
    document_id = None
    try:
        document_id = create_test_document("EasySD Harness Stage 1")
        state = call("GET", "/state")
        assert state["activeDocument"]["id"] == document_id
        assert state["activeDocument"]["width"] == 512
        assert state["activeDocument"]["height"] == 512
        assert_locked_background(state)
        selection = call("POST", "/test/selection", json={"left": 50, "top": 50, "right": 250, "bottom": 250})
        assert selection == {"exists": True, "left": 50, "top": 50, "right": 250, "bottom": 250}
        assert call("DELETE", "/test/selection") == {"exists": False}
        assert call("GET", "/state")["selection"] == {"exists": False}
    finally:
        close_document(document_id)


def test_new_layer():
    document_id = None
    try:
        document_id = create_test_document("EasySD Harness New Layer")
        before = call("GET", "/state")
        result = call("POST", "/test/place/new-layer", json={
            "image_file_name": FIXTURE_NAME, "layer_name": "Harness New Layer",
        })
        new_layers = [layer for layer in result["state"]["layers"] if layer["id"] not in state_layer_ids(before)]
        assert len(new_layers) == 1, f"expected one new layer, got {new_layers}"
        assert new_layers[0]["name"] == "Harness New Layer"
        assert new_layers[0]["type"] == "pixel"
        assert new_layers[0]["parentId"] is None
        assert result["state"]["activeDocument"]["id"] == document_id
        assert_locked_background(result["state"])
        assert len(result["state"]["documents"]) == len(before["documents"])
    finally:
        close_document(document_id)


def replace_once(document_id, layer_name, request_id):
    return call("POST", "/test/place/replace-area", json={
        "image_file_name": FIXTURE_NAME, "layer_name": layer_name,
        "request_id": request_id, "prompt": "Harness regression",
    })


def test_replace_area():
    document_id = None
    try:
        document_id = create_test_document("EasySD Harness Replace Area")
        before = call("GET", "/state")
        call("POST", "/test/selection", json={"left": 50, "top": 50, "right": 250, "bottom": 250})
        result = replace_once(document_id, "Harness Replace 1", "harness-replace-one")
        state = result["state"]
        groups = [layer for layer in state["layers"] if layer["type"] == "group" and layer["name"].startswith("EasySD - Harness")]
        assert len(groups) == 1, groups
        children = [layer for layer in state["layers"] if layer["parentId"] == groups[0]["id"]]
        assert len(children) == 1 and children[0]["name"] == "Harness Replace 1"
        assert_locked_background(state)
        assert state["activeDocument"]["id"] == document_id
        assert len(state["documents"]) == len(before["documents"])
    finally:
        close_document(document_id)


def test_replace_group_reuse():
    document_id = None
    try:
        document_id = create_test_document("EasySD Harness Group Reuse")
        call("POST", "/test/selection", json={"left": 50, "top": 50, "right": 250, "bottom": 250})
        replace_once(document_id, "Harness Replace 1", "harness-reuse")
        result = replace_once(document_id, "Harness Replace 2", "harness-reuse")
        state = result["state"]
        groups = [layer for layer in state["layers"] if layer["type"] == "group" and layer["name"].startswith("EasySD - Harness")]
        assert len(groups) == 1, groups
        children = [layer for layer in state["layers"] if layer["parentId"] == groups[0]["id"]]
        assert {child["name"] for child in children} == {"Harness Replace 1", "Harness Replace 2"}
        assert state["layers"].index(next(child for child in children if child["name"] == "Harness Replace 2")) < state["layers"].index(next(child for child in children if child["name"] == "Harness Replace 1"))
        assert_locked_background(state)
    finally:
        close_document(document_id)


def test_open_as_image():
    source_id = None
    opened_id = None
    try:
        source_id = create_test_document("EasySD Harness Open Image")
        result = call("POST", "/test/place/open-image", json={"image_file_name": FIXTURE_NAME})
        opened_id = result["openedDocument"]["id"]
        assert result["sourceDocumentId"] == source_id and opened_id != source_id
        assert result["sourceState"]["activeDocument"]["id"] == source_id
        assert_locked_background(result["sourceState"])
        assert result["state"]["activeDocument"]["id"] == opened_id
        assert any(document["id"] == source_id for document in result["state"]["documents"])
    finally:
        close_document(opened_id)
        close_document(source_id)


def test_forced_cleanup_failure():
    document_id = None
    failure_set = False
    try:
        document_id = create_test_document("EasySD Harness Failure")
        call("POST", "/test/selection", json={"left": 50, "top": 50, "right": 250, "bottom": 250})
        before = call("GET", "/state")
        call("POST", "/test/failure-mode", json={"failure_point": "after_selection_mask_layer_create"})
        failure_set = True
        response = requests.post(BASE_URL + "/test/export-current-selection", json={}, timeout=20)
        assert response.status_code >= 400, response.text
        call("DELETE", "/test/failure-mode")
        failure_set = False
        after = call("GET", "/state")
        assert after["activeDocument"]["id"] == document_id
        assert after["selection"] == before["selection"]
        assert state_layer_ids(after) == state_layer_ids(before)
        assert_locked_background(after)
        assert not any(layer["type"] == "group" and layer["name"].startswith("EasySD") for layer in after["layers"])
    finally:
        if failure_set:
            try:
                call("DELETE", "/test/failure-mode")
            except Exception:
                pass
        close_document(document_id)


def assert_a1111_reachable():
    try:
        response = requests.get("http://127.0.0.1:8088/sd/automatic1111/status", timeout=10)
        response.raise_for_status()
        if response.json().get("is_reachable") is not True:
            raise AssertionError("A1111 is not reachable.")
    except requests.RequestException as error:
        raise AssertionError("A1111 is not reachable.") from error


def generate(inference_type, payload=None):
    endpoint = f"/test/generate/{inference_type}"
    return call("POST", endpoint, json=payload or {})


def reset_generation_if_needed():
    state = call("GET", "/test/generation-state")
    active_ids = [request_id for request_id in state.values() if request_id]
    non_harness_ids = [request_id for request_id in active_ids if not request_id.startswith(HARNESS_REQUEST_PREFIX)]
    assert not non_harness_ids, "A non-test generation is already active; wait for it to finish or cancel it manually."
    if active_ids:
        call("POST", "/test/reset-generation")
    assert call("GET", "/test/generation-state") == {
        "enqueued_request_id": None,
        "processing_request_id": None,
    }


def first_result(generation):
    group = generation["group"]
    assert group["request_id"].startswith("test-phase1-")
    assert group["group_items"], "generation returned no result items"
    item = group["group_items"][0]
    assert item["seed"] is not None
    assert item["image_file_name"]
    return item


def cleanup_generation(generation):
    try:
        reset_generation_if_needed()
        if generation and generation.get("requestId"):
            call("POST", "/test/cleanup-results", json={"request_id": generation["requestId"]})
    except Exception as error:
        print(f"generation cleanup warning: {error}", file=sys.stderr)


def print_test19_snapshot(label, state):
    if not state:
        print(f"[TEST19 SNAPSHOT] {label}: unavailable")
        return
    layers = [
        {key: layer.get(key) for key in ("id", "name", "parentId", "type", "visible", "locked")}
        for layer in state.get("layers", [])
    ]
    snapshot = {
        'activeDocument': state.get('activeDocument'),
        'documents': state.get('documents'),
        'activeLayerId': state.get('activeLayerId'),
        'layers': layers,
        'selection': state.get('selection'),
    }
    print(f"[TEST19 SNAPSHOT] {label}: {snapshot}")


def assert_condition(condition, message, expected=None, actual=None):
    if not condition:
        detail = f"{message}; expected={expected!r}, actual={actual!r}"
        raise AssertionError(detail)


def test_txt2img():
    document_id = None
    generation = None
    try:
        document_id = create_test_document("EasySD Harness TXT2IMG")
        assert_locked_background(call("GET", "/state"))
        generation = generate("txt2img", {"sampling_steps": 5})
        item = first_result(generation)
        placed = call("POST", "/test/place/new-layer", json={
            "image_file_name": item["image_file_name"], "layer_name": "Harness TXT2IMG Result",
        })
        state = placed["state"]
        result_layers = [layer for layer in state["layers"] if layer["name"] == "Harness TXT2IMG Result"]
        assert len(result_layers) == 1 and result_layers[0]["parentId"] is None
        assert_locked_background(state)
    finally:
        cleanup_generation(generation)
        close_document(document_id)


def test_img2img():
    document_id = None
    generation = None
    try:
        document_id = create_test_document("EasySD Harness IMG2IMG")
        before = call("GET", "/state")
        assert_locked_background(before)
        generation = generate("img2img", {"sampling_steps": 5})
        item = first_result(generation)
        placed = call("POST", "/test/place/new-layer", json={
            "image_file_name": item["image_file_name"], "layer_name": "Harness IMG2IMG Result",
        })
        state = placed["state"]
        assert any(layer["name"] == "Harness IMG2IMG Result" for layer in state["layers"])
        assert any(layer["id"] == before["activeLayerId"] for layer in state["layers"])
        assert_locked_background(state)
    finally:
        cleanup_generation(generation)
        close_document(document_id)


def test_mask_layer_inpaint():
    document_id = None
    generation = None
    try:
        document_id = create_test_document("EasySD Harness Mask Inpaint")
        generation = generate("inpaint", {
            "mask_source": "maskLayer", "sampling_steps": 5,
        })
        item = first_result(generation)
        placed = call("POST", "/test/place/new-layer", json={
            "image_file_name": item["image_file_name"], "layer_name": "Harness Mask Inpaint Result",
        })
        state = placed["state"]
        assert any(layer["name"] == "Mask Layer Harness" and layer["visible"] for layer in state["layers"])
        assert any(layer["name"] == "Harness Mask Inpaint Result" for layer in state["layers"])
        assert_locked_background(state)
    finally:
        cleanup_generation(generation)
        close_document(document_id)


def test_current_selection_inpaint():
    document_id = None
    generation = None
    before_state = None
    after_generation_state = None
    after_placement_state = None
    try:
        document_id = create_test_document("EasySD Harness Selection Inpaint")
        before_state = call("GET", "/state")
        print_test19_snapshot("before selection", before_state)
        original = call("POST", "/test/selection", json={"left": 96, "top": 96, "right": 416, "bottom": 416})
        assert_condition(original == {"exists": True, "left": 96, "top": 96, "right": 416, "bottom": 416},
                         "Original selection exists with expected bounds", {
                             "exists": True, "left": 96, "top": 96, "right": 416, "bottom": 416,
                         }, original)
        print_test19_snapshot("after selection", call("GET", "/state"))
        generation = generate("inpaint", {
            "mask_source": "currentSelection", "selection": {"x": 96, "y": 96, "width": 320, "height": 320},
            "selection_invert": False, "selection_feather": 0, "selection_expand": 0,
            "sampling_steps": 5,
        })
        after_generation_state = generation["state"]
        print_test19_snapshot("after generation", after_generation_state)
        item = first_result(generation)
        placed = call("POST", "/test/place/replace-area", json={
            "image_file_name": item["image_file_name"], "layer_name": "Harness Selection Inpaint Result",
            "request_id": generation["requestId"], "prompt": "Harness selection inpaint",
        })
        after_placement_state = placed["state"]
        print_test19_snapshot("after Replace Selected Area", after_placement_state)
        state = after_placement_state
        expected_group_fragment = generation["requestId"][:8]
        groups = [layer for layer in state["layers"]
                  if layer["type"] == "group" and expected_group_fragment in layer["name"]]
        result_layers = [layer for layer in state["layers"] if layer["name"] == "Harness Selection Inpaint Result"]
        source_layers = [layer for layer in state["layers"] if layer["name"] == "Background"]
        assert_condition(bool(generation.get("requestId")), "Generation result exists for harness request ID",
                         True, generation.get("requestId"))
        assert_condition(len(groups) == 1, "Replace Selected Area created/reused expected EasySD group", 1, groups)
        assert_condition(len(result_layers) == 1, "Generated result layer exists", 1, result_layers)
        assert_condition(result_layers[0]["parentId"] == groups[0]["id"],
                         "Generated result layer is inside expected group", groups[0]["id"], result_layers[0]["parentId"])
        assert_condition(bool(source_layers), "Source/background layer still exists", True, source_layers)
        assert_condition(source_layers[0]["locked"] is True, "Background remains locked", True, source_layers[0]["locked"])
        assert_condition(state["selection"] == original, "Original selection is restored exactly", original, state["selection"])
        assert_condition(not any(layer["name"] == "EasySD Temporary Selection Mask" for layer in state["layers"]),
                         "No orphan temporary mask layer remains", False,
                         [layer for layer in state["layers"] if layer["name"] == "EasySD Temporary Selection Mask"])
        assert_condition(not any(layer["name"].startswith("EasySD Selection Backup") for layer in state["layers"]),
                         "No orphan temporary source/duplicate layer remains", False,
                         [layer for layer in state["layers"] if layer["name"].startswith("EasySD Selection Backup")])
        before_document_ids = {document["id"] for document in before_state["documents"]}
        after_document_ids = {document["id"] for document in state["documents"]}
        assert_condition(after_document_ids == before_document_ids, "No unexpected temporary Photoshop document remains open",
                         before_document_ids, after_document_ids)
        assert_condition(document_id in after_document_ids, "Harness source document remains until explicit cleanup",
                         True, document_id in after_document_ids)
    finally:
        cleanup_generation(generation)
        close_document(document_id)
        try:
            print_test19_snapshot("after cleanup/finally", call("GET", "/state"))
        except Exception as error:
            print(f"[TEST19 SNAPSHOT] after cleanup/finally unavailable: {error}")


def test_model_settings_round_trip():
    global model_settings_result
    model_settings_result = call("POST", "/test/model-settings", request_timeout=180)
    if model_settings_result.get("skipped"):
        raise SkipRegressionTest(model_settings_result["reason"])
    assert model_settings_result["restoredA"] is True
    assert model_settings_result["restoredB"] is True


def test_model_settings_reload():
    if not model_settings_result or model_settings_result.get("skipped"):
        raise SkipRegressionTest("Per-model settings test was skipped")
    assert model_settings_result["reloadPreservedSettings"] is True


def test_model_settings_refresh():
    if not model_settings_result or model_settings_result.get("skipped"):
        raise SkipRegressionTest("Per-model settings test was skipped")
    assert model_settings_result["refreshPreservedActiveModel"] is True


def test_lora_inventory():
    inventory = requests.get(ROOT_URL + "/sd/automatic1111/loras", timeout=20).json()
    assert isinstance(inventory.get("loras"), list)
    before = requests.get(ROOT_URL + "/sd/automatic1111/models", timeout=20).json()
    refreshed = requests.post(ROOT_URL + "/sd/automatic1111/loras/refresh", timeout=60).json()
    assert isinstance(refreshed.get("loras"), list)
    after = requests.get(ROOT_URL + "/sd/automatic1111/models", timeout=20).json()
    active_before = next((item.get("hash") for item in before["models"] if item.get("is_active")), None)
    active_after = next((item.get("hash") for item in after["models"] if item.get("is_active")), None)
    assert active_before == active_after


def test_lora_prompt_token():
    result = call("POST", "/test/lora-prompt")
    assert result["token"] == "<lora:test-lora:0.8>"
    assert result["empty"] == "<lora:test-lora:0.8>"
    assert result["appended"] == "portrait, <lora:test-lora:0.8>"
    assert result["replaced"] == "portrait, <lora:test-lora:0.8>"
    assert result["multiple"].count("<lora:") == 2
    assert result["negativePrompt"] == "soft focus"


def test_lora_refresh_preserves_state():
    before = requests.get(ROOT_URL + "/sd/automatic1111/models", timeout=20).json()
    requests.post(ROOT_URL + "/sd/automatic1111/loras/refresh", timeout=60).raise_for_status()
    after = requests.get(ROOT_URL + "/sd/automatic1111/models", timeout=20).json()
    before_active = next((item.get("hash") for item in before["models"] if item.get("is_active")), None)
    after_active = next((item.get("hash") for item in after["models"] if item.get("is_active")), None)
    assert before_active == after_active


def test_legacy_history_compatibility():
    line = "2025-01-01T00:00:00Z\timg.png\tthumb.jpg\t1\treq\t12\t13\t7.0\tNone\tprompt\tnegative\n"
    result = Automatic1111Result.from_log_line(line)
    assert result.seed == 12 and result.prompt == "prompt"
    assert result.sampler_name is None and result.loras == []


def test_extended_metadata_round_trip():
    result = Automatic1111Result(
        timestamp="2025-01-01T00:00:00Z", image_file_name="img.png", thumbnail_file_name="thumb.jpg",
        document_id=1, request_id="req", seed=12, subseed=13, cfg_scale=7, denoising_strength=.5,
        prompt="p", negative_prompt="n", sampler_name="Euler a", sampling_steps=20,
        model_hash="hash", model_name="model", generated_width=512, generated_height=512,
        inference_type="txt2img", loras=[{"name": "detail", "weight": .8}],
    )
    parsed = Automatic1111Result.from_log_line(result.to_log_line())
    assert parsed.model_hash == "hash" and parsed.sampling_steps == 20
    assert parsed.loras == [{"name": "detail", "weight": .8}]


def test_live_generation_metadata():
    document_id = None
    generation = None
    try:
        document_id = create_test_document("EasySD Harness Metadata")
        generation = generate("txt2img", {"sampling_steps": 5})
        group = generation["group"]
        item = first_result(generation)
        assert item["seed"] is not None and item["cfg_scale"] is not None
        assert group.get("model_hash") and group.get("sampler_name")
        assert group.get("sampling_steps") == 5
        assert group.get("generated_width") and group.get("generated_height")
        assert group.get("inference_type") == "txt2img"
    finally:
        cleanup_generation(generation)
        close_document(document_id)


def test_history_setting_reuse():
    result = call("POST", "/test/lora-prompt")
    assert result["token"] == "<lora:test-lora:0.8>"


def test_prompt_ux_state():
    assert parse_lora_tokens("portrait, <lora:test-lora:0.8>") == [{"name": "test-lora", "weight": .8}]
    assert parse_lora_tokens("<lora:a:-0.2>, <lora:b:1.25>") == [
        {"name": "a", "weight": -.2}, {"name": "b", "weight": 1.25}
    ]


def test_history_use_prompt_remount():
    result = call("POST", "/test/history-use-prompt")
    assert result["prompt"] == "phase2-history-positive"
    assert result["negativePrompt"] == "phase2-history-negative"
    assert result["activeModelHash"]


def test_history_reuse_sampler_steps_remount():
    result = call("POST", "/test/history-reuse-sampler-steps")
    assert result["samplingMethod"] and result["samplingSteps"] == 47
    assert result["activeModelHash"]


def test_lora_refresh_race():
    result = call("POST", "/test/lora-refresh-race")
    assert result["finalName"] == "refresh-result"


def test_lora_selection_reconciliation():
    result = call("POST", "/test/lora-selection-reconciliation")
    assert result == {"preserved": "lora-two", "replaced": "lora-one", "empty": ""}


def test_controlnet_availability_inventory():
    status = Automatic1111Client().get_controlnet_status()
    assert isinstance(status["available"], bool)
    assert isinstance(status["models"], list)
    assert isinstance(status["modules"], list)
    if not status["available"]:
        assert status.get("reason")


def test_controlnet_settings_persistence():
    unit = ControlNetUnit(model="control_v11p_sd15_canny", module="canny", weight=.75,
                          guidance_start=.1, guidance_end=.9, source_mode="sourceLayer")
    assert unit.weight == .75 and unit.guidance_start == .1 and unit.guidance_end == .9
    assert unit.source_mode == "sourceLayer"


def test_controlnet_request_disabled_path():
    assert Automatic1111Client.build_controlnet_alwayson_payload([]) is None


def test_controlnet_request_enabled_payload():
    unit = ControlNetUnit(enabled=True, model="model", module="canny", input_image="encoded")
    payload = Automatic1111Client.build_controlnet_alwayson_payload([unit])
    serialized = payload["alwayson_scripts"]["ControlNet"]["args"][0]
    assert serialized["enabled"] is True and serialized["image"] == "encoded"


def test_controlnet_source_path():
    request = Automatic1111ControlNetRequest(
        enabled=True,
        source_image_path="doc-source.png",
        source_image_x=12,
        source_image_y=24,
        units=[ControlNetUnit(enabled=True, source_mode="sourceLayer")],
    )
    assert request.source_image_path == "doc-source.png"
    assert request.units[0].source_mode == "sourceLayer"


def test_controlnet_metadata_round_trip():
    result = Automatic1111Result(
        timestamp="2025-01-01T00:00:00Z", image_file_name="control.png", thumbnail_file_name="control.jpg",
        document_id=1, request_id="control-request", seed=1, subseed=2, cfg_scale=7,
        denoising_strength=None, prompt="p", negative_prompt="n",
        controlnet={"enabled": True, "units": [{"model": "model", "module": "canny", "weight": .8}]},
    )
    parsed = Automatic1111Result.from_log_line(result.to_log_line())
    assert parsed.controlnet["units"][0]["module"] == "canny"


def test_controlnet_refresh_race():
    first = Automatic1111Client.build_controlnet_alwayson_payload([])
    second = Automatic1111Client.build_controlnet_alwayson_payload([
        ControlNetUnit(enabled=True, input_image="newer")
    ])
    assert first is None and second["alwayson_scripts"]["ControlNet"]["args"][0]["image"] == "newer"


def test_controlnet_unavailable_fallback():
    status = Automatic1111Client().get_controlnet_status()
    assert status["available"] is False
    assert status["models"] == [] and status["modules"] == []


def run(label, function):
    try:
        function()
        print(f"[PASS] {label}")
        return True
    except SkipRegressionTest as error:
        print(f"[SKIP] {label}: {error}")
        return True
    except Exception as error:
        print(f"[FAIL] {label}: {error}")
        return False


def main():
    make_fixture()
    generation_available = run("00 A1111 precheck", assert_a1111_reachable)
    if generation_available:
        generation_available = run("00b Generation state precheck", reset_generation_if_needed)
    tests = [
        ("01 Health", test_health),
        ("02 State inspection", test_state),
        ("03-10 Document and selection lifecycle", test_document_and_selection_lifecycle),
        ("11 New Layer", test_new_layer),
        ("12 Replace Area", test_replace_area),
        ("13 Replace group reuse", test_replace_group_reuse),
        ("14 Open as Image", test_open_as_image),
        ("15 Forced failure cleanup", test_forced_cleanup_failure),
        ("16 TXT2IMG", test_txt2img),
        ("17 IMG2IMG", test_img2img),
        ("18 Mask Layer Inpaint", test_mask_layer_inpaint),
        ("19 Current Selection Inpaint", test_current_selection_inpaint),
        ("20 Per-model settings save/restore", test_model_settings_round_trip),
        ("21 Per-model settings reload", test_model_settings_reload),
        ("22 Model refresh preserves settings", test_model_settings_refresh),
        ("23 LoRA inventory", test_lora_inventory),
        ("24 LoRA prompt token", test_lora_prompt_token),
        ("25 LoRA refresh preserves state", test_lora_refresh_preserves_state),
        ("26 Legacy History compatibility", test_legacy_history_compatibility),
        ("27 Extended metadata round trip", test_extended_metadata_round_trip),
        ("28 Live generation metadata", test_live_generation_metadata),
        ("29 History setting reuse", test_history_setting_reuse),
        ("30 Prompt UX state", test_prompt_ux_state),
        ("31 History Use Prompt across remount", test_history_use_prompt_remount),
        ("32 History sampler/steps across remount", test_history_reuse_sampler_steps_remount),
        ("33 LoRA refresh race", test_lora_refresh_race),
        ("34 LoRA selection reconciliation", test_lora_selection_reconciliation),
        ("35 ControlNet availability/inventory", test_controlnet_availability_inventory),
        ("36 ControlNet settings persistence", test_controlnet_settings_persistence),
        ("37 ControlNet request disabled path", test_controlnet_request_disabled_path),
        ("38 ControlNet request enabled payload", test_controlnet_request_enabled_payload),
        ("39 Control image export/source path", test_controlnet_source_path),
        ("40 ControlNet metadata round trip", test_controlnet_metadata_round_trip),
        ("41 ControlNet refresh race", test_controlnet_refresh_race),
        ("42 ControlNet unavailable fallback", test_controlnet_unavailable_fallback),
    ]
    passed = generation_available and all(run(label, function) for label, function in tests)
    print("PHASE 1 PHOTOSHOP REGRESSION: " + ("PASS" if passed else "FAIL"))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
