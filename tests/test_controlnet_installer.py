import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALLER = REPO_ROOT / "install-controlnet.bat"
FROZEN_SHA = "56cec5b2958edf3b1807b7e7b2b1b5186dbd2f81"


def run_installer(root, confirmation=None):
    input_text = str(root) + "\n"
    if confirmation is not None:
        input_text += confirmation + "\n"
    return subprocess.run(
        ["cmd.exe", "/d", "/c", "call", str(INSTALLER)],
        cwd=REPO_ROOT,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )


class ControlNetInstallerTests(unittest.TestCase):
    def make_a1111_root(self, temporary_directory):
        root = Path(temporary_directory) / "a1111"
        (root / "modules").mkdir(parents=True)
        (root / "extensions").mkdir()
        (root / "webui-user.bat").write_text("@echo off\n", encoding="utf-8")
        (root / "webui.py").write_text("# test fixture\n", encoding="utf-8")
        return root

    def test_valid_root_installs_frozen_snapshot_without_network(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = self.make_a1111_root(temporary_directory)
            result = run_installer(root)
            target = root / "extensions" / "sd-webui-controlnet"
            marker = target / "ANZOTH_VENDOR_MARKER.txt"

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(marker.is_file())
            self.assertIn("upstream_commit=" + FROZEN_SHA, marker.read_text(encoding="utf-8"))
            self.assertIn("frozen controlnet snapshot installed", result.stdout.lower())

    def test_invalid_root_is_rejected_without_changes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "not-a1111"
            root.mkdir()
            result = run_installer(root)

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "extensions").exists())

    def test_exact_frozen_install_is_detected_without_replacement(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = self.make_a1111_root(temporary_directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            marker = target / "ANZOTH_VENDOR_MARKER.txt"
            marker.write_text("upstream_commit=" + FROZEN_SHA + "\n", encoding="utf-8")
            sentinel = target / "user-sentinel.txt"
            sentinel.write_text("preserve", encoding="utf-8")

            result = run_installer(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("already installed", result.stdout.lower())
            self.assertTrue(sentinel.is_file())
            self.assertFalse(list((root / "extensions").glob("sd-webui-controlnet.backup-*")))

    def test_conflicting_install_requires_confirmation_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = self.make_a1111_root(temporary_directory)
            target = root / "extensions" / "sd-webui-controlnet"
            target.mkdir()
            marker = target / "ANZOTH_VENDOR_MARKER.txt"
            marker.write_text("upstream_commit=other\n", encoding="utf-8")
            sentinel = target / "user-sentinel.txt"
            sentinel.write_text("preserve", encoding="utf-8")

            result = run_installer(root, "N")

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertTrue(sentinel.is_file())
            self.assertEqual(marker.read_text(encoding="utf-8"), "upstream_commit=other\n")
            self.assertFalse(list((root / "extensions").glob("sd-webui-controlnet.backup-*")))

    def test_installer_has_no_fixed_local_path_or_network_commands(self):
        text = INSTALLER.read_text(encoding="utf-8")
        self.assertNotIn(r"C:\\ai\\a1111", text)
        self.assertNotIn("git clone", text.lower())
        self.assertNotIn("git pull", text.lower())
        self.assertNotIn("latest-version", text.lower())


if __name__ == "__main__":
    unittest.main()
