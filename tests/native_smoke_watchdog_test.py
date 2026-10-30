import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('native_smoke_watchdog',root/'scripts/run-native-smoke.py')
watchdog=importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


def open_process_for_wait(pid):
    """Open before signalling so Windows cannot lose the process to a PID race."""
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=(wintypes.DWORD,wintypes.BOOL,wintypes.DWORD)
    kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes=(wintypes.HANDLE,wintypes.DWORD)
    kernel.WaitForSingleObject.restype=wintypes.DWORD
    kernel.TerminateProcess.argtypes=(wintypes.HANDLE,wintypes.UINT)
    kernel.TerminateProcess.restype=wintypes.BOOL
    kernel.CloseHandle.argtypes=(wintypes.HANDLE,)
    kernel.CloseHandle.restype=wintypes.BOOL
    handle=kernel.OpenProcess(0x00100001,False,pid) # SYNCHRONIZE | PROCESS_TERMINATE
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    return kernel,handle


def wait_process_exit(pid, handle, timeout=10):
    if os.name == 'nt':
        kernel,process=handle
        try:
            result=kernel.WaitForSingleObject(process,int(timeout*1000))
            if result != 0:
                kernel.TerminateProcess(process,1)
                kernel.WaitForSingleObject(process,5000)
                raise AssertionError(f'Descendant did not exit; wait result {result}')
        finally:
            kernel.CloseHandle(process)
        return
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            os.kill(pid,0)
            # A Linux zombie has exited and holds no file descriptors, even
            # if the container's init process has not reaped it yet.
            status=Path(f'/proc/{pid}/stat')
            if status.exists() and status.read_text().rpartition(')')[2].split()[0]=='Z':
                return
        except ProcessLookupError:
            return
        except FileNotFoundError:
            return
        time.sleep(.02)
    try: os.kill(pid,signal.SIGTERM)
    except ProcessLookupError: pass
    raise AssertionError('Descendant did not exit after being released')


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
            # Wait for the actual process to exit before temporary-directory
            # cleanup: Windows cannot unlink a file held by any process.
            release=Path(folder)/'release'
            pid_file=Path(folder)/'descendant-pid'
            descendant='''import pathlib,sys,time
release=pathlib.Path(sys.argv[1])
pid_file=pathlib.Path(sys.argv[2])
import os
tmp=pid_file.with_suffix('.tmp')
tmp.write_text(str(os.getpid()))
os.replace(tmp,pid_file)
while not release.exists():
    time.sleep(.02)
'''
            child=('import subprocess,sys; '
                   f'subprocess.Popen([sys.executable,"-c",{descendant!r},{str(release)!r},{str(pid_file)!r}]); '
                   'print("done")')
            runner='import importlib.util,sys; from pathlib import Path; spec=importlib.util.spec_from_file_location("w",sys.argv[1]); w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w); sys.exit(w.run_with_watchdog([sys.executable,"-c",sys.argv[3]],8,Path(sys.argv[2])))'
            try:
                started=time.monotonic()
                result=subprocess.run([sys.executable,'-c',runner,str(root/'scripts/run-native-smoke.py'),folder,child],capture_output=True,timeout=8)
                self.assertEqual(result.returncode,0,result.stderr.decode())
                self.assertLess(time.monotonic()-started,8)
            finally:
                deadline=time.monotonic()+10
                while not pid_file.exists() and time.monotonic()<deadline:
                    time.sleep(.02)
                self.assertTrue(pid_file.exists(),'Descendant did not start')
                pid=int(pid_file.read_text())
                handle=open_process_for_wait(pid)
                release.touch()
                wait_process_exit(pid,handle)
            self.assertIn('done',(Path(folder)/'native-smoke.log').read_text())

    def test_hanging_test_fails_and_preserves_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            (output/'report.json').write_text(json.dumps({'passed':False,'phase':'capture welcome page'}))
            self.assertEqual(watchdog.run_with_watchdog([sys.executable,'-c','import time; time.sleep(30)'],.2,output),1)
            self.assertEqual(json.loads((output/'report.json').read_text())['phase'],'capture welcome page')
            self.assertFalse(json.loads((output/'watchdog.json').read_text())['passed'])


if __name__=='__main__': unittest.main()
