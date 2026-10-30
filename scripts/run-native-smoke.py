"""Bound the disposable Windows CI smoke test and retain timeout evidence."""
import json
import os
from pathlib import Path
import subprocess
import sys


def stop_tree(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        try:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],timeout=10,check=False)
        except (OSError,subprocess.TimeoutExpired):
            pass
    if process.poll() is None:
        process.kill()


def run_with_watchdog(command, timeout, output):
    output.mkdir(parents=True,exist_ok=True)
    process=subprocess.Popen(command)
    try:
        code=process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_tree(process)
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: pass
        (output/'watchdog.json').write_text(json.dumps({'passed':False,'timeoutSeconds':timeout,'reason':'native smoke process exceeded its time limit'},indent=2)+'\n',encoding='utf8')
        print('Native smoke timed out; the last checkpoint and watchdog evidence are retained.',file=sys.stderr)
        return 1
    return code


if __name__=='__main__':
    if os.name!='nt':
        raise SystemExit('Native installer smoke requires a Windows runner')
    root=Path(__file__).resolve().parents[1]
    script=root/'scripts/smoke-base-installer.ps1'
    sys.exit(run_with_watchdog(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(script),'-PayloadManifest','build/base-payload.json','-VerifyCurrentFeatures'],480,root/'build/base-installer-review'))
