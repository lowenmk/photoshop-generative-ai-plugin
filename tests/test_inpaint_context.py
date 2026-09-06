import unittest

import numpy as np

from automatic1111.models import SelectionArea
from utils.image_utils import convert_mask_image, expand_inpaint_context_area


class InpaintContextTests(unittest.TestCase):
    def test_expands_context_while_preserving_document_alignment(self):
        area = SelectionArea(x=1467, y=1725, width=828, height=438)

        expanded = expand_inpaint_context_area(area, document_width=3000, document_height=4500)

        self.assertEqual(expanded, SelectionArea(x=1053, y=1506, width=1656, height=876))
        self.assertLess(area.width * area.height, expanded.width * expanded.height)

    def test_mask_alpha_polarity_and_result_alpha_are_preserved(self):
        full_mask = np.zeros((100, 120, 4), dtype=np.uint8)
        full_mask[35:65, 45:75, :3] = 255
        full_mask[35:65, 45:75, 3] = 255
        converted = convert_mask_image(full_mask)

        self.assertEqual(int(converted[50, 60, 0]), 255)
        self.assertEqual(int(converted[0, 0, 0]), 0)
        self.assertEqual(int((converted[:, :, 0] > 0).sum()), 30 * 30)


if __name__ == "__main__":
    unittest.main()
