// gg-season — reads the season-long points standings for the two club points
// races (Boros Cup and the Women's Golf Association) from the club's Golf
// Genius portal so the "2026 Season Points Race" slide can fill itself in.
//
// Each race is an aggregate/season-long-points league on Golf Genius. Its
// public results page embeds a tournament_results widget linking to an
// aggregate leaderboard; each row is a player (or team) with a running points
// total. This function scrapes that page server-side (golfgenius.com sends no
// CORS headers) and returns the ranked top 30 for each race as
// { boros: [{rank, name, points}], wga: [...] }.
// Public GET, no auth: the same data is on the club's public portal pages.
//
// TODO: fill in the two league IDs below. Until they are set (or if a page
// can't be read) that race comes back empty and the slide shows a placeholder.

import { DOMParser, type Element } from 'jsr:@b-fuze/deno-dom';

const BASE = 'https://www.golfgenius.com';

// The season points-race leagues, in display order (left, right on the slide).
const RACES: { key: string; league: string }[] = [
  { key: 'boros', league: '' },   // TODO: Boros Cup season points league id
  { key: 'wga', league: '' },     // TODO: WGA season points league id
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

// The results widget links to the aggregate leaderboard page(s).
async function tournamentLinks(league: string): Promise<string[]> {
  const widget = await fetchText(
    `${BASE}/leagues/${league}/widgets/tournament_results?shared=false`);
  return [...new Set(
    [...widget.matchAll(/href="(\/v2tournaments\/\d+[^"]*)"/g)]
      .map((m) => m[1].replace(/&amp;/g, '&')),
  )];
}

// Pull ranked { rank, name, points } rows from an aggregate leaderboard. The
// name comes from the first player anchor (or the aggregate-name/team cell);
// points is the row's Total column (the last numeric cell as a fallback).
// deno-lint-ignore no-explicit-any
function parseStandings(html: string): any[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: { rank: number; name: string; points: number | null }[] = [];

  // which header column holds the running total / points
  const heads = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent));
  let totalCol = heads.findIndex((h) => /^(total|points|pts)$/i.test(h));

  const rows = [...doc.querySelectorAll('tbody tr')].filter((tr) => {
    const el = tr as Element;
    return !el.classList.contains('expanded') && el.querySelector('.pos, td');
  });

  let rank = 0;
  for (const tr of rows) {
    const el = tr as Element;
    const name =
      flipName(clean(el.querySelector('a.open-aggregate-details, .team a, .name a, td.name')?.textContent)) ||
      flipName(clean(el.getAttribute('data-aggregate-name')));
    if (!name) continue;

    const cells = [...el.querySelectorAll('td')].map((c) => clean((c as Element).textContent));
    let points: number | null = null;
    if (totalCol >= 0 && totalCol < cells.length && /^-?\d[\d,]*$/.test(cells[totalCol])) {
      points = Number(cells[totalCol].replace(/,/g, ''));
    } else {
      // fall back to the last numeric cell on the row
      for (let i = cells.length - 1; i >= 0; i--) {
        if (/^-?\d[\d,]*$/.test(cells[i])) { points = Number(cells[i].replace(/,/g, '')); break; }
      }
    }

    const posTxt = clean(el.querySelector('.pos')?.textContent);
    rank = /^\d+$/.test(posTxt) ? Number(posTxt) : rank + 1;
    out.push({ rank, name, points });
    if (out.length >= TOP_N) break;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function fetchRace(league: string): Promise<any[]> {
  if (!league) return [];
  try {
    const links = await tournamentLinks(league);
    if (!links.length) return [];
    const html = await fetchText(BASE + links[0]);
    return parseStandings(html);
  } catch {
    return [];
  }
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
      const results = await Promise.all(RACES.map((r) => fetchRace(r.league)));
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
