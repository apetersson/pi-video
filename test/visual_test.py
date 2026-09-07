import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_e2e', Path(__file__).resolve().parent.parent / 'scripts/verify-e2e.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

SCENES = [
    'An excavated earthen pit contains a rectangular chamber.',
    'A row of nine dark glazed vessels stands against a brick wall.',
    'A painted wooden panel has flowers and a long-tailed bird.',
    'Collapsed wooden furniture and scattered dishes fill a chamber.',
    'A brick vaulted room holds two coffins.',
    'Finally a carved stone doorway with double doors appears.',
]


class VisualRegressionTests(unittest.TestCase):
    def test_distinct_ordered_observations_pass(self):
        self.assertEqual(len(verify.validate_canonical('\n'.join(SCENES))), 6)

    def test_old_keyword_false_positives_fail(self):
        for answer in ['There is a tomb and a jar.', 'I cannot see the video, but perhaps it has a tomb and vessels.',
                       'tomb pit jar vessel flower bird furniture coffin door']:
            with self.subTest(answer=answer), self.assertRaises(AssertionError):
                verify.validate_canonical(answer)

    def test_wrong_count_missing_scene_and_wrong_order_fail(self):
        for scenes in [SCENES[:1] + SCENES[2:], list(reversed(SCENES)),
                       [scene.replace('nine', 'six') for scene in SCENES],
                       [scene.replace('two coffins', 'one coffin') for scene in SCENES]]:
            with self.subTest(scenes=scenes), self.assertRaises(AssertionError):
                verify.validate_canonical('\n'.join(scenes))

    def test_negated_scenes_do_not_count_as_evidence(self):
        with self.assertRaises(AssertionError):
            verify.validate_canonical('\n'.join('There is no evidence of: ' + scene for scene in SCENES))

    def test_read_transport_marker_and_completion_evidence_are_required(self):
        rows = [
            {'type': 'tool_execution_end', 'toolName': 'read', 'result': {'details': {'piVideo': {'version': 1}}}},
            {'type': 'message_end', 'message': {'role': 'assistant', 'stopReason': 'stop', 'content': [{'type': 'text', 'text': '\n'.join(SCENES)}]}},
        ]
        transport = [{'videos': 1, 'videoBytes': [2048], 'formats': ['input_video'], 'markers': False}]
        verify.validate_run(rows, transport, canonical=True)
        for bad in [[], [{**transport[0], 'markers': True}], [{**transport[0], 'videoBytes': [0]}],
                    [{**transport[0], 'formats': ['image_url']}], [{key: value for key, value in transport[0].items() if key != 'markers'}]]:
            with self.subTest(transport=bad), self.assertRaises(AssertionError):
                verify.validate_run(rows, bad, canonical=True)
        with self.assertRaises(AssertionError):
            verify.validate_run(rows[1:], transport)
        rows[-1]['message']['stopReason'] = 'error'
        with self.assertRaises(AssertionError):
            verify.validate_run(rows, transport)


if __name__ == '__main__':
    unittest.main()
