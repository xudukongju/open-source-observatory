#!/usr/bin/env python3
"""Collect public GitHub evidence via the authenticated official gh CLI.

No tokens are read, written or copied by this program. GitHub Actions supplies
GH_TOKEN to gh; local use reuses gh's ordinary login. Partial failures retain
last-good source timestamps, not a fabricated zero or a fresh success time.
"""
import datetime as dt
import json
import os
import pathlib
import subprocess
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
GH = os.environ.get('GH_BIN', 'gh')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def api(path, query=None):
    args = [GH, 'api', path]
    if query is not None:
        args += ['-f', 'query=' + query]
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90, universal_newlines=True)
    if r.returncode:
        # Do not publish arbitrary CLI stderr, which may include environment details.
        raise RuntimeError('GitHub API 请求失败；请检查采集工作流与来源访问状态')
    result = json.loads(r.stdout)
    if isinstance(result, dict) and result.get('errors'):
        raise RuntimeError('GitHub GraphQL 返回错误')
    return result


def pages(path):
    result = []
    sep = '&' if '?' in path else '?'
    for page in range(1, 101):
        chunk = api(path + sep + 'per_page=100&page=' + str(page))
        result.extend(chunk)
        if len(chunk) < 100:
            return result
    raise RuntimeError('数据超过分页上限；需扩大采集范围后再报告完整数据')


def source(previous, fn, checked):
    try:
        return {'ok': True, 'checked_at': checked, 'observed_at': checked, 'value': fn(), 'error': None}
    except Exception as exc:
        return {'ok': False, 'checked_at': checked,
                'observed_at': previous.get('observed_at'), 'value': previous.get('value'),
                'error': str(exc) if isinstance(exc, RuntimeError) else '来源采集失败；保留最后成功快照'}


def feedback_state(author, comments, account, closed=False):
    external = [c for c in comments if c.get('author') and c['author'] != account]
    owner = [c for c in comments if c.get('author') == account]
    if closed:
        return 'closed'
    if author == account and not external:
        return 'watching'
    last_external = max([c['created_at'] for c in external] or [''])
    last_owner = max([c['created_at'] for c in owner] or [''])
    return 'replied' if last_owner and last_owner > last_external else 'needs_reply'


def issues(repo, account):
    result = []
    for issue in pages('repos/' + repo + '/issues?state=all&sort=updated&direction=desc'):
        if 'pull_request' in issue:
            continue
        cs = pages('repos/' + repo + '/issues/' + str(issue['number']) + '/comments') if issue['comments'] else []
        comments = [{'author': (c.get('user') or {}).get('login'), 'created_at': c['created_at']} for c in cs]
        author = (issue.get('user') or {}).get('login')
        result.append({'id': issue['html_url'], 'url': issue['html_url'], 'title': issue['title'], 'author': author,
            'created_at': issue['created_at'], 'updated_at': issue['updated_at'], 'kind': 'issue',
            'state': feedback_state(author, comments, account, issue['state'] == 'closed'),
            'comments': len(cs), 'external_comments': sum(c['author'] != account for c in comments),
            'state_reason': issue.get('state_reason')})
    return result


def discussion(item, account):
    owner, repo = item['repo'].split('/')
    # JSON literals provide GraphQL-safe quoting. All paginated replies are read.
    base = 'repository(owner:%s,name:%s){discussion(number:%d)' % (json.dumps(owner), json.dumps(repo), item['number'])
    comments, cursor, meta = [], None, None
    while True:
        after = ',after:' + json.dumps(cursor) if cursor else ''
        q = 'query{' + base + '{title url createdAt updatedAt upvoteCount comments(first:100' + after + '){pageInfo{hasNextPage endCursor} nodes{id url bodyText createdAt author{login} replies(first:100){pageInfo{hasNextPage endCursor} nodes{url bodyText createdAt author{login}}}}}}}}'
        node = api('graphql', q)['data']['repository']['discussion']
        if not node:
            raise RuntimeError('推广讨论不存在或不可读')
        meta = node
        for c in node['comments']['nodes']:
            replies = c['replies']['nodes'][:]
            page = c['replies']['pageInfo']
            while page['hasNextPage']:
                rq = 'query{node(id:%s){... on DiscussionComment{replies(first:100,after:%s){pageInfo{hasNextPage endCursor} nodes{url bodyText createdAt author{login}}}}}}' % (json.dumps(c['id']), json.dumps(page['endCursor']))
                rr = api('graphql', rq)['data']['node']['replies']
                replies.extend(rr['nodes'])
                page = rr['pageInfo']
            author = (c.get('author') or {}).get('login')
            normalized = [{'author': (r.get('author') or {}).get('login'), 'created_at': r['createdAt']} for r in replies]
            comments.append({'id': c['url'], 'url': c['url'], 'title': c['bodyText'][:180] or '（空评论）',
                'author': author, 'kind': 'discussion', 'created_at': c['createdAt'],
                'updated_at': max([c['createdAt']] + [r['createdAt'] for r in replies]),
                'comments': len(replies), 'external_comments': sum(r['author'] != account for r in normalized),
                'state': feedback_state(author, normalized, account)})
        page = node['comments']['pageInfo']
        if not page['hasNextPage']:
            break
        cursor = page['endCursor']
    return {'url': meta['url'], 'title': meta['title'], 'channel': item['channel'],
            'upvotes': meta['upvoteCount'], 'comments': comments,
            'comment_count': sum(1 + c['comments'] for c in comments), 'updated_at': meta['updatedAt']}


def metrics(repo):
    r = api('repos/' + repo)
    return {k: r[k] for k in ['stargazers_count', 'forks_count', 'subscribers_count', 'pushed_at', 'archived']}


def releases(repo):
    return [{'tag': r['tag_name'], 'url': r['html_url'], 'published_at': r['published_at'],
             'prerelease': r['prerelease'], 'assets': [{'name': a['name'], 'downloads': a['download_count']} for a in r['assets']]}
            for r in pages('repos/' + repo + '/releases') if not r['draft']]


def merge_history(*histories):
    rows = {(h['project'], h['at']): h for history in histories for h in history}
    return sorted(rows.values(), key=lambda h: h['at'])


def cloud_snapshot(url):
    if url != 'https://xiaosong-observatory-collector.xudukongju.workers.dev/snapshot':
        raise ValueError('Unexpected collector URL')
    with urllib.request.urlopen(url, timeout=20) as response:
        data = json.load(response)
    if (data.get('schema') != 1 or data.get('collector') != 'cloudflare-cron'
            or not all(isinstance(data.get(k), list) for k in ('projects', 'history', 'releases', 'followups'))):
        raise ValueError('Invalid cloud snapshot')
    dt.datetime.fromisoformat(data['generated_at'].replace('Z', '+00:00'))
    return data


def source_failures(data):
    return sum(not s['ok'] for p in data['projects'] for s in [p['metrics'], p['releases'], p['issues']] + p['promotions'])


def collect(root=ROOT, cloud_url=None):
    registry = json.loads((root / 'data/registry.json').read_text())
    ledger = json.loads((root / 'data/releases.json').read_text())
    path = root / 'data/snapshot.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    if cloud_url:
        try:
            cloud = cloud_snapshot(cloud_url)
            cloud['history'] = merge_history(old.get('history', []), cloud['history'])
            age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(cloud['generated_at'].replace('Z', '+00:00'))
            configs = [{k: v for k, v in p.items() if k not in ('metrics', 'releases', 'issues', 'promotions')} for p in cloud['projects']]
            if (dt.timedelta(0) <= age <= dt.timedelta(minutes=45)
                    and configs == registry['projects'] and cloud['releases'] == ledger['entries']
                    and cloud['followups'] == registry.get('followups', [])
                    and cloud['generated_at'] >= old.get('generated_at', '')):
                cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90)).isoformat().replace('+00:00', 'Z')
                cloud['history'] = [h for h in cloud['history'] if h['at'] >= cutoff]
                path.write_text(json.dumps(cloud, ensure_ascii=False, indent=2) + '\n')
                print('Archived actual Cloudflare observation: ' + cloud['generated_at'])
                return source_failures(cloud)
            old['history'] = cloud['history']
        except Exception:
            print('Cloud snapshot unavailable; using GitHub collector fallback')
    checked = now()
    prev = {p['id']: p for p in old.get('projects', [])}
    projects = []
    for config in registry['projects']:
        p = dict(config)
        before = prev.get(p['id'], {})
        repo = p['repo']
        p['metrics'] = source(before.get('metrics', {}), lambda: metrics(repo), checked)
        p['releases'] = source(before.get('releases', {}), lambda: releases(repo), checked)
        p['issues'] = source(before.get('issues', {}), lambda: issues(repo, registry['account']), checked)
        p['promotions'] = []
        for d in config.get('discussions', []):
            key = d['repo'] + '#' + str(d['number'])
            prior = next((x for x in before.get('promotions', []) if x['key'] == key), {})
            p['promotions'].append(dict(source(prior, lambda: discussion(d, registry['account']), checked), key=key))
        projects.append(p)
    history = old.get('history', [])
    for p in projects:
        if p['metrics']['ok']:
            history.append({'at': checked, 'project': p['id'], 'stars': p['metrics']['value']['stargazers_count'],
                            'forks': p['metrics']['value']['forks_count']})
    # Preserve 90 days of time-stamped observations; never infer a pre-launch zero.
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90)).isoformat().replace('+00:00', 'Z')
    history = [h for h in history if h['at'] >= cutoff]
    result = {'schema': 1, 'generated_at': checked, 'account': registry['account'], 'timezone': registry['timezone'],
              'collection_interval_minutes': 15, 'projects': projects, 'releases': ledger['entries'],
              'followups': registry.get('followups', []), 'history': history}
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    errors = source_failures(result)
    print('Snapshot: %d project(s), %d source failure(s)' % (len(projects), errors))
    return errors


if __name__ == '__main__':
    failures = collect(cloud_url=os.environ.get('CLOUD_SNAPSHOT_URL'))
    # Snapshot is still committed by workflow (partial failure evidence matters).
    raise SystemExit(1 if failures else 0)
