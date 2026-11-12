import copy
import datetime as dt
import json
import io
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from test_collect import c

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root / 'data').mkdir()
        self.registry = json.loads((c.ROOT / 'data/registry.json').read_text())
        self.ledger = json.loads((c.ROOT / 'data/releases.json').read_text())
        self.cloud = json.loads((c.ROOT / 'data/snapshot.json').read_text())
        self.cloud.update(collector='cloudflare-cron', generated_at=c.now(), followups=self.registry['followups'])
        for name, value in [('registry', self.registry), ('releases', self.ledger), ('snapshot', self.cloud)]:
            (self.root / ('data/' + name + '.json')).write_text(json.dumps(value))
    def tearDown(self):
        self.tmp.cleanup()
    def result(self):
        return json.loads((self.root / 'data/snapshot.json').read_text())
    def test_fresh_cloud_is_archived_without_recollecting(self):
        with patch.object(c, 'cloud_snapshot', return_value=self.cloud), patch.object(c, 'api', side_effect=AssertionError('unexpected API')):
            self.assertEqual(c.collect(self.root, 'mock'), 0)
        self.assertEqual(self.result()['generated_at'], self.cloud['generated_at'])
    def test_partial_failure_is_preserved_and_surfaced(self):
        self.cloud['projects'][0]['metrics']['ok'] = False
        with patch.object(c, 'cloud_snapshot', return_value=self.cloud):
            self.assertEqual(c.collect(self.root, 'mock'), 1)
        self.assertFalse(self.result()['projects'][0]['metrics']['ok'])
    def test_changed_registry_requires_fresh_collection_not_stale_followup(self):
        cloud = copy.deepcopy(self.cloud)
        cloud['followups'] = []
        with patch.object(c, 'cloud_snapshot', return_value=cloud), patch.object(c, 'api', side_effect=RuntimeError('offline')):
            self.assertGreater(c.collect(self.root, 'mock'), 0)
        self.assertEqual(self.result()['followups'], self.registry['followups'])
    def test_offline_cloud_falls_back_and_keeps_history(self):
        with patch.object(c, 'cloud_snapshot', side_effect=RuntimeError('offline')), patch.object(c, 'api', side_effect=RuntimeError('offline')):
            self.assertGreater(c.collect(self.root, 'mock'), 0)
        self.assertEqual(self.result()['history'], self.cloud['history'])
    def test_merge_keeps_observations_from_both_collectors(self):
        a={'project':'a','at':'2026-11-12','stars':1}
        b={'project':'a','at':'2026-11-13','stars':2}
        self.assertEqual(c.merge_history([a],[a,b]),[a,b])

    def test_public_request_identifies_real_collector_without_auth(self):
        with patch.object(c.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(self.cloud).encode())) as opening:
            result=c.cloud_snapshot('https://xiaosong-observatory-collector.xudukongju.workers.dev/snapshot')
        request=opening.call_args[0][0]
        self.assertIn('xudukongju-open-source-observatory', request.get_header('User-agent'))
        self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual(result['generated_at'],self.cloud['generated_at'])
