// gg-roster — pulls the player roster for a Golf Genius tournament so the staff
// raffle/calcutta tools can start from the entrant list. Given ?league=<id>
// (the event id from gg-events), it tries the roster/registration widgets and,
// failing that, the tee sheet / pairings, returning a de-duplicated player list
// sorted by last name: { players: [{ name }], source, count }.
// Server-side scrape (golfgenius.com sends no CORS). Public GET, no auth.
// ?debug=1 reports what each candidate source looked like so the parser can be
// tuned against the real pages.

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
const lastName = (s: string) => {
  const p = s.trim().split(/\s+/);
  return (p[p.length - 1] || '').toLowerCase();
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.text();
}

// candidate widgets that carry entrants, most roster-like first
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

// names look like a person: has a letter, a space or comma, no digits/URLs
function looksLikeName(s: string): boolean {
  if (!s || s.length < 3 || s.length > 48) return false;
  if (/\d|https?:|@|\/|\{|\}/.test(s)) return false;
  if (!/[a-z]/i.test(s)) return false;
  return /,/.test(s) || /\s/.test(s);
}

const SKIP = /^(player|name|team|players|roster|pairings|tee\s|time|hole|group|flight|position|pos|total|handicap|hcp|division|round)\b/i;

// pull candidate player names from a widget's tables and player anchors
function extractNames(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = new Set<string>();

  // player anchors first (rosters link each member)
  for (const a of doc.querySelectorAll('a')) {
    const t = clean((a as Element).textContent);
    if (looksLikeName(t) && !SKIP.test(t)) found.add(flipName(t));
  }
  // then table cells that read like names
  for (const td of doc.querySelectorAll('td, li')) {
    const t = clean((td as Element).textContent);
    if (looksLikeName(t) && !SKIP.test(t)) found.add(flipName(t));
  }
  return [...found];
}

async function fetchRoster(league: string): Promise<{ players: { name: string }[]; source: string | null }> {
  for (const url of candidates(league)) {
    try {
      const names = extractNames(await fetchText(url));
      if (names.length >= 2) {
        names.sort((a, b) => lastName(a).localeCompare(lastName(b)) || a.localeCompare(b));
        return { players: names.map((name) => ({ name })), source: url };
      }
    } catch { /* try the next source */ }
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
  const league = (url.searchParams.get('league') || '').replace(/[^0-9]/g, '');
  const hasProbe = !!(url.searchParams.get('debug') && url.searchParams.get('url'));
  if (!league && !hasProbe) {
    return new Response(JSON.stringify({ error: 'league required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (url.searchParams.get('debug')) {
    // ?url=<any golfgenius page> — inspect that exact page (paste a real tee
    // sheet / roster URL here so the parser can be tuned to it)
    const probe = url.searchParams.get('url');
    if (probe && /^https:\/\/www\.golfgenius\.com\//.test(probe)) {
      // deno-lint-ignore no-explicit-any
      const info: any = { url: probe };
      try {
        const html = await fetchText(probe);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        info.ok = true; info.len = html.length;
        info.tables = doc.querySelectorAll('table').length;
        info.tbodyRows = doc.querySelectorAll('tbody tr').length;
        info.headers = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent)).slice(0, 20);
        info.names = extractNames(html).slice(0, 30);
        info.count = extractNames(html).length;
        // golfgenius links embedded (to find the tee sheet / roster widget)
        info.ggLinks = [...new Set([...html.matchAll(/\/leagues\/\d+\/widgets\/[a-z_]+/g)].map((m) => m[0]))].slice(0, 30);
        info.snippet = clean(doc.querySelector('body')?.textContent).slice(0, 300);
      } catch (e) { info.ok = false; info.error = String(e); }
      return new Response(JSON.stringify({ debug: true, probe: info }, null, 2), {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // otherwise report the guessed widget candidates for this league
    // deno-lint-ignore no-explicit-any
    const out: any[] = [];
    for (const u of candidates(league)) {
      // deno-lint-ignore no-explicit-any
      const info: any = { url: u };
      try {
        const html = await fetchText(u);
        info.ok = true; info.len = html.length;
        info.names = extractNames(html).slice(0, 15);
        info.count = extractNames(html).length;
        info.ggLinks = [...new Set([...html.matchAll(/\/leagues\/\d+\/widgets\/[a-z_]+/g)].map((m) => m[0]))].slice(0, 20);
      } catch (e) { info.ok = false; info.error = String(e); }
      out.push(info);
    }
    return new Response(JSON.stringify({ debug: true, league, sources: out }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const r = await fetchRoster(league);
    return new Response(JSON.stringify({ league, count: r.players.length, source: r.source, players: r.players }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
