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
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],timeout=10,check=False,
                           stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except (OSError,subprocess.TimeoutExpired):
            pass
    if process.poll() is None:
        process.kill()


def run_with_watchdog(command, timeout, output):
    output.mkdir(parents=True,exist_ok=True)
    # Installers and GUI applications may leave descendants alive. If any of
    # them inherit the Actions runner's stdout/stderr pipes, the runner can
    # wait for pipe EOF even after this watchdog has exited. A real file avoids
    # that dependency and still preserves the complete diagnostic output.
    with (output/'native-smoke.log').open('wb') as log:
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
        try:
            code=process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_tree(process)
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: pass
            (output/'watchdog.json').write_text(json.dumps({'passed':False,'timeoutSeconds':timeout,'reason':'native smoke process exceeded its time limit'},indent=2)+'\n',encoding='utf8')
            print('Native smoke timed out; the last checkpoint and watchdog evidence are retained.',file=sys.stderr)
            return 1
    print(f'Native smoke exited {code}; detailed output: {output / "native-smoke.log"}')
    return code


if __name__=='__main__':
    if os.name!='nt':
        raise SystemExit('Native installer smoke requires a Windows runner')
    root=Path(__file__).resolve().parents[1]
    script=root/'scripts/smoke-base-installer.ps1'
    sys.exit(run_with_watchdog(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(script),'-PayloadManifest','build/base-payload.json','-VerifyCurrentFeatures'],480,root/'build/base-installer-review'))
