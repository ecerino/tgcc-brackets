// gg-roster — pulls a tournament's player roster for the staff raffle/calcutta
// tools. Preferred: ?page=<teeSheetPath|resultsPath> (a /pages/<id> link that
// gg-events carries for each event); the page's Player Roster / tee-sheet links
// lead to a `players` widget whose table lists the entrants. Falls back to
// ?league=<id>. Returns a de-duplicated list sorted by last name:
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

// widget the roster/tee-sheet/results pages load their data from. `players` is
// the registration roster; the rest are tee-sheet / leaderboard variants.
const ROSTER_WIDGET = /widgets\/(players|roster|master_roster|registration_list|tee_sheet|tee_times|pairings|starting_holes|results|leaderboard|standings|tournament_results|customized_league_standings)\b/;
function widgetLinks(html: string): string[] {
  // scan raw HTML (the widget URL isn't always in a quoted attribute)
  const re = /\/leagues\/\d+\/widgets\/[a-z_]+[a-z0-9_?=&.\-]*/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) urls.add(abs(m[0].replace(/&amp;/g, '&')));
  return [...urls].filter((l) => ROSTER_WIDGET.test(l));
}

// links to roster / tee-sheet / leaderboard SUB-PAGES (a /pages/ shell links to
// these rather than embedding a widget)
function subPageLinks(html: string): { t: string; href: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('a')]
    .map((a) => ({ t: clean((a as Element).textContent), href: (a as Element).getAttribute('href') || '' }))
    .filter((x) => x.href && /roster|tee.?sheet|pairing|starting|leaderboard|tournament.?result/i.test(x.t + ' ' + x.href));
}

// names look like a person: has a letter, a space or comma, no digits/URLs
function looksLikeName(s: string): boolean {
  if (!s || s.length < 3 || s.length > 48) return false;
  if (/\d|https?:|@|\/|\{|\}/.test(s)) return false;
  if (!/[a-z]/i.test(s)) return false;
  return /,/.test(s) || /\s/.test(s);
}
// portal nav / section labels that read like names but aren't players
const JUNK = /\b(events?|instruction|results?|website|roster|sheets?|leaderboard|information|sign\s*in|help|home|details|standings|calendar|register|directory|portal|golf shop|golf genius|powered by|click here|more information|hole by hole|scorecard)\b/i;
function isName(t: string): boolean {
  if (!looksLikeName(t) || JUNK.test(t)) return false;
  const w = t.split(/\s+/);
  if (w.every((x) => x.length === 1)) return false;   // "H E L P"
  return true;
}

function extractNames(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = new Set<string>();
  for (const a of doc.querySelectorAll('a')) {
    const t = clean((a as Element).textContent);
    if (isName(t)) found.add(flipName(t));
  }
  for (const td of doc.querySelectorAll('td, li')) {
    const t = clean((td as Element).textContent);
    if (isName(t)) found.add(flipName(t));
  }
  return [...found];
}

function sortByLast(names: Set<string> | string[]) {
  return [...names].sort((a, b) => lastName(a).localeCompare(lastName(b)) || a.localeCompare(b));
}

// scrape a /pages/ event page: parse it; if it's a shell, follow the embedded
// widget(s), then the roster/tee-sheet SUB-PAGE links (whose widgets carry the
// actual entrant table).
async function pageRoster(pagePath: string): Promise<{ players: { name: string }[]; source: string | null }> {
  const url = abs(pagePath);
  const names = new Set<string>();
  let html = '';
  try { html = await fetchText(url); } catch { return { players: [], source: null }; }
  let source = url;
  const tryWidgets = async (h: string) => {
    for (const link of widgetLinks(h)) {
      try { const got = extractNames(await fetchText(link)); if (got.length >= 2) { got.forEach((n) => names.add(n)); source = link; } } catch { /* next */ }
      if (names.size >= 400) break;
    }
  };
  // 1) any roster/tee-sheet widget referenced on the page itself
  await tryWidgets(html);
  // 2) otherwise follow the Player Roster / Tee Sheet sub-pages to their widgets
  if (names.size < 5) {
    const subs = subPageLinks(html);
    const ordered = subs.filter((s) => /roster/i.test(s.t)).concat(subs.filter((s) => !/roster/i.test(s.t)));
    for (const s of ordered.slice(0, 5)) {
      try { await tryWidgets(await fetchText(abs(s.href))); } catch { /* next */ }
      if (names.size >= 5) break;
    }
  }
  // 3) last resort: names printed on the page itself (nav labels filtered out)
  if (names.size < 2) extractNames(html).forEach((n) => names.add(n));
  return { players: sortByLast(names).map((name) => ({ name })), source };
}

// legacy fallback: guess roster widgets straight off the league id
function candidates(league: string): string[] {
  return [
    `${BASE}/leagues/${league}/widgets/players`,
    `${BASE}/leagues/${league}/widgets/roster`,
    `${BASE}/leagues/${league}/widgets/master_roster`,
    `${BASE}/leagues/${league}/widgets/registration_list`,
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
      info.navLinks = subPageLinks(html).slice(0, 30);
      info.ggPaths = [...new Set([...html.matchAll(/\/(?:pages\/\d+|leagues\/\d+\/[a-z0-9_\/]+)/gi)].map((m) => m[0]))].slice(0, 40);
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
    const r = page ? await pageRoster(page) : await leagueRoster(league);
    return new Response(JSON.stringify({ count: r.players.length, source: r.source, players: r.players }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
