// gg-events — read-only proxy for the club's Golf Genius event directories.
// golfgenius.com sends no CORS headers, so the display can't read the portal
// directly; this function pulls each directory's JSON feed server-side and
// returns a compact summary grouped by event type (one entry per directory).
// Public GET, no auth: the same data is on the club's public portal pages.

const LEAGUE = '2794549870361365042'; // 2026 Treesdale Golf Portal

// The five "Events & Registrations" pages on the portal, in display order.
const DIRECTORIES = [
  { key: 'mens', label: "Men's Events", dir: '5015426980909206213', page: '12286627189268466236' },
  { key: 'womens', label: "Women's Events", dir: '5046603045878680265', page: '12286627189738228285' },
  { key: 'mixed', label: 'Mixed Events', dir: '5046606927757363915', page: '12286627190207990334' },
  { key: 'junior', label: 'Junior Instruction & Events', dir: '5046605809119709898', page: '12286627190677752383' },
  { key: 'instruction', label: 'Adult Golf Instruction', dir: '9339021259628923401', page: '12286627191281732160' },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TTL_MS = 15 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

// today's date in the club's timezone, as YYYY-MM-DD
function easternToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;#39;|&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
}

// A recurring league's schedule of rounds lives in its "next_round" widget's
// round selector, each option like:
//   "WGA 18H Golf - Opening Day (Thu, April 23)"
// so we can pair each round's NAME with its date. Pull the ones on/after
// today. Best-effort: failures return [].
async function fetchLeagueUpcoming(
  leagueId: string, today: string,
): Promise<{ d: string; n: string }[]> {
  try {
    const url = `https://www.golfgenius.com/leagues/${leagueId}/widgets/next_round`;
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const year = Number(today.slice(0, 4));
    const re = /round_id=\d+">([^<]*?)\s*\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]+)\s+(\d{1,2})\)<\/option>/g;
    const seen = new Set<string>();
    const out: { d: string; n: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const mo = MONTHS[m[2]];
      if (!mo) continue;
      const d = `${year}-${pad(mo)}-${pad(Number(m[3]))}`;
      if (d < today) continue;
      // drop a trailing " - 7.2.26"-style date from the round name
      const n = decodeEntities(m[1]).replace(/\s*-\s*\d{1,2}\.\d{1,2}(\.\d{2,4})?\s*$/, '').trim();
      const key = d + '|' + n;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ d, n });
    }
    out.sort((a, b) => a.d.localeCompare(b.d));
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

// deno-lint-ignore no-explicit-any
async function fetchDirectory(d: typeof DIRECTORIES[number], today: string): Promise<any> {
  const events = [];
  let label = d.label;
  for (let page = 1; page <= 3; page++) {
    const url = `https://www.golfgenius.com/leagues/${LEAGUE}/v2_customer_directories/${d.dir}` +
      `/fetch_initial_data_for_directories?page_id=${d.page}&page=${page}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${d.key}: upstream ${res.status}`);
    const data = await res.json();
    if (data?.misc?.directoryName) label = String(data.misc.directoryName).trim();
    const leagues = data?.leagues || {};
    const order: string[] = data?.misc?.leaguesOrder || Object.keys(leagues);
    for (const id of order) {
      const l = leagues[id];
      if (!l || l.deleted) continue;
      events.push({
        id: String(l.id ?? id),
        name: String(l.name || '').trim(),
        start: l.startDate || null,        // YYYY-MM-DD
        end: l.endDate || null,
        next: l.datesToSort || null,       // next round for ongoing leagues
        status: l.registrationInfo?.status || '',
        regStart: (l.registrationInfo?.starts_at || '').slice(0, 10) || null,
        regEnd: (l.registrationInfo?.ends_at || '').slice(0, 10) || null,
        golfers: l.registrationInfo?.registered_members ?? null,
        product: l.product || '',          // 'event' | 'league'
      });
    }
    if (data?.misc?.noMoreData !== false) break;
  }
  // recurring leagues still running: attach their next handful of round dates
  await Promise.all(events.map(async (ev) => {
    if (ev.product === 'league' && ev.end && ev.end >= today) {
      ev.upcoming = await fetchLeagueUpcoming(ev.id, today);
    }
  }));
  return { key: d.key, label, events };
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
      const today = easternToday();
      const categories = await Promise.all(DIRECTORIES.map((d) => fetchDirectory(d, today)));
      cache = {
        at: Date.now(),
        body: JSON.stringify({ fetchedAt: new Date().toISOString(), categories }),
      };
    }
    return new Response(cache.body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
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
