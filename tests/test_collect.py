import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('collect', pathlib.Path(__file__).resolve().parents[1] / 'scripts/collect.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
class CollectorTests(unittest.TestCase):
    def test_failed_source_preserves_timestamp_and_value(self):
        before = {'observed_at':'yesterday','value':{'stars':7}}
        def fail(): raise RuntimeError('offline')
        result = c.source(before,fail,'today')
        self.assertFalse(result['ok'])
        self.assertEqual(result['observed_at'],'yesterday')
        self.assertEqual(result['value'],before['value'])
        self.assertEqual(result['checked_at'],'today')
    def test_first_failure_is_not_zero(self):
        def fail(): raise RuntimeError('offline')
        self.assertIsNone(c.source({},fail,'today')['value'])
    def test_feedback_semantics(self):
        self.assertEqual(c.feedback_state('visitor',[],'owner'),'needs_reply')
        self.assertEqual(c.feedback_state('owner',[],'owner'),'watching')
        self.assertEqual(c.feedback_state('visitor',[{'author':'owner','created_at':'2026-01-02'}],'owner'),'replied')
        comments=[{'author':'owner','created_at':'2026-01-02'},{'author':'visitor','created_at':'2026-01-03'}]
        self.assertEqual(c.feedback_state('visitor',comments,'owner'),'needs_reply')
        self.assertEqual(c.feedback_state('visitor',[],'owner',True),'closed')
    def test_pagination(self):
        original=c.api
        c.api=lambda path: list(range(100)) if 'page=1' in path.split('&') else [999]
        try: self.assertEqual(len(c.pages('repos/a/b/issues?state=all')),101)
        finally: c.api=original
if __name__=='__main__': unittest.main()
