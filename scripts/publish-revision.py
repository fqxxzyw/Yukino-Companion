"""Publish only a tested revision installer; never publish separate visual models."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

BRANCH = 'fix/private-model-release-20261030'
INSTALLER = 'Yukino-Companion-0.4.0-Base-Setup.exe'


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def check_runs(payload, commit, branch=BRANCH):
    runs = [r for r in payload.get('workflow_runs', [])
            if r.get('head_sha') == commit and r.get('head_branch') == branch and r.get('event') == 'push']
    if not runs:
        return None
    run = max(runs, key=lambda item: (item.get('created_at', ''), item.get('id', 0)))
    return {'id':run['id'], 'status':run.get('status'), 'conclusion':run.get('conclusion'), 'url':run.get('html_url')}


def validate_inputs(root, commit, tree, run_id):
    source=read_json(root/'release/candidate-source.json')
    installer=root/'release'/INSTALLER
    if (source.get('commit'),source.get('tree'),str(source.get('runId'))) != (commit,tree,run_id):
        raise ValueError('Candidate source/tree/run mismatch')
    if source.get('installer') != INSTALLER or source.get('bytes') != installer.stat().st_size or source.get('sha256') != digest(installer):
        raise ValueError('Candidate installer bytes differ from its source record')
    if source.get('completeFeatureAcceptance') is not False or source.get('nativeInstallLaunchUpgradeUninstall') is not False:
        raise ValueError('Candidate must retain its original pending-validation record')
    package=read_json(root/'build/base-package.json')
    if package.get('characterModelsEmbedded') is not True or package.get('characterVariants') != 17 or package.get('characterOutfits') != 7:
        raise ValueError('Candidate does not attest all seven outfits and 17 bundled variants')
    smoke=read_json(root/'build/native-smoke-evidence/report.json')
    if smoke.get('passed') is not True or smoke.get('fixtureOnly') is not False:
        raise ValueError('The native installer validation did not pass')
    sums=(root/'release/SHA256SUMS.txt').read_text(encoding='utf-8-sig').strip()
    if sums != source['sha256']+'  '+INSTALLER:
        raise ValueError('Installer checksum file does not match')
    paths=[installer,root/'release/base-installer.json',root/'release/candidate-source.json',
           root/'release/SHA256SUMS.txt',root/'build/base-package.json',root/'build/base-payload.json']
    return source, paths


def run_status(repo, workflow, commit):
    return check_runs(json.loads(gh('api','--method','GET',f'repos/{repo}/actions/workflows/{workflow}/runs',
                                     '-f',f'head_sha={commit}','-f','event=push','-f','per_page=100')),commit)


def current_head(repo):
    ref=json.loads(gh('api',f'repos/{repo}/git/ref/heads/{BRANCH}'))
    return ref['object']['sha']


def wait_for_check(repo, commit, timeout=1500):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        check=run_status(repo,'windows-revision-check.yml',commit)
        if check and check['status']=='completed':
            if check['conclusion']!='success':
                raise ValueError('Windows revision check failed or was cancelled')
            return check
        time.sleep(15)
    raise TimeoutError('Windows revision check did not complete for this exact commit')


def publish(root=Path('.'), env=os.environ):
    if env.get('GITHUB_EVENT_NAME')!='push' or env.get('GITHUB_REF')!='refs/heads/'+BRANCH:
        raise ValueError('Publication is restricted to the explicitly authorized branch push')
    commit,run_id,repo=env['GITHUB_SHA'],env['GITHUB_RUN_ID'],env['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[0-9a-f]{40}',commit) or not re.fullmatch(r'\d+',run_id):
        raise ValueError('Invalid source identity')
    tree=subprocess.run(['git','rev-parse','HEAD^{tree}'],check=True,capture_output=True,text=True).stdout.strip()
    checked_out=subprocess.run(['git','rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()
    files=subprocess.run(['git','ls-tree','-r','--name-only','HEAD'],check=True,capture_output=True,text=True).stdout.splitlines()
    if checked_out!=commit or any(re.search(r'\.(?:glb|gltf|vrm|fbx)(?:\.gz)?$',name,re.I) for name in files):
        raise ValueError('Checked-out source is wrong or exposes standalone models')
    source,paths=validate_inputs(root,commit,tree,run_id)
    check=wait_for_check(repo,commit)
    if current_head(repo)!=commit:
        raise ValueError('Authorized branch moved since this build; refusing stale publication')
    inference=run_status(repo,'inference-checks.yml',commit)
    inference_text=(f"{inference['status']} / {inference['conclusion']} ({inference['url']})" if inference else '未找到同一提交的运行记录')
    tag='v0.4.0-test.'+run_id
    notes=root/'build/revision-release-notes.md'
    notes.write_text(f'''Windows 安装测试版，源码 `{commit}`。安装器内含七套服装、17 个视觉版本；大型语言模型、翻译、音色和运行环境按需下载。01 泳装版本仍为待审不可选状态。\n\n本次同一提交的 Windows 源码/界面检查及安装、启动、升级、卸载自动检查已通过；独立评审模型不可用时，眨眼评审测试明确跳过。桌宠真实拖动、多屏 DPI、实体 GPU、摄像头、语音真实播放与口型同步、完整功能仍待验收。安装器签名状态：`{source.get('signatureStatus','unknown')}`。\n\n[候选与原生测试](https://github.com/{repo}/actions/runs/{run_id})；[Windows 修订检查]({check['url']})。其他集成检查状态：{inference_text}。\n''',encoding='utf8')
    expected={p.name:{'size':p.stat().st_size,'digest':'sha256:'+digest(p)} for p in paths}
    gh('release','create',tag,*map(str,paths),'--repo',repo,'--draft','--prerelease','--target',commit,
       '--title',f'Yukino Companion 0.4.0 Windows 修订测试版 · {run_id}（待验收）','--notes-file',str(notes))
    releases=json.loads(gh('api',f'repos/{repo}/releases?per_page=100'))
    matches=[item for item in releases if item.get('tag_name')==tag]
    if len(matches)!=1:
        raise ValueError('Cannot uniquely identify new draft')
    release_id=matches[0]['id']
    remote=json.loads(gh('api',f'repos/{repo}/releases/{release_id}'))
    if remote.get('draft') is not True or remote.get('prerelease') is not True or remote.get('target_commitish')!=commit:
        raise ValueError('Draft identity mismatch')
    assets=remote.get('assets',[])
    if len(assets)!=len(expected) or {a['name'] for a in assets}!=set(expected):
        raise ValueError('Unexpected draft asset inventory')
    for asset in assets:
        if {k:asset.get(k) for k in ['size','digest']}!=expected[asset['name']]:
            raise ValueError('Draft asset checksum mismatch: '+asset['name'])
    # Recheck after draft upload: a newer commit or failed rerun must not publish.
    latest=run_status(repo,'windows-revision-check.yml',commit)
    if current_head(repo)!=commit or not latest or latest['status']!='completed' or latest['conclusion']!='success':
        raise ValueError('Source branch or Windows check changed; draft remains unpublished')
    gh('api','--method','PATCH',f'repos/{repo}/releases/{release_id}','-F','draft=false','-F','prerelease=true','-f','make_latest=false')
    result=json.loads(gh('api',f'repos/{repo}/releases/{release_id}'))
    if result.get('draft') is not False or result.get('prerelease') is not True:
        raise ValueError('Release visibility verification failed')
    print(result['html_url'])


if __name__ == '__main__':
    publish()
