// gg-results — reads the match play bracket results straight from the
// club's Golf Genius portal so the boards fill themselves in.
//
// Each event's public results page embeds a tournament_results widget;
// the widget links to per-tournament bracket pages (one per flight) whose
// HTML marks every decided match with winner/loser classes and the score.
// This function scrapes those pages server-side (golfgenius.com sends no
// CORS headers) and returns name-pair results; the display maps them onto
// its own bracket structure by matching the player/team names.
// Public GET, no auth: the same data is on the club's public portal pages.

import { DOMParser, type Element } from 'jsr:@b-fuze/deno-dom';

const BASE = 'https://www.golfgenius.com';

// The five match play events in the 2026 Treesdale portal.
const LEAGUES = [
  { key: 'palmer', league: '12263344863583455771' },   // Palmer Cup
  { key: 'mpc', league: '12263337631328291354' },      // Match Play Championship
  { key: 'mpt', league: '12263373217145604637' },      // Match Play Tournaments (8 flights)
  { key: 'wga', league: '12263405950735534625' },      // WGA Individual Match Play
  { key: 'winnie', league: '12263410977726319138' },   // Winnie Cup
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

const clean = (s?: string | null) => (s || '').replace(/[`]/g, '').replace(/\s+/g, ' ').trim();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.text();
}

// deno-lint-ignore no-explicit-any
function parseBrackets(html: string): any[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const ph of doc.querySelectorAll('.bracket-placeholder')) {
    const name = clean((ph as Element).querySelector('h2.bracket_name')?.textContent);
    // pass 1: every column's matches, plus each slot's sub-line text —
    // GG prints a team's winning margin under their name in the NEXT column
    const cols = [];
    for (const col of (ph as Element).querySelectorAll('.bracket-container .column')) {
      const matches = [];
      const scores: Record<string, string> = {};
      for (const m of (col as Element).querySelectorAll('.match')) {
        const el = m as Element;
        const sides = [el.querySelector('.top'), el.querySelector('.bottom')];
        if (!sides[0] || !sides[1]) continue;
        const [top, bot] = sides.map((s) => ({
          name: clean(s!.querySelector('.text.above span')?.textContent),
          below: clean(s!.querySelector('.status_or_affiliation span')?.textContent),
          won: s!.classList.contains('winner'),
        }));
        [top, bot].forEach((s) => { if (s.name && s.below) scores[s.name] = s.below; });
        matches.push({ top, bot });
      }
      cols.push({ matches, scores });
    }
    // pass 2: emit decided matches, score looked up under the advanced name
    const matches = [];
    cols.forEach(({ matches: colMatches }, ci) => {
      colMatches.forEach(({ top, bot }) => {
        // byes and empty slots resolve locally; only real decided matches ship
        if (!top.name || !bot.name) return;
        if (/^bye$/i.test(top.name) || /^bye$/i.test(bot.name)) return;
        if (top.won === bot.won) return;               // not decided yet
        const winName = top.won ? top.name : bot.name;
        const score = ((cols[ci + 1] || {}).scores || {})[winName] || '';
        matches.push({ round: ci + 1, top: top.name, bot: bot.name,
          winner: top.won ? 1 : 2, score: score.replace(/\s*&\s*/g, ' & ') });
      });
    });
    if (name && matches.length) out.push({ name, matches });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function fetchLeague(l: typeof LEAGUES[number]): Promise<any[]> {
  const widget = await fetchText(`${BASE}/leagues/${l.league}/widgets/tournament_results?shared=false`);
  const links = [...new Set(
    [...widget.matchAll(/href="(\/v2tournaments\/\d+\?[^"]*)"/g)]
      .map((m) => m[1].replace(/&amp;/g, '&')),
  )];
  const brackets = [];
  for (const href of links) {
    const html = await fetchText(BASE + href);
    for (const b of parseBrackets(html)) brackets.push({ league: l.key, ...b });
  }
  return brackets;
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
      const perLeague = await Promise.all(LEAGUES.map(fetchLeague));
      cache = {
        at: Date.now(),
        body: JSON.stringify({ fetchedAt: new Date().toISOString(), brackets: perLeague.flat() }),
      };
    }
    return new Response(cache.body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
  } catch (e) {
    // serve stale data over an error if we have any
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
