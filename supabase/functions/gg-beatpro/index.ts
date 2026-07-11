// gg-beatpro — reads the 2026 Treesdale Cup "Beat the Pro" leaderboard from
// the club's Golf Genius portal so the raffle page can fill itself in.
//
// The event is an aggregate of three formats (Scramble / Best Ball / Alternate
// Shot). Its public results page embeds a tournament_results widget linking to
// one aggregate leaderboard; each row is a two-person team with a gross score
// per format, and a special "Beat the Pro / Beat the Pro" row is the pro's
// benchmark. This function scrapes that page server-side (golfgenius.com sends
// no CORS headers) and returns each team's players and per-format scores plus
// the pro's, so the browser can compute raffle entries by comparison.
// Public GET, no auth: the same data is on the club's public portal pages.

import { DOMParser, type Element } from 'jsr:@b-fuze/deno-dom';

const BASE = 'https://www.golfgenius.com';
const LEAGUE = '12262940355443345924';           // 2026 Treesdale Cup
const PRO_TEAM = 'Beat the Pro / Beat the Pro';   // the benchmark row

// Column keys (SCR/BB/ALT) come straight from the leaderboard header; these
// are just the friendly names the raffle page shows for each.
const FORMAT_LABELS: Record<string, string> = {
  SCR: 'Scramble',
  BB: 'Best Ball',
  ALT: 'Alternate Shot',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
/* GG prints individuals as "Last, First" — show as "First Last" */
const flipName = (s: string) => s.replace(/^([^,/]+),\s*(.+)$/, '$2 $1').trim();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.text();
}

// The results widget links to the aggregate leaderboard page(s). Grab the
// distinct v2tournaments hrefs (same approach as gg-results).
async function tournamentLinks(): Promise<string[]> {
  const widget = await fetchText(
    `${BASE}/leagues/${LEAGUE}/widgets/tournament_results?shared=false`);
  return [...new Set(
    [...widget.matchAll(/href="(\/v2tournaments\/\d+[^"]*)"/g)]
      .map((m) => m[1].replace(/&amp;/g, '&')),
  )];
}

// The header row spells out the format columns between "Team" and "Total".
function parseFormatKeys(doc: ReturnType<DOMParser['parseFromString']>): string[] {
  const ths = [...doc.querySelectorAll('thead th')].map((t) => clean((t as Element).textContent));
  const keys = ths.filter((t) => t && !/^(pos\.?|team|total|thru|today)$/i.test(t));
  // fall back to the three known formats if the header can't be read
  return keys.length ? keys : ['SCR', 'BB', 'ALT'];
}

// deno-lint-ignore no-explicit-any
function parseLeaderboard(html: string): { formats: string[]; rows: any[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const formats = parseFormatKeys(doc);
  const rows = [];
  for (const tr of doc.querySelectorAll('tr[data-aggregate-name]')) {
    const el = tr as Element;
    if (el.classList.contains('expanded')) continue;   // the hidden detail row
    const team = clean(el.getAttribute('data-aggregate-name'));
    if (!team) continue;

    const pos = clean(el.querySelector('.pos')?.textContent);
    // two team-member anchors live inside the .team block; fall back to the
    // combined "A / B" name if they aren't present
    const members = [...el.querySelectorAll('.team a.open-aggregate-details')]
      .map((a) => flipName(clean((a as Element).textContent)))
      .filter(Boolean);
    const players = members.length
      ? members
      : team.split('/').map((s) => flipName(s.trim()));

    // per-format gross scores, in header order
    const totals = [...el.querySelectorAll('.past_round_total')]
      .map((c) => {
        const n = clean((c as Element).textContent);
        return /^-?\d+$/.test(n) ? Number(n) : null;
      });
    const scores: Record<string, number | null> = {};
    formats.forEach((f, i) => { scores[f] = i < totals.length ? totals[i] : null; });

    rows.push({ team, pos, players, scores, isPro: team === PRO_TEAM });
  }
  return { formats, rows };
}

// deno-lint-ignore no-explicit-any
function buildPayload(html: string): any {
  const { formats, rows } = parseLeaderboard(html);
  const proRow = rows.find((r) => r.isPro);
  const pro = proRow ? proRow.scores : null;
  const teams = rows.filter((r) => !r.isPro);
  return {
    fetchedAt: new Date().toISOString(),
    event: '2026 Treesdale Cup',
    proTeam: PRO_TEAM,
    formats: formats.map((key) => ({ key, label: FORMAT_LABELS[key] || key })),
    pro,
    teams,
  };
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
      const links = await tournamentLinks();
      if (!links.length) throw new Error('no leaderboard link found');
      const html = await fetchText(BASE + links[0]);
      cache = { at: Date.now(), body: JSON.stringify(buildPayload(html)) };
    }
    return new Response(cache.body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
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
