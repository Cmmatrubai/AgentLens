import unittest
from evaluation_outcomes import assertion_outcome

class EvaluationOutcomes(unittest.TestCase):
    def test_unhandled_runner_error_cannot_be_a_pass(self):
        self.assertEqual(assertion_outcome('passed', 1), 'unknown')

    def test_assertion_failure_remains_a_failure(self):
        self.assertEqual(assertion_outcome('failed', 1), 'fail')

    def test_clean_completed_assertion_passes(self):
        self.assertEqual(assertion_outcome('passed', 0), 'pass')

    def test_incomplete_or_skipped_is_unknown(self):
        self.assertEqual(assertion_outcome('passed', None), 'unknown')
        self.assertEqual(assertion_outcome('skipped', 0), 'unknown')

if __name__ == '__main__':
    unittest.main()
