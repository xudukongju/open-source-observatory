import {validate} from '../../dist/model.js';
const SOURCE = 'https://raw.githubusercontent.com/xudukongju/open-source-observatory/main/data/snapshot.json';

// Fixed public source only. No visitor-supplied upstream or private credentials.
export async function readSnapshot(fetcher = fetch, kv) {
  // Both collectors remain usable during migration and source outages.
  const candidates = [];
  try { if (kv) candidates.push(validate(await kv.get('snapshot', 'json'))); } catch {}
  try {
    const upstream = await fetcher(SOURCE, {
      headers: {Accept: 'application/json', 'Cache-Control': 'no-cache'},
      signal: AbortSignal.timeout(12000), cf: {cacheTtl: 0}
    });
    if (!upstream.ok) throw new Error('upstream');
    candidates.push(validate(await upstream.json()));
  } catch {}
  if (candidates.length) {
    const data = candidates.sort((a,b) => Date.parse(b.generated_at)-Date.parse(a.generated_at))[0];
    return Response.json(data, {headers: {'Cache-Control': 'public, max-age=60'}});
  }
  return Response.json({error: '公开快照暂时无法读取，请稍后重试。'}, {
      status: 503, headers: {'Cache-Control': 'no-store'}
    });
}

export async function onRequestGet({request, waitUntil, env}) {
  const key = new Request(new URL('/api/snapshot', request.url));
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await readSnapshot(fetch, env?.OBSERVATORY);
  if (response.ok) waitUntil(cache.put(key, response.clone()));
  return response;
}
