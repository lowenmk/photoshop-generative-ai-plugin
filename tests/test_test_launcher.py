import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TestLauncherTests(unittest.TestCase):
    def test_start_test_checks_port_before_launching_bridge(self):
        source = (ROOT / "start-test.bat").read_text(encoding="utf-8")

        self.assertIn("Get-NetTCPConnection", source)
        self.assertIn("-LocalPort 8088", source)
        self.assertIn("Existing bridge detected", source)
        self.assertIn('exit 10', source)
        self.assertIn('exit 0', source)
        self.assertIn('exit 20', source)
        self.assertIn('if "%PORT_PROBE_CODE%"=="10"', source)
        self.assertIn('if "%PORT_PROBE_CODE%"=="20"', source)
        self.assertIn("Port probe failed", source)
        self.assertNotIn("taskkill", source.lower())

    def test_probe_logic_has_distinct_free_occupied_and_failure_codes(self):
        source = (ROOT / "start-test.bat").read_text(encoding="utf-8")

        self.assertIn("$listener", source)
        self.assertIn("if ($listener)", source)
        self.assertIn("exit 10", source)
        self.assertIn("exit 0", source)
        self.assertIn("catch", source)
        self.assertIn("exit 20", source)
        self.assertIn("Unexpected port probe result", source)

    def test_probe_failure_does_not_report_existing_bridge(self):
        source = (ROOT / "start-test.bat").read_text(encoding="utf-8")
        failure_block = source.split('if "%PORT_PROBE_CODE%"=="20"', 1)[1].split('if not "%PORT_PROBE_CODE%"=="0"', 1)[0]

        self.assertIn("Port probe failed", failure_block)
        self.assertNotIn("Existing bridge detected", failure_block)

    def test_launcher_never_terminates_existing_processes(self):
        source = (ROOT / "start-test.bat").read_text(encoding="utf-8").lower()

        self.assertNotIn("taskkill", source)
        self.assertNotIn("stop-process", source)
        self.assertNotIn("kill-process", source)


if __name__ == "__main__":
    unittest.main()
