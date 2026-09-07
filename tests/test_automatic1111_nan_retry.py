import json
import unittest
from unittest.mock import patch

import requests

from local_server.automatic1111.client import (
    Automatic1111Client,
    Automatic1111ClientGenerateImageRequest,
)
from automatic1111.models import ControlNetUnit


def successful_response(seed=123):
    return {
        "images": ["encoded-image"],
        "info": json.dumps({
            "all_seeds": [seed],
            "all_subseeds": [456],
            "subseed_strength": 0,
            "cfg_scale": 5,
            "denoising_strength": 0.5,
            "sd_model_hash": "model-hash",
            "sampler_name": "Euler",
            "steps": 20,
        }),
    }


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.text = json.dumps(body) if isinstance(body, dict) else str(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


def request_fixture(controlnet_units=None):
    return Automatic1111ClientGenerateImageRequest(
        init_images_base64=["source-image"],
        mask_base64="mask-image",
        width=968,
        height=512,
        prompt="up close blue eyeball",
        n_iter=1,
        negative_prompt="",
        cfg_scale=5,
        seed=1162295030,
        sampler_index="DPM++ SDE",
        steps=37,
        restore_faces=False,
        denoising_strength=0.49,
        mask_blur=12,
        masked_content="original",
        controlnet_units=controlnet_units,
    )


class Automatic1111NanRetryTests(unittest.TestCase):
    def test_known_nan_retries_once_and_succeeds(self):
        nan = FakeResponse(500, {
            "error": "NansException",
            "errors": "A tensor with NaNs was produced in Unet.",
        })
        success = FakeResponse(200, successful_response())
        with patch("local_server.automatic1111.client.requests.post", side_effect=[nan, success]) as post:
            result = Automatic1111Client().generate_image(request_fixture())

        self.assertEqual(result.images_base64, ["encoded-image"])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[0].kwargs["json"], post.call_args_list[1].kwargs["json"])

    def test_known_nan_retry_failure_is_returned_without_a_third_attempt(self):
        nan = FakeResponse(500, {
            "error": "NansException",
            "errors": "A tensor with NaNs was produced in Unet.",
        })
        with patch("local_server.automatic1111.client.requests.post", side_effect=[nan, nan]) as post:
            with self.assertRaises(requests.HTTPError):
                Automatic1111Client().generate_image(request_fixture())

        self.assertEqual(post.call_count, 2)

    def test_ordinary_http_500_is_not_retried(self):
        failure = FakeResponse(500, {"error": "Invalid mask"})
        with patch("local_server.automatic1111.client.requests.post", return_value=failure) as post:
            with self.assertRaises(requests.HTTPError):
                Automatic1111Client().generate_image(request_fixture())

        post.assert_called_once()

    def test_successful_first_attempt_is_not_retried(self):
        success = FakeResponse(200, successful_response())
        with patch("local_server.automatic1111.client.requests.post", return_value=success) as post:
            Automatic1111Client().generate_image(request_fixture())

        post.assert_called_once()

    def test_retry_preserves_seed_and_controlnet_payload(self):
        unit = ControlNetUnit(
            enabled=True,
            model="control-model",
            module="canny",
            weight=0.8,
            input_image="control-image",
        )
        nan = FakeResponse(500, {
            "error": "NansException",
            "errors": "A tensor with NaNs was produced in Unet.",
        })
        success = FakeResponse(200, successful_response(seed=1162295030))
        with patch("local_server.automatic1111.client.requests.post", side_effect=[nan, success]) as post:
            Automatic1111Client().generate_image(request_fixture([unit]))

        first_payload = post.call_args_list[0].kwargs["json"]
        retry_payload = post.call_args_list[1].kwargs["json"]
        self.assertEqual(first_payload, retry_payload)
        self.assertEqual(first_payload["seed"], 1162295030)
        self.assertEqual(
            first_payload["alwayson_scripts"]["ControlNet"]["args"][0]["image"],
            "control-image",
        )

    def test_nan_signature_requires_both_known_markers(self):
        self.assertFalse(Automatic1111Client._is_known_nan_response(
            FakeResponse(500, {"error": "NansException", "errors": "unrelated"})
        ))
        self.assertFalse(Automatic1111Client._is_known_nan_response(
            FakeResponse(200, {"error": "NansException", "errors": "A tensor with NaNs was produced in Unet."})
        ))


if __name__ == "__main__":
    unittest.main()
