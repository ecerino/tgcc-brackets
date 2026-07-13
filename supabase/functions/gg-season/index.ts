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

// A GG "page" embeds its standings through a widget. Pull golfgenius widget /
// tournament URLs out of ANY quoted attribute (the standings widget link isn't
// a plain href), decoding &amp; and normalising to absolute.
const STANDINGS_RE = /widgets\/(customized_league_standings|league_standings|standings|aggregate|tournament_results)/;

function resourceLinks(html: string): string[] {
  const urls = new Set<string>();
  const re = /["']((?:https?:\/\/www\.golfgenius\.com)?\/(?:leagues\/\d+\/widgets\/[a-z_]+[^"']*|v2tournaments\/\d+[^"']*))["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let u = m[1].replace(/&amp;/g, '&');
    if (!u.startsWith('http')) u = BASE + u;
    urls.add(u);
  }
  // standings-type widgets first
  const links = [...urls];
  return links.filter((l) => STANDINGS_RE.test(l)).concat(links.filter((l) => !STANDINGS_RE.test(l)));
}

// numbers may carry decimals/commas ("105.00", "1,240") — drop trailing .00
const toNum = (s: string): number | null =>
  (/^-?\d[\d,]*(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : null);

// Pick the standings "points" column: prefer an explicit Total Points over a
// participation/partial points column, then any points/total header.
function pointsColumn(heads: string[]): number {
  let c = heads.findIndex((h) => /total\s*point/.test(h));
  if (c < 0) c = heads.findIndex((h) => /point|pts/.test(h));
  if (c < 0) c = heads.findIndex((h) => /total/.test(h));
  return c;
}

// Pull { rank, name, points, played } rows from a standings table, ranked by
// points (the widget rows aren't guaranteed to be in standings order). The
// points and games-played columns are located by header text; the name is the
// first player anchor/label, or the first non-numeric cell.
// deno-lint-ignore no-explicit-any
function parseStandings(html: string): any[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heads = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent).toLowerCase());
  const pointsCol = pointsColumn(heads);
  const playedCol = heads.findIndex((h) => /played|rounds|tournaments|events|times|starts|games/.test(h));

  const all: { name: string; points: number | null; played: number | null }[] = [];
  for (const tr of doc.querySelectorAll('tbody tr')) {
    const el = tr as Element;
    if (el.classList.contains('expanded')) continue;
    const cells = [...el.querySelectorAll('td')].map((c) => clean((c as Element).textContent));
    if (!cells.length) continue;
    const nums = cells.map(toNum);

    let name = flipName(clean(el.querySelector('a.open-aggregate-details, .team a, .name a, td.name, .player a, .player, a')?.textContent)) ||
      flipName(clean(el.getAttribute('data-aggregate-name')));
    if (!name) {
      const idx = cells.findIndex((c, i) => c && nums[i] == null && !/^(pos|player|name)$/i.test(c));
      if (idx >= 0) name = flipName(cells[idx]);
    }
    if (!name) continue;

    let points = pointsCol >= 0 ? nums[pointsCol] ?? null : null;
    const played = playedCol >= 0 ? nums[playedCol] ?? null : null;
    if (points == null) {
      for (let i = cells.length - 1; i >= 0; i--) { if (nums[i] != null) { points = nums[i]; break; } }
    }
    all.push({ name, points, played });
  }

  all.sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
  return all.slice(0, TOP_N).map((r, i) => ({ rank: i + 1, name: r.name, points: r.points, played: r.played }));
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
  // only follow standings-type widgets (don't crawl the whole portal)
  for (const link of resourceLinks(html).filter((l) => STANDINGS_RE.test(l))) {
    try {
      const rows = parseStandings(await fetchText(link));
      if (rows.length) return rows;
    } catch { /* try the next widget */ }
  }
  return [];
}

// ?debug=1 — report what each page actually looks like so the parser can be
// tuned without local access to golfgenius.com.
// deno-lint-ignore no-explicit-any
async function diagnose(): Promise<any> {
  const races = [];
  for (const r of RACES) {
    // deno-lint-ignore no-explicit-any
    const info: any = { key: r.key, url: r.url };
    try {
      const html = await fetchText(r.url);
      info.ok = true;
      info.len = html.length;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      info.tables = doc.querySelectorAll('table').length;
      info.tbodyRows = doc.querySelectorAll('tbody tr').length;
      info.headers = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent)).slice(0, 20);
      info.rows = parseStandings(html).length;
      const links = resourceLinks(html);
      info.resourceLinks = links.slice(0, 25);
      const sw = links.find((l) => STANDINGS_RE.test(l));
      if (sw) {
        info.standingsWidget = sw;
        try {
          const whtml = await fetchText(sw);
          const wdoc = new DOMParser().parseFromString(whtml, 'text/html');
          const firstRow = wdoc.querySelector('tbody tr');
          info.widget = {
            len: whtml.length,
            tables: wdoc.querySelectorAll('table').length,
            tbodyRows: wdoc.querySelectorAll('tbody tr').length,
            headers: [...wdoc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent)).slice(0, 20),
            firstRowCells: firstRow ? [...(firstRow as Element).querySelectorAll('td')].map((c) => clean((c as Element).textContent)).slice(0, 20) : [],
            rows: parseStandings(whtml).length,
          };
        } catch (e) { info.widget = { error: String(e) }; }
      }
      info.snippet = clean(doc.querySelector('body')?.textContent).slice(0, 200);
    } catch (e) {
      info.ok = false;
      info.error = String(e);
    }
    races.push(info);
  }
  return { debug: true, races };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (new URL(req.url).searchParams.get('debug')) {
    return new Response(JSON.stringify(await diagnose(), null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
