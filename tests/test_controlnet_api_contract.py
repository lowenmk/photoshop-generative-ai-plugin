import unittest

from local_server.automatic1111.client import Automatic1111Client


class ControlNetApiContractTests(unittest.TestCase):
    def test_numeric_version_object_is_normalized_without_stringifying_object(self):
        self.assertEqual(Automatic1111Client._normalize_controlnet_version({"version": 3}), "3")

    def test_string_version_is_preserved(self):
        self.assertEqual(Automatic1111Client._normalize_controlnet_version("1.1.455"), "1.1.455")


if __name__ == "__main__":
    unittest.main()
