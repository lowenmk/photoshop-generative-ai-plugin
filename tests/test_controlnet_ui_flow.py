import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ControlNetUiFlowTests(unittest.TestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_unavailable_state_uses_install_link_and_hides_controls(self):
        source = self.read("src/components/tabs/dream/ControlNetControls.jsx")
        self.assertIn(">install controlnet</sp-action-button>", source)
        self.assertIn("status?.reason?.toLowerCase().includes(\"not installed\")", source)
        self.assertIn("!unavailable", source)

    def test_modal_supports_manual_entry_and_native_browse(self):
        modal = self.read("src/components/modals/ControlNetInstallModal.jsx")
        photoshop_app = self.read("src/photoshop/PhotoshopApp.js")
        self.assertIn("Automatic1111 Folder", modal)
        self.assertIn("Browse...", modal)
        self.assertIn("setRoot(selectedPath)", modal)
        self.assertIn("fs.getFolder()", photoshop_app)

    def test_install_endpoint_has_no_source_path_parameter(self):
        api = self.read("local_server/automatic1111/api.py")
        installer = self.read("local_server/automatic1111/controlnet_installer.py")
        self.assertIn("/sd/automatic1111/controlnet/install", api)
        self.assertIn("get_vendored_controlnet_root", installer)
        self.assertNotIn("source_path", api)

    def test_manifest_was_not_changed(self):
        manifest = self.read("plugin/manifest.json")
        self.assertIn('"manifestVersion": 4', manifest)


if __name__ == "__main__":
    unittest.main()
