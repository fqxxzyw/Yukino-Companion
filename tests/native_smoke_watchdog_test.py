import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
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

    def test_child_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            self.assertEqual(watchdog.run_with_watchdog([sys.executable,'-c','print("smoke output")'],2,output),0)
            self.assertIn('smoke output',(output/'native-smoke.log').read_text())

    def test_descendant_cannot_hold_runner_output_pipe_open(self):
        with tempfile.TemporaryDirectory() as folder:
            # The simulated smoke command starts a descendant that keeps its
            # stdout open after the command returns, as a GUI process may do.
            # Signal that descendant to close the inherited handles before
            # TemporaryDirectory cleanup: Windows cannot unlink open files.
            release=Path(folder)/'release'
            done=Path(folder)/'descendant-done'
            descendant='''import pathlib,sys,time
release=pathlib.Path(sys.argv[1])
done=pathlib.Path(sys.argv[2])
while not release.exists():
    time.sleep(.02)
for stream in (sys.stdout,sys.stderr):
    try: stream.close()
    except OSError: pass
done.write_text('closed')
'''
            child=('import subprocess,sys; '
                   f'subprocess.Popen([sys.executable,"-c",{descendant!r},{str(release)!r},{str(done)!r}]); '
                   'print("done")')
            runner='import importlib.util,sys; from pathlib import Path; spec=importlib.util.spec_from_file_location("w",sys.argv[1]); w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w); sys.exit(w.run_with_watchdog([sys.executable,"-c",sys.argv[3]],8,Path(sys.argv[2])))'
            try:
                started=time.monotonic()
                result=subprocess.run([sys.executable,'-c',runner,str(root/'scripts/run-native-smoke.py'),folder,child],capture_output=True,timeout=8)
                self.assertEqual(result.returncode,0,result.stderr.decode())
                self.assertLess(time.monotonic()-started,8)
            finally:
                release.touch()
                deadline=time.monotonic()+10
                while not done.exists() and time.monotonic()<deadline:
                    time.sleep(.02)
                self.assertTrue(done.exists(),'Descendant did not close its inherited output handles')
            self.assertIn('done',(Path(folder)/'native-smoke.log').read_text())

    def test_hanging_test_fails_and_preserves_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            (output/'report.json').write_text(json.dumps({'passed':False,'phase':'capture welcome page'}))
            self.assertEqual(watchdog.run_with_watchdog([sys.executable,'-c','import time; time.sleep(30)'],.2,output),1)
            self.assertEqual(json.loads((output/'report.json').read_text())['phase'],'capture welcome page')
            self.assertFalse(json.loads((output/'watchdog.json').read_text())['passed'])


if __name__=='__main__': unittest.main()
