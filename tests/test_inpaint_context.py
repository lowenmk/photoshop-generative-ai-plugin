import unittest

import numpy as np

from automatic1111.models import SelectionArea
from utils.image_utils import (
    convert_mask_image,
    expand_inpaint_context_area,
    extract_image_from_selection_and_scale,
    get_scale_factor,
    paste_image_onto_selection_in_new_image,
)


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

    def test_inference_dimensions_are_bounded_and_block_aligned(self):
        for area in (
            SelectionArea(x=1400, y=1200, width=40, height=2000),
            SelectionArea(x=500, y=2000, width=3000, height=80),
            SelectionArea(x=0, y=0, width=8, height=3000),
            SelectionArea(x=0, y=0, width=3000, height=8),
            SelectionArea(x=0, y=0, width=1, height=2048),
            SelectionArea(x=0, y=0, width=2048, height=1),
            SelectionArea(x=0, y=0, width=8, height=2048),
            SelectionArea(x=0, y=0, width=2048, height=8),
            SelectionArea(x=0, y=0, width=800, height=800),
        ):
            width, height, _ = get_scale_factor(area)
            self.assertGreaterEqual(width, 8)
            self.assertGreaterEqual(height, 8)
            self.assertLessEqual(width, 2048)
            self.assertLessEqual(height, 2048)
            self.assertEqual(width % 8, 0)
            self.assertEqual(height % 8, 0)

    def test_normal_context_keeps_the_existing_512_short_side(self):
        width, height, _ = get_scale_factor(SelectionArea(x=0, y=0, width=800, height=800))
        self.assertEqual((width, height), (512, 512))

    def test_extreme_images_resize_and_paste_back_to_the_exact_selection(self):
        for image_shape, area, expected_shape in (
            ((3000, 8, 4), SelectionArea(x=0, y=0, width=8, height=3000), (2048, 8)),
            ((8, 3000, 4), SelectionArea(x=0, y=0, width=3000, height=8), (8, 2048)),
        ):
            image = np.full(image_shape, 255, dtype=np.uint8)
            scaled, scale_factor = extract_image_from_selection_and_scale(image, area)
            self.assertEqual(scaled.shape[:2], expected_shape)

            pasted = paste_image_onto_selection_in_new_image(
                document_width=area.width,
                document_height=area.height,
                image_to_paste=scaled[:, :, :3],
                selection_area=area,
                scale_factor=scale_factor,
            )
            self.assertEqual(pasted.shape[:2], (area.height, area.width))
            self.assertTrue(np.all(pasted[:, :, 3] == 255))

    def test_validated_eye_context_geometry_is_unchanged(self):
        area = SelectionArea(x=1053, y=1506, width=1656, height=876)
        width, height, scale_factor = get_scale_factor(area)

        self.assertEqual((width, height), (968, 512))
        self.assertAlmostEqual(scale_factor, 0.5844748858447488)


if __name__ == "__main__":
    unittest.main()
