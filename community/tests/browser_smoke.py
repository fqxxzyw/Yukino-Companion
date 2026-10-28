"""Read-only local UI regression. Requires Python Playwright + an installed Chromium.

Run after `node community/build.mjs`:
  python community/tests/browser_smoke.py --browser /usr/bin/chromium
GitHub responses are deterministic test fixtures; no content is published.
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
API = 'https://api.github.com/repos/fqxxzyw/Yukino-Companion'


def issue(number, title, body='', **extra):
    return dict(number=number, title=title, body=body, user={'login': 'test-author'},
                labels=[], created_at='2026-10-27T00:00:00Z', comments=0, state='open', **extra)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run(browser_path):
    handler = functools.partial(QuietHandler, directory=str(ROOT / 'build/community'))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    output = ROOT / 'build/community-qa'
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    calls = []
    status = {'feed': 200, 'help_fail_once': False}
    story = issue(11, '[二创] 测试文章', '### 作品简介\n\n这是一段测试简介。\n\n### 正文\n\n正文内容。')
    voice = issue(12, '[音色] 测试音色', '### 下载链接\n\nhttps://example.com/voice.zip\n\n### SHA-256\n\n' + 'a' * 64 + '\n\n### 模型与版本\n\nGPT-SoVITS v1')

    def mock_github(route):
        url = route.request.url
        calls.append(url)
        assert route.request.method == 'GET', 'Community must remain read-only'
        assert 'authorization' not in route.request.headers, 'No authentication sent to public reads'
        path, query = urlparse(url).path, parse_qs(urlparse(url).query)
        headers = {'Content-Type': 'application/json'}
        code = 200
        if path.endswith('/issues'):
            code = status['feed']
            if query.get('page') == ['2']:
                data = [issue(13, '[建议] 测试建议')]
            else:
                data = [story, voice, issue(20, '普通仓库记录'), issue(21, '[Bug] 拉取请求', pull_request={}),
                        {**issue(22, '[二创] 隐藏内容'), 'labels': [{'name': 'community:hidden'}]}]
                headers['Link'] = f'<{API}/issues?page=2>; rel="next"'
        elif path.endswith('/comments'):
            data = []
        elif path.endswith('/issues/11'):
            data = story
        elif path.endswith('/issues/12'):
            data = voice
        else:
            data, code = {}, 404
        route.fulfill(status=code, headers=headers, body=json.dumps(data, ensure_ascii=False))

    def mock_help(route):
        if status['help_fail_once']:
            status['help_fail_once'] = False
            route.fulfill(status=503, body='unavailable')
        else:
            route.continue_()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=browser_path, headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
            context.route('https://api.github.com/**', mock_github)
            context.route('**/help-content.json', mock_help)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin + '/#home')
            expect(page.locator('.post-card')).to_have_count(2)
            expect(page.locator('#feed-title')).to_have_text('社区内容')
            page.screenshot(path=str(output / 'community-home.png'), full_page=True)
            checks.append('home: real content categories, no PR/ordinary/hidden issue leakage')

            page.get_by_role('tab', name='音色分享').click()
            expect(page.locator('.post-card')).to_have_count(1)
            expect(page.locator('#hero')).to_be_hidden()
            page.locator('#search').fill('no-such-resource')
            expect(page.locator('.empty-state h3')).to_have_text('还没有找到匹配内容')
            page.locator('#search').fill('')
            page.get_by_role('tab', name='全部', exact=True).click()
            page.locator('#load-more').click()
            expect(page.locator('.post-card')).to_have_count(3)
            expect(page.locator('#load-more')).to_be_hidden()
            checks.append('category, search, clear and load-more retain correct feed state')

            page.locator('#hero-publish').dblclick()
            expect(page.locator('#publish-dialog')).to_be_visible()
            page.locator('[data-publish="voice"]').click()
            page.locator('#draft-title').fill('测试 & 标题')
            target = urlparse(page.locator('#publish-continue').get_attribute('href'))
            assert target.netloc == 'github.com'
            assert parse_qs(target.query)['template'] == ['community-voice.yml']
            assert parse_qs(target.query)['title'] == ['[音色] 测试 & 标题']
            page.keyboard.press('Escape')
            expect(page.locator('#publish-dialog')).not_to_be_visible()
            page.locator('#publish-button').click()
            page.locator('.dialog-close').click()
            expect(page.locator('#publish-dialog')).not_to_be_visible()
            page.locator('#publish-button').click()
            page.mouse.click(4, 4)
            expect(page.locator('#publish-dialog')).not_to_be_visible()
            page.locator('#publish-button').click()
            page.evaluate("location.hash='help/api'")
            expect(page.locator('#publish-dialog')).not_to_be_visible()
            checks.append('publish: repeated open, valid GitHub template, Escape/Close/backdrop/route dismissal')

            expect(page.locator('.help-article-heading h2')).to_have_text('对话 API 配置')
            expect(page.locator('.help-reference dt')).to_have_count(4)
            page.screenshot(path=str(output / 'community-help-api.png'), full_page=True)
            route_before = page.url
            page.locator('.skip-link').focus()
            page.locator('.skip-link').press('Enter')
            assert page.url == route_before
            assert page.evaluate('document.activeElement.id') == 'content'
            page.locator('#help-nav a[href="#help/community-api"]').click()
            expect(page.locator('.help-article-heading h2')).to_have_text('社区读取接口')
            expect(page.locator('#help-nav a.active')).to_have_attribute('aria-current', 'page')
            page.go_back()
            expect(page.locator('.help-article-heading h2')).to_have_text('对话 API 配置')
            page.go_forward()
            expect(page.locator('.help-article-heading h2')).to_have_text('社区读取接口')
            page.evaluate("location.hash='help/not-a-section'")
            expect(page.locator('#help-article h2')).to_have_text('未找到帮助章节')
            page.locator('#help-article a[href="#help/start"]').click()
            expect(page.locator('.help-article-heading h2')).to_have_text('安装与首次配置')
            checks.append('help: reference fields, skip-link focus, active navigation, back/forward, unknown route recovery')

            page.evaluate("location.hash='post/12'")
            expect(page.locator('.resource-box')).to_be_visible()
            expect(page.locator('.resource-box .button')).to_have_attribute('href', 'https://example.com/voice.zip')
            expect(page.locator('.comment-empty')).to_have_text('暂无评论。可在 GitHub 登录后评论。')
            page.locator('.back-link').click()
            expect(page.locator('.post-card')).to_have_count(3)
            checks.append('resource detail and empty comments remain functional; return preserves loaded feed')

            status['feed'] = 429
            page.locator('#refresh').click()
            expect(page.locator('#feed-notice')).to_contain_text('限制访问频率')
            expect(page.locator('.post-card')).to_have_count(3)
            status['feed'] = 200
            page.locator('#refresh').click()
            expect(page.locator('#feed-notice')).to_have_text('')
            expect(page.locator('.post-card')).to_have_count(2)
            checks.append('rate-limit error preserves loaded content; refresh recovers')

            status['help_fail_once'] = True
            retry = context.new_page()
            retry.on('pageerror', lambda error: errors.append(str(error)))
            retry.goto(origin + '/#help/download')
            expect(retry.locator('#help-article h2')).to_have_text('帮助文档暂时无法读取')
            retry.locator('#retry-help').click()
            expect(retry.locator('.help-article-heading h2')).to_have_text('资源下载与故障处理')
            retry.close()
            checks.append('help network failure recovers via retry with correct deep link')

            for width in [390, 320]:
                page.set_viewport_size({'width': width, 'height': 844})
                page.evaluate("location.hash='help/community-api'")
                expect(page.locator('.help-article-heading h2')).to_have_text('社区读取接口')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'help overflow at {width}'
                page.screenshot(path=str(output / f'community-help-mobile-{width}.png'), full_page=True)
                page.evaluate("location.hash='home'")
                expect(page.locator('#hero')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'home overflow at {width}'
                page.locator('#hero-publish').click()
                expect(page.locator('#publish-dialog')).to_be_visible()
                assert page.locator('#publish-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'), f'dialog overflow at {width}'
                page.keyboard.press('Escape')
            checks.append('320px/390px: home, reference, horizontally scrolling code/nav and publish dialog fit viewport')
            assert not errors, '\n'.join(errors)
            checks.append('no browser JavaScript errors; all GitHub fixture requests are unauthenticated GET')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    result = {'checks': checks, 'requests': len(calls), 'screenshots': str(output)}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', default='/usr/bin/chromium')
    run(parser.parse_args().browser)
