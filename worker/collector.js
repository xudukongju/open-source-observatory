// Public GitHub evidence only. Authentication stays in a Cloudflare Secret.
export const ROOT = 'https://raw.githubusercontent.com/xudukongju/open-source-observatory/main/data/';
const LIMIT = 100;
const repoName = name => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) throw Error('Invalid repository');
  return name;
};
export function githubClient(token, fetcher = (...args) => fetch(...args)) {
  return async (path, query) => {
    if (path !== 'graphql' && !/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|\?|$)/.test(path)) throw Error('Invalid API path');
    const response = await fetcher('https://api.github.com/' + path, {
      method: query ? 'POST' : 'GET', redirect: 'manual',
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
        'User-Agent': 'xudukongju-observatory', ...(query ? {'Content-Type': 'application/json'} : {})},
      ...(query ? {body: JSON.stringify({query})} : {}), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('GitHub HTTP ' + response.status);
    const data = await response.json();
    if (data?.errors) throw Error('GitHub GraphQL failure');
    return data;
  };
}
export async function pages(api, path) {
  const result = [];
  for (let page = 1; page <= LIMIT; page++) {
    const batch = await api(path + (path.includes('?') ? '&' : '?') + `per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('Invalid GitHub page');
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw Error('Pagination limit reached');
}
export function feedbackState(author, comments, account, closed = false) {
  if (closed) return 'closed';
  const external = comments.filter(c => c.author && c.author !== account);
  const owner = comments.filter(c => c.author === account);
  if (author === account && !external.length) return 'watching';
  const latest = list => list.map(c => c.created_at).sort().at(-1) || '';
  return owner.length && latest(owner) > latest(external) ? 'replied' : 'needs_reply';
}
export async function source(previous = {}, fn, checked) {
  try { return {ok: true, checked_at: checked, observed_at: checked, value: await fn(), error: null}; }
  catch { return {ok: false, checked_at: checked, observed_at: previous.observed_at ?? null,
    value: previous.value ?? null, error: '来源读取失败；保留最后成功值与原始时间'}; }
}
export async function issues(api, repo, account) {
  const result = [];
  for (const issue of await pages(api, `repos/${repoName(repo)}/issues?state=all&sort=updated&direction=desc`)) {
    if (issue.pull_request) continue;
    const cs = issue.comments ? await pages(api, `repos/${repo}/issues/${issue.number}/comments`) : [];
    const comments = cs.map(c => ({author: c.user?.login, created_at: c.created_at}));
    const author = issue.user?.login;
    result.push({id: issue.html_url, url: issue.html_url, title: issue.title, author,
      created_at: issue.created_at, updated_at: issue.updated_at, kind: 'issue',
      state: feedbackState(author, comments, account, issue.state === 'closed'),
      comments: cs.length, external_comments: comments.filter(c => c.author && c.author !== account).length,
      state_reason: issue.state_reason ?? null});
  }
  return result;
}
function advance(page, seen) {
  if (!page.hasNextPage) return null;
  if (!page.endCursor || seen.has(page.endCursor)) throw Error('Invalid pagination cursor');
  seen.add(page.endCursor);
  return page.endCursor;
}
export async function discussion(api, item, account) {
  const [owner, repo] = repoName(item.repo).split('/');
  if (!Number.isSafeInteger(item.number) || item.number < 1) throw Error('Invalid discussion');
  const comments = [], seen = new Set();
  let cursor = null, meta;
  for (let count = 0; count < LIMIT; count++) {
    const after = cursor ? ',after:' + JSON.stringify(cursor) : '';
    const q = `query{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}){isPrivate discussion(number:${item.number}){title url createdAt updatedAt upvoteCount comments(first:100${after}){pageInfo{hasNextPage endCursor} nodes{id url bodyText createdAt author{login} replies(first:100){pageInfo{hasNextPage endCursor} nodes{url bodyText createdAt author{login}}}}}}}}`;
    const repository = (await api('graphql', q)).data?.repository;
    if (repository?.isPrivate !== false) throw Error('Public discussion required');
    const node = repository.discussion;
    if (!node) throw Error('Discussion unavailable');
    meta = node;
    for (const c of node.comments.nodes) {
      const replies = [...c.replies.nodes], replySeen = new Set();
      let next = advance(c.replies.pageInfo, replySeen);
      for (let n = 0; next && n < LIMIT; n++) {
        const rq = `query{node(id:${JSON.stringify(c.id)}){... on DiscussionComment{replies(first:100,after:${JSON.stringify(next)}){pageInfo{hasNextPage endCursor} nodes{url bodyText createdAt author{login}}}}}}`;
        const page = (await api('graphql', rq)).data.node.replies;
        replies.push(...page.nodes); next = advance(page.pageInfo, replySeen);
      }
      if (next) throw Error('Reply pagination limit reached');
      const normalized = replies.map(r => ({author: r.author?.login, created_at: r.createdAt}));
      const author = c.author?.login;
      comments.push({id: c.url, url: c.url, title: c.bodyText.slice(0,180) || '（空评论）', author,
        kind: 'discussion', created_at: c.createdAt,
        updated_at: [c.createdAt, ...replies.map(r => r.createdAt)].sort().at(-1),
        comments: replies.length, external_comments: normalized.filter(r => r.author && r.author !== account).length,
        state: feedbackState(author, normalized, account)});
    }
    cursor = advance(node.comments.pageInfo, seen);
    if (!cursor) return {url: meta.url, title: meta.title, channel: item.channel, upvotes: meta.upvoteCount,
      comments, comment_count: comments.reduce((n,c) => n + 1 + c.comments,0), updated_at: meta.updatedAt};
  }
  throw Error('Discussion pagination limit reached');
}
export function mergeHistory(...histories) {
  const result = new Map();
  for (const row of histories.flat()) result.set(JSON.stringify([row.project, row.at]), row);
  return [...result.values()].sort((a,b) => a.at.localeCompare(b.at));
}
export async function collect(registry, ledger, previous, api, checked = new Date().toISOString()) {
  if (registry.account !== 'xudukongju' || !Array.isArray(registry.projects) || !Array.isArray(ledger.entries)) throw Error('Invalid registry');
  const projects = [];
  for (const config of registry.projects) {
    const repo = repoName(config.repo), before = previous.projects?.find(p => p.id === config.id) || {};
    const p = {...config};
    let publicRepo = false;
    p.metrics = await source(before.metrics, async () => {
      const r = await api(`repos/${repo}`);
      if (r.private !== false) throw Error('Public repository required');
      publicRepo = true;
      return Object.fromEntries(['stargazers_count','forks_count','subscribers_count','pushed_at','archived'].map(k => [k,r[k]]));
    }, checked);
    const publicAPI = (...args) => { if (!publicRepo) throw Error('Public visibility not verified'); return api(...args); };
    p.releases = await source(before.releases, async () => (await pages(publicAPI, `repos/${repo}/releases`)).filter(r => !r.draft).map(r => ({
      tag:r.tag_name,url:r.html_url,published_at:r.published_at,prerelease:r.prerelease,
      assets:r.assets.map(a => ({name:a.name,downloads:a.download_count}))})), checked);
    p.issues = await source(before.issues, () => issues(publicAPI, repo, registry.account), checked);
    p.promotions = [];
    for (const d of config.discussions || []) {
      const key = d.repo + '#' + d.number, prior = before.promotions?.find(s => s.key === key);
      p.promotions.push({...await source(prior, () => discussion(api, d, registry.account), checked), key});
    }
    projects.push(p);
  }
  const cutoff = new Date(Date.parse(checked) - 90 * 86400000).toISOString();
  const added = projects.filter(p => p.metrics.ok).map(p => ({at:checked,project:p.id,
    stars:p.metrics.value.stargazers_count,forks:p.metrics.value.forks_count}));
  return {schema:1,generated_at:checked,account:registry.account,timezone:registry.timezone,
    collection_interval_minutes:15,collector:'cloudflare-cron',projects,releases:ledger.entries,
    followups:registry.followups || [],history:mergeHistory(previous.history || [],added).filter(h => h.at >= cutoff)};
}
export function failures(data) {
  return data.projects.flatMap(p => [p.metrics,p.releases,p.issues,...p.promotions]).filter(s => !s.ok).length;
}
async function publicJSON(name, fetcher) {
  let r;
  try {
    r = await fetcher(ROOT + name, {signal:AbortSignal.timeout(15000),redirect:'manual',headers:{'Cache-Control':'no-cache'},cf:{cacheTtl:0}});
  } catch (cause) {
    const error = Error('Public configuration fetch failed');
    error.publicCode = /illegal invocation|incorrect.*this/i.test(cause.message) ? 'config_fetch_context' : 'config_fetch_failed';
    error.publicSource = name;
    throw error;
  }
  if (!r.ok) {
    const error = Error('Public configuration unavailable');
    error.publicCode = 'config_http_' + r.status;
    error.publicSource = name;
    throw error;
  }
  return r.json();
}
export async function scheduledRun(event, env, fetcher = (...args) => fetch(...args)) {
  const attempted = new Date().toISOString();
  let stage = 'authorization';
  try {
    if (!env.GITHUB_READ_TOKEN) throw Error('missing_read_token');
    stage = 'configuration';
    const [registry, ledger, archived, cached] = await Promise.all([
      publicJSON('registry.json',fetcher),publicJSON('releases.json',fetcher),
      publicJSON('snapshot.json',fetcher),env.OBSERVATORY.get('snapshot','json')]);
    const previous = cached && Date.parse(cached.generated_at) >= Date.parse(archived.generated_at) ? cached : archived;
    previous.history = mergeHistory(archived.history || [],cached?.history || []);
    stage = 'collection';
    const snapshot = await collect(registry,ledger,previous,githubClient(env.GITHUB_READ_TOKEN,fetcher),attempted);
    stage = 'persist_snapshot';
    await env.OBSERVATORY.put('snapshot',JSON.stringify(snapshot));
    const count = failures(snapshot);
    await env.OBSERVATORY.put('health',JSON.stringify({attempted_at:attempted,scheduled_at:new Date(event.scheduledTime).toISOString(),
      status:count?'partial_failure':'ok',source_failures:count,snapshot_at:snapshot.generated_at}));
    if (count) throw Error('source_failure');
  } catch (err) {
    if (err.message !== 'source_failure') await env.OBSERVATORY.put('health',JSON.stringify({attempted_at:attempted,
      status:err.message==='missing_read_token'?'awaiting_authorization':'failed',snapshot_retained:true,stage,
      ...(err.publicCode ? {code:err.publicCode,source:err.publicSource} : {})}));
    // Never log response bodies, request headers or arbitrary upstream errors.
    throw Error('Observatory scheduled collection failed; see public health status');
  }
}
export default {
  scheduled(controller, env) { return scheduledRun(controller, env); },
  async fetch(request,env) {
    if (request.method !== 'GET') return new Response('Method not allowed',{status:405});
    const path = new URL(request.url).pathname;
    const key = path === '/health' ? 'health' : path === '/snapshot' ? 'snapshot' : null;
    if (!key) return new Response('Not found',{status:404});
    const value = await env.OBSERVATORY.get(key,'json');
    return Response.json(value || {status:'awaiting_first_collection'}, {status:value?200:503,
      headers:{'Cache-Control':'public, max-age=30'}});
  }
};
