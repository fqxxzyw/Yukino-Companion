"""Read-only CI verification of an exact previously built installer.

All child output goes to real files, with individual timeouts and heartbeats.
Does not call PrintWindow/SendMessage or claim their GUI-page checks passed.
"""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

COMMIT='a60bd0581bc93904b6d7f3f968ca1f508496fe6e'
TREE='6dafe4985fb1707667e325a93efc2ecda29c5098'
RUN='41029585625'
BYTES=265093333
SHA='2c75821d389d062179026fb29ec35033b761ba92ac833b9e49879608e4f44546'
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build/native-exact-review'
OUT.mkdir(parents=True,exist_ok=True)
REPORT={'schemaVersion':1,'fixtureOnly':False,'installerCommit':COMMIT,'installerTree':TREE,'originalRunId':RUN,'installerBytes':BYTES,'installerSHA256':SHA,'passed':False,'checks':[],'guiWelcomeAndDirectoryCaptureVerified':False,'printWindowOrSendMessageUsed':False,'realGPUASRMicrophoneCameraVoiceVerified':False,'temporaryProfileCleanup':'disposable runner; no blocking recursive cleanup'}
APP=None
HANDLES=[]


def sha(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def checkpoint(phase):
    REPORT['phase']=phase
    REPORT['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    (OUT/'report.json').write_text(json.dumps(REPORT,indent=2)+'\n',encoding='utf8')
    print('Native exact checkpoint: '+phase,flush=True)


def kill_tree(process):
    if not process or process.poll() is not None:return
    try:subprocess.run(['taskkill.exe','/PID',str(process.pid),'/T','/F'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10,check=False,close_fds=True)
    except (OSError,subprocess.TimeoutExpired):pass
    if process.poll() is None:process.kill()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:raise RuntimeError('Owned child did not stop after termination')


def run(command,label,timeout=120,env=None,allow_failure=False):
    checkpoint(label)
    with (OUT/(label+'.stdout.log')).open('wb') as stdout,(OUT/(label+'.stderr.log')).open('wb') as stderr:
        process=subprocess.Popen([str(value) for value in command],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,close_fds=True)
        deadline=time.monotonic()+timeout;heartbeat=time.monotonic()+10
        while process.poll() is None:
            now=time.monotonic()
            if now>=deadline:
                kill_tree(process)
                raise TimeoutError(label+' exceeded '+str(timeout)+' seconds')
            if now>=heartbeat:
                print('Native exact heartbeat: '+label,flush=True);heartbeat=now+10
            time.sleep(.25)
        if process.returncode and not allow_failure:
            raise RuntimeError(label+' failed with exit '+str(process.returncode)+'; see its file logs')
        return process.returncode


def visible_title(pid):
    user32=ctypes.WinDLL('user32',use_last_error=True)
    callback_type=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
    user32.IsWindowVisible.argtypes=[wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
    titles=[]
    def visit(window,_):
        owner=wintypes.DWORD();user32.GetWindowThreadProcessId(window,ctypes.byref(owner))
        if owner.value==pid and user32.IsWindowVisible(window):
            buffer=ctypes.create_unicode_buffer(512);user32.GetWindowTextW(window,buffer,len(buffer));titles.append(buffer.value)
        return True
    callback=callback_type(visit)
    user32.EnumWindows(callback,0)
    return titles


def stop_app():
    global APP
    if APP:kill_tree(APP)
    for handle in HANDLES:handle.close()
    HANDLES.clear();APP=None


def main():
    global APP
    if os.name!='nt':raise RuntimeError('This verification requires Windows')
    source=json.loads((ROOT/'release/candidate-source.json').read_text(encoding='utf-8-sig'))
    installer=ROOT/'release/Yukino-Companion-0.4.0-Base-Setup.exe'
    if (source.get('commit'),source.get('tree'),str(source.get('runId')),source.get('bytes'),source.get('sha256'))!=(COMMIT,TREE,RUN,BYTES,SHA):raise ValueError('Candidate identity does not match the exact published build')
    if installer.stat().st_size!=BYTES or sha(installer)!=SHA:raise ValueError('Exact published installer bytes do not match')
    REPORT['checks'].append('Exact published installer bytes and original source/tree/run match')
    temporary=Path(tempfile.mkdtemp(prefix='Yukino Native Exact '))
    target=temporary/'中文目录'/'Yukino Companion';target.parent.mkdir(parents=True)
    profile=temporary/'isolated profile';roaming=profile/'Roaming';local=profile/'Local'
    roaming.mkdir(parents=True);local.mkdir(parents=True)
    sentinel_profile=profile/'synthetic-preservation.json';sentinel_profile.write_text('{"syntheticOnly":true,"preserve":"user settings sentinel"}',encoding='utf8');profile_sha=sha(sentinel_profile)
    env={**os.environ,'APPDATA':str(roaming),'LOCALAPPDATA':str(local)}
    args=['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/DIR='+str(target)]
    run([installer,*args,'/LOG='+str(OUT/'install-native.log')],'install',180,env)
    run(['node','scripts/base-payload.cjs','verify',target,'build/base-payload.json'],'verify-installed-payload',90)
    REPORT['checks'].append('Real EXE silently installs into a Chinese path; every installed payload byte matches its manifest')
    if any(target.rglob('python.exe')) or any(p.suffix.lower() in {'.gguf','.ckpt','.pth','.ogg'} for p in target.rglob('*') if p.is_file()):raise ValueError('Unexpected on-demand runtime or inference weights in the base installation')
    executable=target/'Yukino Companion.exe'
    checkpoint('launch-real-installed-app')
    stdout=(OUT/'app.stdout.log').open('wb');stderr=(OUT/'app.stderr.log').open('wb');HANDLES.extend([stdout,stderr])
    APP=subprocess.Popen([str(executable),'--user-data-dir='+str(profile/'Chromium'),'--enable-logging=stderr','--no-first-run','--remote-debugging-port=0'],cwd=target,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,close_fds=True)
    deadline=time.monotonic()+40;titles=[]
    while time.monotonic()<deadline:
        if APP.poll() is not None:raise RuntimeError('Installed application exited during startup')
        titles=visible_title(APP.pid)
        if 'Yukino Companion' in titles:break
        time.sleep(.25)
    if 'Yukino Companion' not in titles:raise RuntimeError('Installed application did not show its visible main window: '+repr(titles))
    REPORT['visibleWindowTitles']=titles
    run(['node','scripts/verify-installed-window.cjs',profile/'Chromium'],'verify-real-installed-renderer-and-webgl',160)
    if APP.poll() is not None:raise RuntimeError('Installed application exited during renderer verification')
    REPORT['checks'].append('Actual installed application shows its visible main window, loads its real bundled character through IPC and completes a WebGL frame')
    checkpoint('stop-real-installed-app');stop_app()
    sentinel=target/'my-personal-file.txt';sentinel.write_text('keep this synthetic user file',encoding='utf8')
    run([installer,*args,'/LOG='+str(OUT/'upgrade-native.log')],'upgrade',180,env)
    run(['node','scripts/base-payload.cjs','verify',target,'build/base-payload.json'],'verify-upgraded-payload',90)
    if sentinel.read_text(encoding='utf8')!='keep this synthetic user file' or sha(sentinel_profile)!=profile_sha:raise ValueError('Upgrade changed a synthetic preservation sentinel')
    REPORT['checks'].append('Recognized upgrade preserves added files and isolated profile sentinel; upgraded payload matches all manifest bytes')
    unknown=temporary/'unknown personal folder';unknown.mkdir();unknown_file=unknown/'personal.txt';unknown_file.write_text('untouched',encoding='utf8')
    code=run([installer,'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/DIR='+str(unknown),'/LOG='+str(OUT/'reject-native.log')],'reject-unknown-directory',60,env,True)
    if code==0 or unknown_file.read_text(encoding='utf8')!='untouched':raise ValueError('Unknown nonempty directory was not safely rejected')
    REPORT['checks'].append('Unknown nonempty installation directory is rejected without changing its existing file')
    uninstaller=next(target.glob('unins*.exe'))
    run([uninstaller,'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+str(OUT/'uninstall-native.log')],'uninstall',120,env)
    if executable.exists() or (target/'resources/app.asar').exists() or sentinel.read_text(encoding='utf8')!='keep this synthetic user file' or sha(sentinel_profile)!=profile_sha:raise ValueError('Uninstall did not remove owned application payload or preserve synthetic user data')
    REPORT['checks'].append('Real uninstaller removes owned executable/ASAR while preserving added file and isolated profile sentinel')
    REPORT['passed']=True
    checkpoint('checks-passed')


if __name__=='__main__':
    checkpoint('verify-input')
    try:main()
    except Exception as error:
        REPORT['failure']=str(error);print(str(error),file=sys.stderr,flush=True)
    finally:
        try:stop_app()
        except Exception as error:REPORT['stopError']=str(error);REPORT['passed']=False
        checkpoint('finished')
    raise SystemExit(0 if REPORT['passed'] else 1)
