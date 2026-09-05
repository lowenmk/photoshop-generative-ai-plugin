"""Run the development-only Photoshop Phase 1 regression suite."""

import sys
from pathlib import Path

import requests
from PIL import Image, ImageDraw


BASE_URL = "http://127.0.0.1:8088/dev/photoshop"
REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_NAME = "easysd-harness-fixture.png"
FIXTURE_PATH = REPO_ROOT / "dist" / "output" / FIXTURE_NAME


def call(method, path, **kwargs):
    response = requests.request(method, BASE_URL + path, timeout=20, **kwargs)
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


def run(label, function):
    try:
        function()
        print(f"[PASS] {label}")
        return True
    except Exception as error:
        print(f"[FAIL] {label}: {error}")
        return False


def main():
    make_fixture()
    tests = [
        ("01 Health", test_health),
        ("02 State inspection", test_state),
        ("03-10 Document and selection lifecycle", test_document_and_selection_lifecycle),
        ("11 New Layer", test_new_layer),
        ("12 Replace Area", test_replace_area),
        ("13 Replace group reuse", test_replace_group_reuse),
        ("14 Open as Image", test_open_as_image),
        ("15 Forced failure cleanup", test_forced_cleanup_failure),
    ]
    passed = all(run(label, function) for label, function in tests)
    print("PHASE 1 PHOTOSHOP REGRESSION: " + ("PASS" if passed else "FAIL"))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
