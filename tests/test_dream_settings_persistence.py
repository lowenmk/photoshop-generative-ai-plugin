import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DreamSettingsPersistenceTests(unittest.TestCase):
    def test_dream_unmount_flushes_latest_state_before_remount(self):
        dream_source = (ROOT / "src/components/tabs/DreamTab.jsx").read_text(encoding="utf-8")
        storage_source = (ROOT / "src/utils/SettingsStorage.js").read_text(encoding="utf-8")

        unmount = dream_source.split("componentWillUnmount()", 1)[1].split("componentDidUpdate", 1)[0]
        self.assertIn("settingsStorage.saveDreamSettingsBatched(this.state)", unmount)
        self.assertIn("settingsStorage.flushPendingDreamSettingsSync()", unmount)
        self.assertIn("flushPendingDreamSettingsSync", storage_source)
        self.assertIn("this.dreamSettingsPendingWrite = {};", storage_source)

    def test_workflow_state_is_not_added_to_model_profile_contract(self):
        dream_source = (ROOT / "src/components/tabs/DreamTab.jsx").read_text(encoding="utf-8")
        model_change = dream_source.split("notifyModelSettingsChange =", 1)[1].split("onCancelButtonClick", 1)[0]

        for workflow_field in ("maskSource", "selectionInvert", "selectionFeather", "selectionExpand", "imageCount"):
            self.assertNotIn(workflow_field, model_change)

    def test_flush_is_a_noop_without_pending_settings(self):
        storage_source = (ROOT / "src/utils/SettingsStorage.js").read_text(encoding="utf-8")
        flush = storage_source.split("flushPendingDreamSettingsSync =", 1)[1].split("writePendingDreamSettingsToLocalStorage", 1)[0]

        self.assertIn("Object.keys(this.dreamSettingsPendingWrite).length === 0", flush)
        self.assertIn("return;", flush)


if __name__ == "__main__":
    unittest.main()
