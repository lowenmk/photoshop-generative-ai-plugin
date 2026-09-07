import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PromptUiFlowTests(unittest.TestCase):
    def test_prompt_textareas_do_not_define_instructional_placeholders(self):
        source = (ROOT / "src/components/tabs/dream/PromptControls.jsx").read_text(encoding="utf-8")

        self.assertIn('<sp-body size="S" class="promptFieldLabel">{label}</sp-body>', source)
        self.assertIn('<sp-textarea class="dreamPromptTextArea" value={prompt}', source)
        self.assertNotIn("Prompt (what to dream)", source)
        self.assertNotIn("Negative prompt (what to avoid dreaming)", source)
        self.assertNotIn("placeholder={placeholder}", source)


if __name__ == "__main__":
    unittest.main()
