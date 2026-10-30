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
    package = json.loads((root/'build/base-package.json').read_text(encoding='utf-8-sig'))
    logos = package.get('providerLogos', {})
    missing_logos = ', '.join(logos.get('missing', [])) if 'missing' in logos else '未记录'
    notes.write_text(f'''Windows 安装测试版，源码 `{commit}`。\n\n本版在现有架构上加入统一 API 管理、任务路由、中文配置教程与可跳过的语音聊天向导；保留本地 GPT-SoVITS，加入独立权重与参考音频检查。壁纸现可调整不透明度，轮播和扩散沿用设置。阿里云实时 ASR 协议已实现，但真实云端语音链路尚未通过账户和麦克风验收；其他未完成适配的服务商明确标记待接入。\n\n安装器内置现有七套人物服装、17 个视觉版本及两张默认壁纸。01 的现有未通过/不可选状态保留。语言模型、翻译、音色和公共推理环境在应用内按需下载；下载就绪不代表推理已验证。官方品牌图标打包缺失项：{missing_logos}；缺失项保留文字回退。\n\n**完整功能验收尚未完成。按用户要求提供下载：安装、启动、升级、卸载状态请查看同一构建的检查记录。实体 NVIDIA GPU、真实 ASR/API、Windows 麦克风、摄像头、日语语音实际播放、口型和眨眼尚未确认通过。** 安装器摘要不代表签名或安全扫描。签名状态：`{source['signatureStatus']}`。\n\n[本次构建及后续检查](https://github.com/{repo}/actions/runs/{run_id})。`SHA256SUMS.txt` 提供安装器摘要；其余附件记录源码和实际 payload。\n''', encoding='utf8')
    gh('release','create',tag,*map(str,paths),'--repo',repo,'--draft','--prerelease','--target',commit,'--title',f'Yukino Companion 0.4.0 Windows 安装测试版 · {run_id}（待验收）','--notes-file',str(notes))
    # A draft may have no tag ref yet; lookup by tag can return 404.
    releases = json.loads(gh('api',f'repos/{repo}/releases?per_page=100'))
    matches = [item for item in releases if item.get('tag_name') == tag]
    if len(matches) != 1:
        raise ValueError('Cannot uniquely identify the newly created draft')
    release_id = matches[0]['id']
    remote = json.loads(gh('api',f'repos/{repo}/releases/{release_id}'))
    if remote.get('draft') is not True or remote.get('prerelease') is not True or remote.get('target_commitish') != commit:
        raise ValueError('Unexpected draft identity; leaving release unpromoted')
    assets = remote.get('assets', [])
    if len(assets) != len(expected) or {a['name'] for a in assets} != set(expected):
        raise ValueError('Unexpected draft asset inventory')
    for item in assets:
        if {k:item.get(k) for k in ['size','digest']} != expected[item['name']]:
            raise ValueError('Remote candidate asset mismatch: '+item['name'])
    gh('api','--method','PATCH',f'repos/{repo}/releases/{release_id}','-F','draft=false','-F','prerelease=true','-f','make_latest=false')
    visible = json.loads(gh('api',f'repos/{repo}/releases/{release_id}'))
    if visible.get('draft') is not False or visible.get('prerelease') is not True:
        raise ValueError('Prerelease visibility readback failed')
    result = {'tag':tag,'url':visible['html_url'],'commit':commit,'runId':run_id,'validation':'pending','files':expected}
    (root/'build/candidate-publication.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(result['url'])
    return result


if __name__ == '__main__':
    publish()
