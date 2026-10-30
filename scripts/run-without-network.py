#!/usr/bin/env python3
"""Run a trusted offline check under an additional Linux socket syscall filter.

This does not replace the host sandbox, filesystem controls, or approval. It
cannot isolate malicious code from every local IPC channel. See the companion
document for the exact scope. No dependencies are downloaded by this script.
"""

import argparse
import ctypes
import datetime
import errno
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import sys


SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO_EPERM = 0x00050000 | errno.EPERM
SCMP_ARCH_X86_64 = 0xC000003E
PR_SET_NO_NEW_PRIVS = 38
PR_GET_NO_NEW_PRIVS = 39
PR_GET_SECCOMP = 21
SCMP_CMP_NE = 1
SCMP_CMP_MASKED_EQ = 7

# Every entry must resolve on the supported native ABI, or launch fails closed.
# Blocking all socket families also prevents use of a local HTTP proxy or Unix
# socket broker. io_uring cannot be used to submit socket operations indirectly.
DENIED_SYSCALLS = (
    "socket", "connect", "bind", "listen", "accept", "accept4",
    "sendto", "recvfrom", "sendmsg", "recvmsg", "sendmmsg", "recvmmsg",
    "setsockopt", "getsockopt", "getsockname", "getpeername",
    "io_uring_setup", "io_uring_register", "io_uring_enter",
    "pidfd_getfd", "ptrace", "process_vm_readv", "process_vm_writev",
)


class GuardError(RuntimeError):
    pass


class ArgumentComparison(ctypes.Structure):
    _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int),
                ("datum_a", ctypes.c_uint64), ("datum_b", ctypes.c_uint64)]


def checked(result, operation):
    if result < 0:
        raise GuardError(f"{operation} failed: {os.strerror(-result)}")


def descriptor_kind(fd):
    try:
        mode = os.fstat(fd).st_mode
    except OSError as exc:
        if exc.errno == errno.EBADF:
            return "closed"
        raise
    if stat.S_ISSOCK(mode):
        return "socket"
    if stat.S_ISFIFO(mode):
        return "pipe"
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISCHR(mode):
        return "character-device"
    return "other"


def close_extra_descriptors():
    # /proc lists descriptors above the current RLIMIT_NOFILE too. Unlike a
    # guessed upper bound, this closes every inherited descriptor in the process.
    # The launcher is single-threaded, so another thread cannot race this scan.
    if len(list(Path("/proc/self/task").iterdir())) != 1:
        raise GuardError("Launcher must be single-threaded before filtering")
    closed = []
    for entry in list(Path("/proc/self/fd").iterdir()):
        fd = int(entry.name)
        if fd > 2:
            try:
                os.close(fd)
                closed.append(fd)
            except OSError as exc:
                # The descriptor used to enumerate /proc may already be closed.
                if exc.errno != errno.EBADF:
                    raise
    return closed


def install_guard():
    if sys.platform != "linux" or platform.machine() != "x86_64" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise GuardError("Only native Linux x86-64 is supported; no unguarded fallback")
    standard = {str(fd): descriptor_kind(fd) for fd in range(3)}
    if "socket" in standard.values():
        raise GuardError("Socket standard descriptors are not allowed")

    # Fixed system SONAME; no package installation, shell, or library discovery
    # subprocess occurs here. libseccomp rejects alternate ABIs by default.
    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_arch_native.argtypes = []
    seccomp.seccomp_arch_native.restype = ctypes.c_uint32
    if seccomp.seccomp_arch_native() != SCMP_ARCH_X86_64:
        raise GuardError("Unexpected libseccomp native ABI")
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.restype = None
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_rule_add.restype = ctypes.c_int
    seccomp.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(ArgumentComparison)]
    seccomp.seccomp_rule_add_array.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    libc.socket.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
    libc.socket.restype = ctypes.c_int
    context = seccomp.seccomp_init(SCMP_ACT_ALLOW)
    if not context:
        raise GuardError("Cannot allocate seccomp filter")
    try:
        for name in DENIED_SYSCALLS:
            number = seccomp.seccomp_syscall_resolve_name(name.encode("ascii"))
            if number < 0:
                raise GuardError(f"Missing required syscall definition: {name}")
            checked(seccomp.seccomp_rule_add(context, SCMP_ACT_ERRNO_EPERM, number, 0), f"Deny {name}")
        # libuv implements child stdio pipes with socketpair(AF_UNIX). Both
        # endpoints are created inside this restricted process tree; this does
        # not allow opening a socket or connecting to an external IPC broker.
        socketpair_number = seccomp.seccomp_syscall_resolve_name(b"socketpair")
        if socketpair_number < 0:
            raise GuardError("Missing required syscall definition: socketpair")
        non_unix_family = ArgumentComparison(0, SCMP_CMP_NE, 1, 0)
        checked(seccomp.seccomp_rule_add_array(context, SCMP_ACT_ERRNO_EPERM, socketpair_number, 1, ctypes.byref(non_unix_family)), "Restrict socketpair to AF_UNIX")
        # Linux's socket type occupies the low four bits; SOCK_NONBLOCK and
        # SOCK_CLOEXEC are independent flags. Only SOCK_STREAM (1) is needed.
        # Unknown flag bits are rejected by the kernel itself.
        for socket_type in range(16):
            if socket_type != 1:
                non_stream_type = ArgumentComparison(1, SCMP_CMP_MASKED_EQ, 0xF, socket_type)
                checked(seccomp.seccomp_rule_add_array(context, SCMP_ACT_ERRNO_EPERM, socketpair_number, 1, ctypes.byref(non_stream_type)), "Restrict socketpair to SOCK_STREAM")
        closed = close_extra_descriptors()
        if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise GuardError("Cannot set no_new_privs")
        checked(seccomp.seccomp_load(context), "Load network syscall filter")
    finally:
        seccomp.seccomp_release(context)

    if libc.prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1 or libc.prctl(PR_GET_SECCOMP, 0, 0, 0, 0) != 2:
        raise GuardError("Kernel filter state could not be verified")
    probes = {}
    # These calls only attempt to create an unconnected socket. No address,
    # DNS lookup, connection, or packet transmission is attempted by the probes.
    for name, family in (("AF_INET", 2), ("AF_INET6", 10), ("AF_UNIX", 1)):
        ctypes.set_errno(0)
        fd = libc.socket(family, 1, 0)
        actual_errno = ctypes.get_errno()
        if fd >= 0:
            os.close(fd)
            raise GuardError(f"Kernel unexpectedly permitted {name} socket creation")
        if actual_errno != errno.EPERM:
            raise GuardError(f"Unexpected denial for {name}: errno {actual_errno}")
        probes[name] = {"result": "denied", "errno": actual_errno}
    return {
        "schemaVersion": 1,
        "kind": "linux-native-socket-syscall-restriction",
        "installedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pid": os.getpid(),
        "platform": sys.platform,
        "architecture": platform.machine(),
        "kernelFilterLoaded": True,
        "noNewPrivileges": True,
        "deniedSyscalls": list(DENIED_SYSCALLS),
        "socketpair": "AF_UNIX SOCK_STREAM pairs created internally only; socket/connect/sendmsg remain denied",
        "shutdown": "Allowed to close internal libuv pipe endpoints; no external socket creation or connection is permitted",
        "standardDescriptors": standard,
        "closedExtraDescriptorCount": len(closed),
        "probes": probes,
        "fullSecuritySandbox": False,
        "scope": "Trusted offline command and descendants: external socket creation and connection are denied; internal Unix stream socketpairs and shutdown remain available. Files and standard pipes remain usable.",
        "launcherSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write launch evidence to a NEW local JSON file")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("supply -- COMMAND [ARG ...]")
    try:
        evidence = install_guard()
        if args.report:
            # Deliberately no clobber or directory creation: preserve old evidence.
            with args.report.open("x", encoding="utf-8") as stream:
                json.dump(evidence, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
        print("Network syscall restriction active; executing offline command.", file=sys.stderr, flush=True)
        os.execvp(command[0], command)
    except (GuardError, OSError) as exc:
        # Do not send an error to a socket if the caller supplied socket stderr.
        if descriptor_kind(2) != "socket":
            print(f"Offline launch refused: {exc}", file=sys.stderr)
        return 125


if __name__ == "__main__":
    sys.exit(main())
