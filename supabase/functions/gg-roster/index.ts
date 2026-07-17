// gg-roster — pulls a tournament's player roster for the staff raffle/calcutta
// tools. Preferred: ?page=<teeSheetPath|resultsPath> (a /pages/<id> link that
// gg-events carries for each event); the page embeds a tee-sheet / results /
// roster widget whose table lists the players. Falls back to ?league=<id> with
// guessed roster widgets. Returns a de-duplicated list sorted by last name:
//   { players: [{ name }], source, count }.
// Server-side scrape (golfgenius.com sends no CORS). Public GET, no auth.
// ?debug=1&url=<page> inspects one exact page so the parser can be tuned.

import { DOMParser, type Element } from 'jsr:@b-fuze/deno-dom';

const BASE = 'https://www.golfgenius.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
/* "Last, First" -> "First Last"; leave "First Last" alone */
const flipName = (s: string) => s.replace(/^([^,/]+),\s*(.+)$/, '$2 $1').trim();
const lastName = (s: string) => { const p = s.trim().split(/\s+/); return (p[p.length - 1] || '').toLowerCase(); };

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.text();
}

const abs = (u: string) => (u.startsWith('http') ? u : BASE + u);

// widget links a /pages/ shell embeds; keep the roster/tee-sheet/results ones
const ROSTER_WIDGET = /widgets\/(tee_sheet|tee_times|pairings|starting_holes|results|roster|master_roster|registration_list|leaderboard|standings|tournament_results|customized_league_standings)/;
function widgetLinks(html: string): string[] {
  const re = /["']((?:https?:\/\/www\.golfgenius\.com)?\/leagues\/\d+\/widgets\/[a-z_]+[^"']*)["']/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) urls.add(abs(m[1].replace(/&amp;/g, '&')));
  return [...urls].filter((l) => ROSTER_WIDGET.test(l));
}

// names look like a person: has a letter, a space or comma, no digits/URLs
function looksLikeName(s: string): boolean {
  if (!s || s.length < 3 || s.length > 48) return false;
  if (/\d|https?:|@|\/|\{|\}/.test(s)) return false;
  if (!/[a-z]/i.test(s)) return false;
  return /,/.test(s) || /\s/.test(s);
}
const SKIP = /^(player|name|team|players|roster|pairings|tee\s|time|hole|group|flight|position|pos|total|handicap|hcp|division|round|start|thru|today|net|gross|score|par)\b/i;

function extractNames(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = new Set<string>();
  for (const a of doc.querySelectorAll('a')) {
    const t = clean((a as Element).textContent);
    if (looksLikeName(t) && !SKIP.test(t)) found.add(flipName(t));
  }
  for (const td of doc.querySelectorAll('td, li')) {
    const t = clean((td as Element).textContent);
    if (looksLikeName(t) && !SKIP.test(t)) found.add(flipName(t));
  }
  return [...found];
}

function sortByLast(names: Set<string> | string[]) {
  return [...names].sort((a, b) => lastName(a).localeCompare(lastName(b)) || a.localeCompare(b));
}

// scrape a /pages/ tee-sheet or results page: parse it, and if it's a shell,
// follow the roster/tee-sheet/results widget(s) it embeds.
async function pageRoster(pagePath: string): Promise<{ players: { name: string }[]; source: string | null }> {
  const url = abs(pagePath);
  const names = new Set<string>();
  let html = '';
  try { html = await fetchText(url); } catch { return { players: [], source: null }; }
  extractNames(html).forEach((n) => names.add(n));
  if (names.size < 5) {
    for (const link of widgetLinks(html)) {
      try { extractNames(await fetchText(link)).forEach((n) => names.add(n)); } catch { /* next */ }
      if (names.size >= 400) break;
    }
  }
  return { players: sortByLast(names).map((name) => ({ name })), source: url };
}

// legacy fallback: guess roster widgets straight off the league id
function candidates(league: string): string[] {
  return [
    `${BASE}/leagues/${league}/widgets/roster`,
    `${BASE}/leagues/${league}/widgets/master_roster`,
    `${BASE}/leagues/${league}/widgets/registration_list`,
    `${BASE}/leagues/${league}/widgets/tee_times`,
    `${BASE}/leagues/${league}/widgets/pairings`,
    `${BASE}/leagues/${league}/widgets/tee_sheet`,
  ];
}
async function leagueRoster(league: string): Promise<{ players: { name: string }[]; source: string | null }> {
  for (const u of candidates(league)) {
    try {
      const names = extractNames(await fetchText(u));
      if (names.length >= 2) return { players: sortByLast(names).map((name) => ({ name })), source: u };
    } catch { /* next */ }
  }
  return { players: [], source: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(req.url);
  const page = url.searchParams.get('page') || '';   // /pages/<id> (preferred)
  const league = (url.searchParams.get('league') || '').replace(/[^0-9]/g, '');
  const probe = url.searchParams.get('url');

  // ?debug=1&url=<page> — inspect an exact page's structure
  if (url.searchParams.get('debug') && probe && /^https:\/\/www\.golfgenius\.com\//.test(probe)) {
    // deno-lint-ignore no-explicit-any
    const info: any = { url: probe };
    try {
      const html = await fetchText(probe);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      info.ok = true; info.len = html.length;
      info.tables = doc.querySelectorAll('table').length;
      info.headers = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent)).slice(0, 20);
      info.names = extractNames(html).slice(0, 30);
      info.count = extractNames(html).length;
      info.widgets = widgetLinks(html).slice(0, 20);
      info.snippet = clean(doc.querySelector('body')?.textContent).slice(0, 300);
    } catch (e) { info.ok = false; info.error = String(e); }
    return new Response(JSON.stringify({ debug: true, probe: info }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (!page && !league) {
    return new Response(JSON.stringify({ error: 'page or league required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const r = page && /^\/?pages\/\d+/.test(page.replace(/^https:\/\/www\.golfgenius\.com/, ''))
      ? await pageRoster(page)
      : (page ? await pageRoster(page) : await leagueRoster(league));
    return new Response(JSON.stringify({ count: r.players.length, source: r.source, players: r.players }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
