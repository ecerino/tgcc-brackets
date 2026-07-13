// gg-season — reads the season-long points standings for the two club points
// races (Boros Cup and the Women's Golf Association) from the club's Golf
// Genius portal so the "2026 Season Points Race" slide can fill itself in.
//
// Each race is a Golf Genius "page" that shows a season standings table: one
// row per player with a running points total and a games-played count. This
// function scrapes that page server-side (golfgenius.com sends no CORS headers)
// and returns the ranked top 30 for each race as
// { boros: [{rank, name, points, played}], wga: [...] }.
// Public GET, no auth: the same data is on the club's public portal pages.
// If a page can't be read it comes back empty and the slide shows a placeholder.

import { DOMParser, type Element } from 'jsr:@b-fuze/deno-dom';

const BASE = 'https://www.golfgenius.com';

// The season points-race pages, in display order (left, right on the slide).
// Each is a Golf Genius "page" that embeds a standings table with a points
// column and a games-played column (tournaments for the men, times played for
// the women). NOTE: the men/women mapping below is assumed from the order the
// URLs were given — swap the two `url`s if they come back reversed.
const RACES: { key: string; url: string }[] = [
  { key: 'boros', url: 'https://www.golfgenius.com/pages/12881886861726894736' },  // Men — Boros Cup
  { key: 'wga', url: 'https://www.golfgenius.com/pages/12518580570587974471' },    // Women — WGA
];

const TOP_N = 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TTL_MS = 15 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
/* GG prints individuals as "Last, First" — show as "First Last" */
const flipName = (s: string) => s.replace(/^([^,/]+),\s*(.+)$/, '$2 $1').trim();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.text();
}

// A GG "page" may embed its standings table directly or reference it through a
// widget / tournament / nested page. Pull any golfgenius resource URLs out of
// the page HTML so we can follow them when the table isn't inline.
function embeddedLinks(html: string): string[] {
  const urls = new Set<string>();
  const re = /(?:href|src|data-src)="((?:https:\/\/www\.golfgenius\.com)?\/(?:leagues\/\d+\/widgets\/[^"]+|v2tournaments\/\d+[^"]*|pages\/\d+[^"]*))"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let u = m[1].replace(/&amp;/g, '&');
    if (!u.startsWith('http')) u = BASE + u;
    urls.add(u);
  }
  return [...urls];
}

const toNum = (s: string): number | null => (/^-?\d[\d,]*$/.test(s) ? Number(s.replace(/,/g, '')) : null);

// Pull ranked { rank, name, points, played } rows from a standings table. The
// points and games-played columns are located by their header text; the name
// comes from the first player anchor/cell.
// deno-lint-ignore no-explicit-any
function parseStandings(html: string): any[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: { rank: number; name: string; points: number | null; played: number | null }[] = [];

  const heads = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent).toLowerCase());
  const pointsCol = heads.findIndex((h) => /points|pts|total/.test(h));
  const playedCol = heads.findIndex((h) => /played|rounds|tournaments|events|times|starts|games/.test(h));

  const rows = [...doc.querySelectorAll('tbody tr')].filter((tr) => {
    const el = tr as Element;
    return !el.classList.contains('expanded') && el.querySelector('.pos, td');
  });

  let rank = 0;
  for (const tr of rows) {
    const el = tr as Element;
    const name =
      flipName(clean(el.querySelector('a.open-aggregate-details, .team a, .name a, td.name, .player a, .player')?.textContent)) ||
      flipName(clean(el.getAttribute('data-aggregate-name')));
    if (!name) continue;

    const cells = [...el.querySelectorAll('td')].map((c) => clean((c as Element).textContent));
    const nums = cells.map(toNum);
    let points = pointsCol >= 0 ? nums[pointsCol] ?? null : null;
    let played = playedCol >= 0 ? nums[playedCol] ?? null : null;
    // fallbacks when headers can't be matched: last numeric = points
    if (points == null) {
      for (let i = cells.length - 1; i >= 0; i--) { if (nums[i] != null) { points = nums[i]; break; } }
    }

    const posTxt = clean(el.querySelector('.pos')?.textContent);
    rank = /^\d+$/.test(posTxt) ? Number(posTxt) : rank + 1;
    out.push({ rank, name, points, played });
    if (out.length >= TOP_N) break;
  }
  return out;
}

// Fetch a race's standings: parse the page directly, and if the table isn't
// inline, follow the resources it embeds (one hop) until one yields rows.
// deno-lint-ignore no-explicit-any
async function fetchRace(url: string): Promise<any[]> {
  if (!url) return [];
  let html = '';
  try {
    html = await fetchText(url);
    const rows = parseStandings(html);
    if (rows.length) return rows;
  } catch { return []; }
  for (const link of embeddedLinks(html)) {
    try {
      const rows = parseStandings(await fetchText(link));
      if (rows.length) return rows;
    } catch { /* try the next embedded resource */ }
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const results = await Promise.all(RACES.map((r) => fetchRace(r.url)));
      // deno-lint-ignore no-explicit-any
      const payload: any = { fetchedAt: new Date().toISOString() };
      RACES.forEach((r, i) => { payload[r.key] = results[i]; });
      cache = { at: Date.now(), body: JSON.stringify(payload) };
    }
    return new Response(cache.body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
    });
  } catch (e) {
    if (cache) {
      return new Response(cache.body, {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
