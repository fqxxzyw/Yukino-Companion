import ctypes
import errno
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts/run-without-network.py"
spec = importlib.util.spec_from_file_location("network_guard", LAUNCHER)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


@unittest.skipUnless(sys.platform == "linux" and platform.machine() == "x86_64", "Linux x86-64 guard only")
class NetworkGuardTests(unittest.TestCase):
    def run_guard(self, code, *, arguments=(), **kwargs):
        # -I -S avoids user startup hooks in the launcher and probe interpreters.
        return subprocess.run(
            [sys.executable, "-I", "-S", str(LAUNCHER), *arguments, "--", sys.executable, "-I", "-S", "-c", code],
            text=True, capture_output=True, timeout=20, **kwargs,
        )

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_socket_families_are_denied_without_connecting(self):
        result = self.run_guard("""
import errno,json,socket
results={}
for name in ('AF_INET','AF_INET6','AF_UNIX'):
    try:
        s=socket.socket(getattr(socket,name),socket.SOCK_STREAM)
    except OSError as e:
        results[name]=e.errno
    else:
        s.close(); raise AssertionError(name+' was permitted')
assert all(value==errno.EPERM for value in results.values()),results
print(json.dumps(results))
""")
        self.assertEqual(set(self.assert_ok(result)), {"AF_INET", "AF_INET6", "AF_UNIX"})

    def test_raw_libc_and_io_uring_calls_are_denied(self):
        result = self.run_guard("""
import ctypes,errno,json
c=ctypes.CDLL(None,use_errno=True)
c.syscall.restype=ctypes.c_long
results={}
# Native x86-64: socket, connect, sendto, sendmsg, io_uring_setup,
# io_uring_enter, io_uring_register, pidfd_getfd, ptrace.
# Invalid fd/null pointers avoid any packet even if a regression permits a call.
for name,n,args in [('socket',41,(2,1,0)),('connect',42,(-1,0,0)),
                    ('sendto',44,(-1,0,0,0,0,0)),('sendmsg',46,(-1,0,0)),
                    ('io_uring_setup',425,(0,0)),('io_uring_enter',426,(-1,0,0,0,0,0)),
                    ('io_uring_register',427,(-1,0,0,0)),('pidfd_getfd',438,(-1,-1,0)),
                    ('ptrace',101,(-1,0,0,0))]:
    ctypes.set_errno(0)
    returned=c.syscall(n,*args)
    results[name]=[returned,ctypes.get_errno()]
    assert returned==-1 and results[name][1]==errno.EPERM,(name,results[name])
print(json.dumps(results))
""")
        self.assertEqual(len(self.assert_ok(result)), 9)

    def test_exec_descendants_keep_filter_and_pipes_work(self):
        result = self.run_guard("""
import json,subprocess,sys
code='import socket,errno\\ntry: socket.socket()\\nexcept OSError as e: assert e.errno==errno.EPERM; print("blocked")\\nelse: raise AssertionError("socket allowed")'
p=subprocess.run([sys.executable,'-I','-S','-c',code],capture_output=True,text=True)
assert p.returncode==0,(p.returncode,p.stderr)
print(json.dumps({'child':p.stdout.strip()}))
""")
        self.assertEqual(self.assert_ok(result), {"child": "blocked"})

    def test_node_child_stdio_works_and_child_cannot_create_network_socket(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node is not installed")
        child = "import socket,errno\ntry: socket.socket()\nexcept OSError as e: assert e.errno==errno.EPERM; print('blocked')\nelse: raise AssertionError('socket allowed')"
        code = "const p=require('node:child_process').spawnSync(" + json.dumps(sys.executable) + ",['-I','-S','-c'," + json.dumps(child) + "],{encoding:'utf8'});if(p.error)throw p.error;if(p.status!==0)throw Error(p.stderr);console.log(JSON.stringify({child:p.stdout.trim()}));"
        result = subprocess.run([sys.executable, "-I", "-S", str(LAUNCHER), "--", node, "-e", code], text=True, capture_output=True, timeout=20)
        self.assertEqual(self.assert_ok(result), {"child": "blocked"})

    def test_only_internal_unix_socketpair_is_available(self):
        result = self.run_guard("""
import errno,json,socket
left,right=socket.socketpair()
# read/write, as used by libuv pipes, does not require sendmsg/SCM_RIGHTS.
import os
os.write(left.fileno(),b'internal')
assert os.read(right.fileno(),8)==b'internal'
left.shutdown(socket.SHUT_WR)
assert os.read(right.fileno(),1)==b''
left.close();right.close()
for family in (socket.AF_INET,socket.AF_INET6):
    try: socket.socketpair(family)
    except OSError as e: assert e.errno==errno.EPERM
    else: raise AssertionError('non-Unix socketpair allowed')
for kind in (socket.SOCK_DGRAM,socket.SOCK_SEQPACKET):
    try: socket.socketpair(socket.AF_UNIX,kind)
    except OSError as e: assert e.errno==errno.EPERM
    else: raise AssertionError('non-stream socketpair allowed')
print(json.dumps({'internalPair':True}))
""")
        self.assertEqual(self.assert_ok(result), {"internalPair": True})

    def test_inherited_extra_descriptors_are_closed(self):
        with tempfile.TemporaryFile() as stream:
            fd = stream.fileno()
            code = f"""
import errno,json,os
try: os.fstat({fd})
except OSError as e: assert e.errno==errno.EBADF
else: raise AssertionError('inherited descriptor survived')
print(json.dumps({{'closed':True}}))
"""
            self.assertEqual(self.assert_ok(self.run_guard(code, pass_fds=(fd,))), {"closed": True})

    def test_socket_standard_descriptor_refuses_child(self):
        # A local socketpair is never connected to an external address.
        left, right = socket.socketpair()
        try:
            result = self.run_guard("raise AssertionError('must not execute')", stdin=left)
            self.assertEqual(result.returncode, 125)
            self.assertIn("Socket standard descriptors", result.stderr)
        finally:
            left.close()
            right.close()

    def test_file_io_and_new_report_work_without_changing_proxy_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / "guard.json"
            output = Path(folder) / "output.txt"
            code = f"""
import json,os,pathlib
p=pathlib.Path({str(output)!r}); p.write_text('offline'); assert p.read_text()=='offline'
assert os.environ['HTTPS_PROXY']=='http://example.invalid:9'
print(json.dumps({{'file':True}}))
"""
            result = self.run_guard(code, arguments=("--report", str(report)), env={**os.environ, "HTTPS_PROXY": "http://example.invalid:9"})
            self.assertEqual(self.assert_ok(result), {"file": True})
            data = json.loads(report.read_text())
            self.assertTrue(data["kernelFilterLoaded"])
            self.assertTrue(data["noNewPrivileges"])
            self.assertFalse(data["fullSecuritySandbox"])
            self.assertEqual(len(data["launcherSha256"]), 64)
            self.assertEqual(data["probes"]["AF_INET"]["errno"], errno.EPERM)
            result = self.run_guard("raise AssertionError('must not execute')", arguments=("--report", str(report)))
            self.assertEqual(result.returncode, 125)
            self.assertEqual(json.loads(report.read_text()), data)

    def test_unsupported_platform_and_missing_library_fail_closed(self):
        with mock.patch.object(guard.sys, "platform", "win32"):
            with self.assertRaises(guard.GuardError):
                guard.install_guard()
        with mock.patch.object(guard.ctypes, "CDLL", side_effect=OSError("library missing")):
            with self.assertRaises(OSError):
                guard.install_guard()

    def test_main_never_executes_target_when_filter_installation_fails(self):
        with mock.patch.object(guard, "install_guard", side_effect=guard.GuardError("filter refused")), mock.patch.object(guard.os, "execvp") as execute:
            self.assertEqual(guard.main(["--", "forbidden-target"]), 125)
            execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
