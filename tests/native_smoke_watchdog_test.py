import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('native_smoke_watchdog',root/'scripts/run-native-smoke.py')
watchdog=importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class WatchdogTest(unittest.TestCase):
    def test_success_exit_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            self.assertEqual(watchdog.run_with_watchdog([sys.executable,'-c','pass'],2,output),0)
            self.assertFalse((output/'watchdog.json').exists())

    def test_hanging_test_fails_and_preserves_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            (output/'report.json').write_text(json.dumps({'passed':False,'phase':'capture welcome page'}))
            self.assertEqual(watchdog.run_with_watchdog([sys.executable,'-c','import time; time.sleep(30)'],.2,output),1)
            self.assertEqual(json.loads((output/'report.json').read_text())['phase'],'capture welcome page')
            self.assertFalse(json.loads((output/'watchdog.json').read_text())['passed'])


if __name__=='__main__': unittest.main()
