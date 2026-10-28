"""Publish one exact installer as an explicitly unvalidated prerelease.

No replacement, deletion, mirroring or stable-release promotion is supported.
Remote bytes must match before a newly created draft becomes visible.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run_gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout


def publish(root=Path('.'), env=os.environ, gh=run_gh):
    commit, run_id, repo = env['GITHUB_SHA'], env['GITHUB_RUN_ID'], env['GITHUB_REPOSITORY']
    source = json.loads((root/'release/candidate-source.json').read_text(encoding='utf-8-sig'))
    if source['commit'] != commit or source['runId'] != run_id:
        raise ValueError('Candidate source/run mismatch')
    installer = root/'release/Yukino-Companion-0.4.0-Base-Setup.exe'
    if source['installer'] != installer.name or source['bytes'] != installer.stat().st_size or source['sha256'] != sha(installer):
        raise ValueError('Installer bytes differ from candidate identity')
    if source.get('nativeInstallLaunchUpgradeUninstall') is not False or source.get('completeFeatureAcceptance') is not False:
        raise ValueError('This publication path must identify pending validation honestly')
    paths = [installer, root/'release/base-installer.json', root/'release/candidate-source.json', root/'release/SHA256SUMS.txt', root/'build/base-package.json', root/'build/base-payload.json']
    expected = {p.name: {'size': p.stat().st_size, 'digest': 'sha256:'+sha(p)} for p in paths}
    tag = 'v0.4.0-test.'+run_id
    notes = root/'build/candidate-release-notes.md'
    notes.write_text(f'''Windows 安装测试版，源码 `{commit}`。\n\n这是可安装的 Setup.exe，安装器内置现有七套人物服装、17 个视觉版本。01 的现有未通过/不可选状态保留。语言模型、翻译、音色和公共推理环境仍在应用内按需下载，安装过程不下载这些资源。108 项新动作不在本版内。\n\n**按用户要求先提供下载：安装、启动、升级、卸载和完整功能验收尚未完成。** 源码与包内模型摘要已核对，摘要不代表签名或安全扫描。安装器签名状态：`{source['signatureStatus']}`。不要将本测试版视为全部功能已验收。\n\n[本次构建及后续检查](https://github.com/{repo}/actions/runs/{run_id})。`SHA256SUMS.txt` 提供安装器摘要；其余附件记录源码和实际 payload。\n''', encoding='utf8')
    gh('release','create',tag,*map(str,paths),'--repo',repo,'--draft','--prerelease','--target',commit,'--title',f'Yukino Companion 0.4.0 Windows 安装测试版 · {run_id}（待验收）','--notes-file',str(notes))
    remote = json.loads(gh('api',f'repos/{repo}/releases/tags/{tag}'))
    if remote.get('draft') is not True or remote.get('prerelease') is not True or remote.get('target_commitish') != commit:
        raise ValueError('Unexpected draft identity; leaving release unpromoted')
    assets = remote.get('assets', [])
    if len(assets) != len(expected) or {a['name'] for a in assets} != set(expected):
        raise ValueError('Unexpected draft asset inventory')
    for item in assets:
        if {k:item.get(k) for k in ['size','digest']} != expected[item['name']]:
            raise ValueError('Remote candidate asset mismatch: '+item['name'])
    gh('release','edit',tag,'--repo',repo,'--draft=false','--prerelease','--latest=false')
    visible = json.loads(gh('api',f'repos/{repo}/releases/tags/{tag}'))
    if visible.get('draft') is not False or visible.get('prerelease') is not True:
        raise ValueError('Prerelease visibility readback failed')
    result = {'tag':tag,'url':visible['html_url'],'commit':commit,'runId':run_id,'validation':'pending','files':expected}
    (root/'build/candidate-publication.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(result['url'])
    return result


if __name__ == '__main__':
    publish()
