import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TestLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bat_source = (ROOT / "start-test.bat").read_text(encoding="utf-8")
        cls.ps_source = (ROOT / "start-test-supervisor.ps1").read_text(encoding="utf-8")

    def test_launcher_uses_foreground_supervisor(self):
        self.assertIn("start-test-supervisor.ps1", self.bat_source)
        executable_lines = "\n".join(
            line for line in self.bat_source.lower().splitlines()
            if not line.strip().startswith("rem ")
        )
        self.assertNotIn("cmd /k", executable_lines)
        self.assertNotIn("start ", executable_lines)

    def test_bridge_command_and_test_mode_are_explicit(self):
        self.assertIn('"-m", "uvicorn"', self.ps_source)
        self.assertIn('"--app-dir=local_server"', self.ps_source)
        self.assertIn('"--port", "$expectedPort"', self.ps_source)
        self.assertIn('$env:EASYSD_DEV_TEST_API = "1"', self.ps_source)

    def test_owned_pid_identity_and_process_tree_cleanup(self):
        self.assertIn("test-bridge.json", self.ps_source)
        self.assertIn("Test-ExpectedBridgeCommand", self.ps_source)
        self.assertIn("Test-ProcessInTree", self.ps_source)
        self.assertIn("Get-ProcessTree", self.ps_source)
        self.assertIn("Stop-OwnedBridge", self.ps_source)
        self.assertIn("Stop-Process -Id", self.ps_source)
        self.assertNotIn("taskkill", self.bat_source.lower() + self.ps_source.lower())

    def test_stale_recovery_requires_identity_and_preserves_unrelated_listener(self):
        self.assertIn("Try-RecoverStaleOwnedBridge", self.ps_source)
        self.assertIn("Test-ActiveSupervisor", self.ps_source)
        self.assertIn("if (Test-ActiveSupervisor $state)", self.ps_source)
        self.assertIn("launcherPid = $PID", self.ps_source)
        self.assertIn("if (-not (Try-RecoverStaleOwnedBridge $listener))", self.ps_source)
        self.assertIn("Command line:", self.ps_source)
        self.assertIn("return $false", self.ps_source)
        self.assertIn("Test-ExpectedBridgeCommand $candidateRecord", self.ps_source)
        self.assertIn("Test-ProcessInTree $candidatePid", self.ps_source)

    def test_probe_failure_is_distinct_from_occupied_port(self):
        self.assertIn("Port probe failed:", self.ps_source)
        self.assertIn("exit 2", self.ps_source)
        self.assertIn("exit 1", self.ps_source)
        self.assertNotIn("Existing bridge detected", self.bat_source + self.ps_source)

    def test_launcher_does_not_manage_a1111_or_uxp_process_lifetime(self):
        source = (self.bat_source + self.ps_source).lower()
        self.assertNotIn("taskkill", source)
        self.assertNotIn("stop-process -name", source)
        self.assertNotIn("a1111", source)
        self.assertNotIn("uxp service stop", source)


if __name__ == "__main__":
    unittest.main()
