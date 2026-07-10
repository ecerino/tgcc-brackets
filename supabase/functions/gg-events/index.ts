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
  const out: { d: string; n: string }[] = [];
  const seen = new Set<string>();               // dedupe by date
  const add = (d: string, n: string) => {
    if (d < today || seen.has(d)) return;
    seen.add(d);
    out.push({ d, n });
  };
  const year = Number(today.slice(0, 4));

  // The "next_round" widget tags each round with a "(Day, Month DD)" date and
  // has the fullest names — but for some leagues (e.g. SWAT, Guys' Night Out)
  // it only lists PAST rounds. Best-effort.
  try {
    const res = await fetch(
      `https://www.golfgenius.com/leagues/${leagueId}/widgets/next_round`,
      { headers: { Accept: 'text/html' } });
    if (res.ok) {
      const html = await res.text();
      const re = /round_id=\d+">([^<]*?)\s*\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]+)\s+(\d{1,2})\)<\/option>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const mo = MONTHS[m[2]];
        if (!mo) continue;
        const d = `${year}-${pad(mo)}-${pad(Number(m[3]))}`;
        // drop a trailing " - 7.2.26"-style date from the round name
        const n = decodeEntities(m[1]).replace(/\s*-\s*\d{1,2}\.\d{1,2}(\.\d{2,4})?\s*$/, '').trim();
        add(d, n);
      }
    }
  } catch { /* ignore */ }

  // The "calendar" widget carries the FULL season schedule (past + future) for
  // leagues whose next_round widget only shows completed rounds. Entries read
  // like "Men's SWAT - 7.25.26" or "Guys' Night Out - Wed. - 7.23.26".
  try {
    const res = await fetch(
      `https://www.golfgenius.com/leagues/${leagueId}/widgets/calendar`,
      { headers: { Accept: 'text/html' } });
    if (res.ok) {
      const html = await res.text();
      const re = /([^<>"\n]{2,80}?)\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const mo = Number(m[2]), day = Number(m[3]), yy = Number(m[4]);
        if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
        const d = `20${pad(yy)}-${pad(mo)}-${pad(day)}`;
        const n = decodeEntities(m[1]).trim();
        if (!/[a-z]/i.test(n) || /[{};]/.test(n)) continue;   // skip CSS/JS noise
        add(d, n);
      }
    }
  } catch { /* ignore */ }

  out.sort((a, b) => a.d.localeCompare(b.d));
  return out.slice(0, 8);
}

// A multi-week class/camp (e.g. the Junior Golf Camp) lists each session in
// the same "next_round" widget, often several age-group slots per day. Pull
// the distinct upcoming session DATES so we can list them individually.
async function fetchSessionDates(leagueId: string, today: string): Promise<string[]> {
  try {
    const url = `https://www.golfgenius.com/leagues/${leagueId}/widgets/next_round`;
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const year = Number(today.slice(0, 4));
    const re = /\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]+)\s+(\d{1,2})\)/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const mo = MONTHS[m[1]];
      if (!mo) continue;
      const d = `${year}-${pad(mo)}-${pad(Number(m[2]))}`;
      if (d >= today) seen.add(d);
    }
    return [...seen].sort().slice(0, 6);
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
  const instr = d.key === 'junior' || d.key === 'instruction';
  await Promise.all(events.map(async (ev) => {
    // recurring leagues still running: attach their next handful of round dates
    if (ev.product === 'league' && ev.end && ev.end >= today) {
      ev.upcoming = await fetchLeagueUpcoming(ev.id, today);
    } else if (instr && ev.product === 'event' && ev.start && ev.end && ev.end >= today &&
               (Date.parse(ev.end) - Date.parse(ev.start)) / 86400000 >= 14) {
      // multi-week class/camp still running: list its individual session dates
      ev.sessions = await fetchSessionDates(ev.id, today);
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
