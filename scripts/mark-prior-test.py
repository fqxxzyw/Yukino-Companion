"""Mark only this task's previous test prerelease after a verified successor is public."""
import json
import os
import subprocess

REPOSITORY='fqxxzyw/Yukino-Companion'
OLD_ID=426859288
OLD_TAG='v0.4.0-test.40717231124'
OLD_SOURCE='311c88fc4d5d8501deedeb3916e3a69753777663'
MARKER='<!-- yukino-asar-model-load-known-issue -->'


def gh(*args):
    return subprocess.run(['gh',*args],check=True,capture_output=True,text=True).stdout


def mark(env=os.environ,call=gh):
    if env['GITHUB_REPOSITORY']!=REPOSITORY or env['GITHUB_REF']!='refs/heads/handoff/codex-current-20261028':
        raise ValueError('Wrong repository or branch')
    old=json.loads(call('api',f'repos/{REPOSITORY}/releases/{OLD_ID}'))
    if old.get('tag_name')!=OLD_TAG or old.get('draft') or not old.get('prerelease') or OLD_SOURCE not in (old.get('body') or ''):
        raise ValueError('Previous release identity mismatch')
    if MARKER in old['body']:return
    new_tag='v0.4.0-test.'+env['GITHUB_RUN_ID']
    new=json.loads(call('api',f'repos/{REPOSITORY}/releases/tags/{new_tag}'))
    if new.get('draft') or not new.get('prerelease') or new.get('target_commitish')!=env['GITHUB_SHA']:
        raise ValueError('Successor release is not the expected public prerelease')
    body=old['body']+f'''\n\n{MARKER}\n**已发现问题：此版安装后内置 3D 人物可能无法显示。** 安装、升级和卸载检查通过，但随后查看真实日志发现 ASAR 模型读取错误。请使用[后续测试版]({new['html_url']})并查看其验收状态；本版链接保留。\n'''
    call('api','--method','PATCH',f'repos/{REPOSITORY}/releases/{OLD_ID}','-f','body='+body)
    updated=json.loads(call('api',f'repos/{REPOSITORY}/releases/{OLD_ID}'))
    if updated.get('body')!=body:raise ValueError('Prior release note readback mismatch')


if __name__=='__main__':mark()
