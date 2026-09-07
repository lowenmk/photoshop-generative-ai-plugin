import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TestLauncherTests(unittest.TestCase):
    def test_start_test_checks_port_before_launching_bridge(self):
        source = (ROOT / "start-test.bat").read_text(encoding="utf-8")

        self.assertIn("Get-NetTCPConnection", source)
        self.assertIn("-LocalPort 8088", source)
        self.assertIn("Existing bridge detected", source)
        self.assertIn("exit /b 1", source)
        self.assertNotIn("taskkill", source.lower())


if __name__ == "__main__":
    unittest.main()
