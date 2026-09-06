import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from local_server.automatic1111.controlnet_installer import (
    FROZEN_CONTROLNET_SHA,
    install_controlnet,
)


class ControlNetInstallFlowTests(unittest.TestCase):
    def make_root(self, directory):
        root = Path(directory) / "a1111"
        (root / "modules").mkdir(parents=True)
        (root / "extensions").mkdir()
        (root / "webui.py").write_text("# fixture\n", encoding="utf-8")
        (root / "webui-user.bat").write_text("@echo off\n", encoding="utf-8")
        return root

    def test_invalid_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                install_controlnet(str(Path(directory)))

    def test_conflict_is_reported_without_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            (target / "user-file.txt").write_text("keep", encoding="utf-8")
            with patch("local_server.automatic1111.controlnet_installer._copy_snapshot") as copy:
                result = install_controlnet(str(root))
            self.assertEqual(result["status"], "conflict")
            copy.assert_not_called()
            self.assertTrue((target / "user-file.txt").is_file())

    def test_cancelled_conflict_makes_no_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            sentinel = target / "user-file.txt"
            sentinel.write_text("keep", encoding="utf-8")
            result = install_controlnet(str(root), replace_existing=False)
            self.assertEqual(result["status"], "conflict")
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
            self.assertEqual(list((root / "extensions").glob("*.backup-*")), [])

    def test_confirmed_conflict_preserves_backup_and_installs_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            (target / "user-file.txt").write_text("keep", encoding="utf-8")

            def fake_copy(source, destination):
                destination.mkdir()
                (destination / "ANZOTH_VENDOR_MARKER.txt").write_text(
                    f"upstream_commit={FROZEN_CONTROLNET_SHA}\n", encoding="utf-8"
                )

            with patch("local_server.automatic1111.controlnet_installer._copy_snapshot", side_effect=fake_copy):
                result = install_controlnet(str(root), replace_existing=True)
            self.assertEqual(result["status"], "installed")
            self.assertTrue(Path(result["backup_path"]).is_dir())
            self.assertEqual((Path(result["backup_path"]) / "user-file.txt").read_text(encoding="utf-8"), "keep")
            self.assertIn(FROZEN_CONTROLNET_SHA, (target / "ANZOTH_VENDOR_MARKER.txt").read_text(encoding="utf-8"))

    def test_exact_install_reports_already_installed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            (target / "ANZOTH_VENDOR_MARKER.txt").write_text(
                f"upstream_commit={FROZEN_CONTROLNET_SHA}\n", encoding="utf-8"
            )
            with patch("local_server.automatic1111.controlnet_installer._copy_snapshot") as copy:
                result = install_controlnet(str(root))
            self.assertEqual(result["status"], "already_installed")
            copy.assert_not_called()

    def test_install_source_is_fixed_and_restart_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)

            def fake_copy(source, destination):
                self.assertIn("third_party\\sd-webui-controlnet", str(source))
                destination.mkdir()
                (destination / "ANZOTH_VENDOR_MARKER.txt").write_text(
                    f"upstream_commit={FROZEN_CONTROLNET_SHA}\n", encoding="utf-8"
                )

            with patch("local_server.automatic1111.controlnet_installer._copy_snapshot", side_effect=fake_copy):
                result = install_controlnet(str(root))
            self.assertEqual(result["status"], "installed")
            self.assertIn("Restart Automatic1111", result["message"])


if __name__ == "__main__":
    unittest.main()
