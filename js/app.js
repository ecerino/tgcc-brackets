/* 2026 Match Play brackets — 16:9 rotating TV display */

/* ── geometry (fixed 1920×1080 design canvas per bracket view) ───────── */
const W = 1920, H = 1080;

/* per-bracket-size layout: 32 leaves/side (Palmer) vs 8 vs 4 */
const GEOM = {
  32: { marginX: 22, boxW: 158, step: 168, y0: 152, yBottom: 46,
        boxH: { 1: 22, 2: 22, 3: 26, 4: 29, 5: 32 }, cls: 'b64',
        headTop: 122, panelH: 200, champUp: 100 },
  8:  { marginX: 52, boxW: 232, step: 264, y0: 196, yBottom: 96,
        boxH: { 1: 58, 2: 58, 3: 58 }, cls: 'b16',
        headTop: 98, panelH: 250, champUp: 120 },
  4:  { marginX: 110, boxW: 320, step: 350, y0: 210, yBottom: 110,
        boxH: { 1: 68, 2: 68 }, cls: 'b16 b8',
        headTop: 98, panelH: 260, champUp: 130 },
};

/* grid cells stretch the canvas vertically to fill; type tiers by height */
function miniGeom(base, leaves, CH) {
  const tier = CH < 1150 ? '' : CH < 1650 ? ' md' : ' tall';
  const mul = CH < 1150 ? 1 : CH < 1650 ? 1.28 : 1.42;
  const boxH = {};
  Object.keys(base.boxH).forEach((k) => { boxH[k] = Math.round(base.boxH[k] * mul); });
  return {
    ...base, boxH,
    y0: leaves === 4 ? 214 : 200,
    yBottom: 74,
    headTop: 150,
    panelH: CH < 1150 ? 360 : CH < 1650 ? 480 : 600,
    champUp: CH < 1150 ? 112 : CH < 1650 ? 150 : 190,
    cls: base.cls + tier,
  };
}

/* full-width stacked bands: Palmer-sized badges, lines stretch to fill.
 * All bands share one page column grid (shorter brackets shift right by
 * colOffset so their first round lands under the correct page column). */
const BANDGEOM = {
  marginX: 22, boxW: 175, step: 262, y0: 12, yBottom: 6,
  boxH: { 1: 22, 2: 26, 3: 30 }, cls: 'band',
  headTop: 0, panelH: 200, champUp: 54,
};

/* ── slides: every full bracket + composite screens ──────────────────── */
const HOLD_DEFAULT = 12000;
const FADE_MS = 400;

function buildSlides() {
  return [
    { type: 'full', name: 'palmer', ids: ['palmer'], hold: 20000, variant: 'lines',
      title: '2026 Match Play Tournaments', label: "Men's Palmer Cup" },
    { type: 'stack', name: 'mens1', title: '2026 Match Play Tournaments', hold: 18000,
      ids: ['mpc', 'mpt-blue-f1', 'mpt-blue-f2', 'mpt-blue-f3'],
      labels: {
        mpc: "Men's Championship Flight",
        'mpt-blue-f1': "Men's Blue Tees · Flight 1",
        'mpt-blue-f2': "Men's Blue Tees · Flight 2",
        'mpt-blue-f3': "Men's Blue Tees · Flight 3",
      } },
    { type: 'stack', name: 'mens2', title: '2026 Match Play Tournaments', hold: 16000,
      ids: ['mpt-bw-f1', 'mpt-bw-f2', 'mpt-bw-f3'],
      labels: {
        'mpt-bw-f1': "Men's Blue/White Tees · Flight 1",
        'mpt-bw-f2': "Men's Blue/White Tees · Flight 2",
        'mpt-bw-f3': "Men's Blue/White Tees · Flight 3",
      } },
    { type: 'stack', name: 'mens3', title: '2026 Match Play Tournaments', hold: 18000,
      ids: ['mpt-white-f1', 'mpt-white-f2', 'wga', 'winnie'],
      labels: {
        'mpt-white-f1': "Men's White Tees · Flight 1",
        'mpt-white-f2': "Men's White Tees · Flight 2",
        wga: "Women's Individual Match Play",
        winnie: "Women's Winnie Cup",
      } },
    { type: 'events', name: 'events', title: 'Upcoming Golf Events', hold: 20000 },
  ];
}

/* compact tournament names for the upcoming-matches list */
const UPNAME = {
  palmer: 'Palmer Cup',
  mpc: 'Champ Flight',
  wga: 'WGA Ind.',
  winnie: 'Winnie Cup',
};
const upName = (br) => UPNAME[br.id] ||
  (br.sub || '').replace('Blue/White Tees · Flight ', 'B/W F')
    .replace('Blue Tees · Flight ', 'Blue F')
    .replace('White Tees · Flight ', 'White F') ||
  br.title.replace(/^2026\s*/, '');

/* every not-yet-played match with at least one known player, one entry
 * per known player/team, alphabetized by (first) last name */
function upcomingEntries() {
  const entries = [];
  BRACKETS.forEach((br) => {
    const res = resultsFor(br.id);
    allMatches(br, res).forEach((m) => {
      if (m.result && m.result.winner) return;
      if (!m.top && !m.bot) return;
      const fin = m.side === 'final';
      const due = fin ? br.final.due : br.rounds[m.round - 1].due;
      [[m.top, m.bot], [m.bot, m.top]].forEach(([me, opp]) => {
        if (!me) return;
        entries.push({
          name: me.short,
          opp: opp ? opp.short : 'TBD',
          t: upName(br),
          due: due || '',
        });
      });
    });
  });
  const key = (s) => (s.includes('/') ? s.split('/')[0] : s.split(' ').pop()).trim().toLowerCase();
  entries.sort((a, b) => key(a.name).localeCompare(key(b.name)) || a.name.localeCompare(b.name));
  return entries;
}
const SLIDES = buildSlides();

/* ── Golf Genius portal events (Upcoming Golf Events page) ───────────── */

/* "2026 Men's SWAT " -> "Men's SWAT"; also drop a trailing "| Sat., July
 * 11th" style segment — the date column already says when it is */
const evName = (n) => n.replace(/^20\d\d\s+/, '')
  .replace(/\s*\|\s*[^|]*\b\d{1,2}(st|nd|rd|th)?\s*$/, '')
  .trim();

function fmtDay(iso, weekday) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([],
    weekday ? { weekday: 'short', month: 'short', day: 'numeric' }
            : { month: 'short', day: 'numeric' });
}

/* single day gets its weekday; multi-day events print the range */
const evWhen = (ev) => (ev.end && ev.end !== ev.start
  ? fmtDay(ev.start) + ' – ' + fmtDay(ev.end)
  : fmtDay(ev.start, true));

/* ── Golf Genius bracket results (auto-synced from the portal) ───────── */

/* portal bracket titles -> our bracket ids */
const GG_BRACKET_IDS = {
  'palmer cup': 'palmer',
  'match play championship': 'mpc',
  'blue tee flight 1': 'mpt-blue-f1',
  'blue tee flight 2': 'mpt-blue-f2',
  'blue tee flight 3': 'mpt-blue-f3',
  'blue/white tee flight 1': 'mpt-bw-f1',
  'blue/white tee flight 2': 'mpt-bw-f2',
  'blue/white tee flight 3': 'mpt-bw-f3',
  'white tee flight 1': 'mpt-white-f1',
  'white tee flight 2': 'mpt-white-f2',
  'individual match play': 'wga',
  'winnie cup': 'winnie',
};

/* order-free name matching: "Lege, Eric" == "Eric Lege",
 * "Dixon  /  Usher" == "Dixon / Usher" */
const nameKey = (s) => (String(s).toLowerCase().match(/[a-z']+/g) || []).sort().join('|');
const pairKey = (a, b) => [nameKey(a), nameKey(b)].sort().join('~');

/* overlay the portal bracket onto the admin-entered results — the portal
 * is the official record, so where both exist the portal wins (an
 * admin-entered score survives if the portal has none). Winners advance
 * as results land, so keep passing until nothing changes. */
function deriveResults(bracket, ggList, base) {
  const byPair = {};
  ggList.forEach((m) => { byPair[pairKey(m.top, m.bot)] = m; });
  const merged = { ...base };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    allMatches(bracket, merged).forEach((m) => {
      if (!m.top || !m.bot) return;
      const g = byPair[pairKey(m.top.short, m.bot.short)] ||
                byPair[pairKey(m.top.full, m.bot.full)];
      if (!g) return;
      const gTopIsTop = nameKey(g.top) === nameKey(m.top.short) ||
                        nameKey(g.top) === nameKey(m.top.full);
      const winner = gTopIsTop ? g.winner : 3 - g.winner;
      const prev = merged[m.id];
      const score = g.score ||
        (prev && prev.winner === winner ? prev.score || '' : '');
      if (prev && prev.winner === winner && (prev.score || '') === score) return;
      merged[m.id] = { winner, score };
      changed = true;
    });
    if (!changed) break;
  }
  return merged;
}

function computeMerged() {
  mergedResults = {};
  BRACKETS.forEach((br) => {
    const base = allResults[br.id] || {};
    const gg = ggBrackets[br.id];
    mergedResults[br.id] = gg && gg.length ? deriveResults(br, gg, base) : base;
  });
}

/* what the display draws: admin-entered results + portal-synced gaps.
 * The admin page never syncs, so it falls through to its own entries. */
const resultsFor = (bid) => mergedResults[bid] || allResults[bid] || {};

async function fetchGGResults() {
  try {
    const res = await fetch(RESULTS_FN);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const map = {};
    (data.brackets || []).forEach((b) => {
      const id = GG_BRACKET_IDS[String(b.name || '').replace(/\s+/g, ' ').trim().toLowerCase()];
      if (id) (map[id] = map[id] || []).push(...(b.matches || []));
    });
    ggBrackets = map;
    computeMerged();
    render();
  } catch (e) {
    console.warn('gg results fetch failed', e); /* keep showing last good data */
  }
}

/* ── board config: ticker messages + slide order (from /admin) ───────── */

/* messages scroll in a thin bar across the top; the board slides down
 * beneath it. No messages -> no bar, full-size board. */
function updateTicker() {
  const vp = document.getElementById('viewport');
  const track = document.getElementById('tktrack');
  if (!vp || !track) return;
  if (!boardMessages.length) {
    vp.classList.remove('has-ticker');
    track.innerHTML = '';
    return;
  }
  vp.classList.add('has-ticker');
  track.innerHTML = '';
  const unit = document.createElement('span');
  boardMessages.forEach((m) => {
    unit.appendChild(el('span', 'ftk-msg', m));
    unit.appendChild(el('span', 'ftk-sep', '✦'));
  });
  track.appendChild(unit);
  // each half of the loop must at least fill the screen for a seamless wrap
  const reps = Math.max(1, Math.ceil(W / Math.max(1, unit.scrollWidth)));
  for (let i = 1; i < reps * 2; i++) track.appendChild(unit.cloneNode(true));
  track.style.setProperty('--tk-dur', Math.max(12, (track.scrollWidth / 2) / 70) + 's');
}

/* rotation order set on the admin page; unknown names keep their spot */
function applySlideOrder(names) {
  if (!Array.isArray(names) || !names.length) return;
  const pos = {};
  names.forEach((n, i) => { pos[n] = i; });
  const curName = SLIDES[current] && SLIDES[current].name;
  SLIDES.sort((a, b) => ((a.name in pos) ? pos[a.name] : 99) - ((b.name in pos) ? pos[b.name] : 99));
  const ix = SLIDES.findIndex((s) => s.name === curName);
  if (ix >= 0) current = ix;
}

async function fetchBoardConfig() {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/board_config?select=key,value`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) throw new Error(res.status);
    const cfg = {};
    (await res.json()).forEach((r) => { cfg[r.key] = r.value; });
    const msgs = Array.isArray(cfg.messages)
      ? cfg.messages.filter((m) => typeof m === 'string' && m.trim()).slice(0, 5)
      : [];
    if (JSON.stringify(msgs) !== JSON.stringify(boardMessages)) {
      boardMessages = msgs;
      updateTicker();
    }
    if (Array.isArray(cfg.slide_order)) {
      const before = SLIDES.map((s) => s.name).join();
      applySlideOrder(cfg.slide_order);
      if (SLIDES.map((s) => s.name).join() !== before) render();
    }
  } catch (e) {
    console.warn('board config fetch failed', e); /* keep last good config */
  }
}

/* ── state ───────────────────────────────────────────────────────────── */
let allResults = {};        // bracketId -> matchId -> {winner, score}
let lastPayload = '';
let ggEvents = null;        // payload from the gg-events edge function
let ggBrackets = {};        // bracketId -> [{top, bot, winner, score}] from the portal
let mergedResults = {};     // bracketId -> matchId -> {winner, score}
let boardMessages = [];     // ticker messages from board_config
let current = 0;            // index into SLIDES

/* ── data ────────────────────────────────────────────────────────────── */
async function fetchResults() {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/palmer_matches?select=id,winner,score`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    const payload = JSON.stringify(rows);
    if (payload !== lastPayload) {
      lastPayload = payload;
      allResults = {};
      rows.forEach((r) => {
        const ix = r.id.indexOf(':');
        if (ix < 0) return;
        const bid = r.id.slice(0, ix), mid = r.id.slice(ix + 1);
        (allResults[bid] = allResults[bid] || {})[mid] = r;
      });
      computeMerged();
      render();
    }
  } catch (e) {
    console.warn('fetch failed', e); /* keep showing last good data */
  }
}

async function fetchEvents() {
  try {
    const res = await fetch(EVENTS_FN);
    if (!res.ok) throw new Error(res.status);
    ggEvents = await res.json();
    if (SLIDES[current] && SLIDES[current].type === 'events') render();
  } catch (e) {
    console.warn('events fetch failed', e); /* keep showing last good data */
  }
}

/* earliest round of this bracket that still has an undecided match */
function currentRound(bracket) {
  const results = resultsFor(bracket.id);
  const b = buildBracket(bracket, results);
  for (let r = 1; r <= b.left.nRounds; r++) {
    for (const side of [b.left, b.right]) {
      const col = side.columns[r - 1];
      for (let k = 0; k < col.length; k += 2) {
        const s = col[k];
        if (s.matchId && !(s.result && s.result.winner)) return bracket.rounds[r - 1];
      }
    }
  }
  if (!(results.F1 && results.F1.winner)) return bracket.final;
  return null;   // all decided
}

/* compact score text so it fits the connector channel */
function abbrevScore(s) {
  const t = String(s).trim();
  let m;
  if ((m = t.match(/^(\d+)\s*&\s*(\d+)$/))) return m[1] + '&' + m[2];
  if ((m = t.match(/^(\d+)\s*up$/i))) return m[1] + 'UP';
  if ((m = t.match(/^(\d+)\s*holes?$/i))) return m[1] + 'H';
  if (/^forfeit$/i.test(t)) return 'FFT';
  if (/^coin\s*flip$/i.test(t)) return 'CF';
  return t;
}

/* ── DOM helpers ─────────────────────────────────────────────────────── */
function el(tag, cls, txt) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
}

/* name badge: plain regular-case name */
function nameNm(short) {
  return el('span', 'nm', short || '');
}

function wirePath(svg, d, hot) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  if (hot) p.classList.add('hot');
  svg.appendChild(p);
}

/* ── render one bracket into a 1920×1080 view node ───────────────────── */

/* Vertical layout: bye pairs take a slimmer span (the freed room goes
 * to real matches), shown in printed order — byes on top. gExtra is the
 * in-pair gap beyond the box height (small when the score sits beside
 * or below the matchup, larger when it sits between the players). */
function computeY(side, y0, BH, quads, BH1, gExtra, evenR1) {
  const leaves = side.columns[0];
  const nP = leaves.length / 2;
  const isByeP = (p) => {
    const a = leaves[2 * p].team, c = leaves[2 * p + 1].team;
    return !!((a && a.isBye) || (c && c.isBye));
  };
  const QGAP = quads ? 20 : 0;
  // round 2 sits on an exactly even grid; each round-1 matchup is
  // centered on its round-2 slot so the connector splits the name evenly
  const unit2 = (BH - QGAP) / nP;
  const y = {};
  let divider = null;
  if (quads) divider = y0 + (nP / 2) * unit2 + QGAP / 2;
  for (let p = 0; p < nP; p++) {
    const yc = y0 + (p + 0.5) * unit2 + (quads && p >= nP / 2 ? QGAP : 0);
    y['2:' + p] = yc;
    if (!isByeP(p)) {
      const g = BH1 + gExtra;
      y['1:' + (2 * p)] = yc - g / 2;
      y['1:' + (2 * p + 1)] = yc + g / 2;
    }
  }
  // offset brackets (e.g. Winnie Cup): their first round shares a page
  // column with neighbors' round 2, so spread its slots on that grid too
  if (evenR1) {
    const s1 = (BH - QGAP) / (2 * nP);
    for (let p = 0; p < nP; p++) {
      if (isByeP(p)) continue;
      y['1:' + (2 * p)] = y0 + (2 * p + 0.5) * s1;
      y['1:' + (2 * p + 1)] = y0 + (2 * p + 1.5) * s1;
      y['2:' + p] = (y['1:' + (2 * p)] + y['1:' + (2 * p + 1)]) / 2;
    }
  }
  for (let r = 3; r <= side.nRounds; r++) {
    const n = leaves.length / 2 ** (r - 1);
    for (let i = 0; i < n; i++) {
      y[r + ':' + i] = (y[(r - 1) + ':' + (2 * i)] + y[(r - 1) + ':' + (2 * i + 1)]) / 2;
    }
  }
  return { y, divider, isByeP };
}

function renderInto(view, bracket, opts = {}) {
  const results = resultsFor(bracket.id);
  const lines = opts.variant === 'lines';   // classic: names on lines, no boxes
  const base = GEOM[bracket.left.length];
  const CH = opts.canvasH || H;
  const G = opts.band ? BANDGEOM
    : (opts.compact && opts.canvasH ? miniGeom(base, bracket.left.length, CH) : base);
  view.className = 'brview ' + G.cls + (opts.compact ? ' mini' : '') +
    (opts.dense ? ' band-sm' : '') +
    (opts.variant ? ' ' + opts.variant : '') +
    (bracket.accent ? ' acc-' + bracket.accent : '');
  view.style.height = CH + 'px';

  const BH = CH - G.y0 - G.yBottom;
  const off = opts.colOffset || 0;
  const colXL = (r) => G.marginX + (r - 1 + off) * G.step;
  const colXR = (r) => W - G.marginX - G.boxW - (r - 1 + off) * G.step;
  const centerX = G.marginX + (bracket.rounds.length + off) * G.step;
  const centerW = W - 2 * centerX;

  // header (band mode puts the title in the center column instead)
  if (!opts.band) {
    const hdr = el('header', 'hdr');
    const titles = el('div', 'titles');
    if (opts.compact) {
      titles.appendChild(el('h1', null, opts.label || bracket.sub || bracket.title));
    } else {
      titles.appendChild(el('h1', null, opts.title || bracket.title));
      const sub = opts.sub !== undefined ? opts.sub : bracket.sub;
      if (sub) titles.appendChild(el('div', 'sub flight', sub));
    }
    hdr.appendChild(titles);
    view.appendChild(hdr);
  }

  const b = buildBracket(bracket, results);
  // size boxes by PAGE column, not bracket round, so offset brackets
  // (e.g. Winnie Cup) match their neighbors' boxes in the same column
  const bh = (r) => G.boxH[opts.band ? r + off : r];
  const bcls = (r) => (opts.band ? r + off : r);
  const evenR1 = !!opts.band && off > 0;
  // tight pairs everywhere: round-1 scores print below the match
  const maps = {
    left: computeY(b.left, G.y0, BH, !!bracket.quads, bh(1), 4, evenR1),
    right: computeY(b.right, G.y0, BH, !!bracket.quads, bh(1), 4, evenR1),
  };
  const Y = (sideKey, r, i) => maps[sideKey].y[r + ':' + i];

  const wrap = el('div', 'brk');
  view.appendChild(wrap);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wires');
  svg.setAttribute('viewBox', `0 0 ${W} ${CH}`);
  svg.setAttribute('width', W); svg.setAttribute('height', CH);
  wrap.appendChild(svg);

  // faint divider between the top and bottom groups of 16 (Palmer)
  if (bracket.quads) {
    [['left', 12, centerX - 30], ['right', W - centerX + 30, W - 12]].forEach(([sideKey, x1, x2]) => {
      const yb = Math.round(maps[sideKey].divider);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${x1},${yb} H${x2}`);
      p.setAttribute('class', 'qdivider');
      svg.appendChild(p);
    });
  }

  // column headers (stack pages draw a single shared row instead)
  if (!opts.band) {
    bracket.rounds.forEach((rd, ri) => {
      [colXL(ri + 1), colXR(ri + 1)].forEach((x) => {
        const hEl = el('div', 'colhead');
        hEl.textContent = rd.label;
        if (rd.due) hEl.appendChild(el('small', null, 'by ' + rd.due));
        hEl.style.left = x + 'px';
        hEl.style.width = G.boxW + 'px';
        hEl.style.top = G.headTop + 'px';
        wrap.appendChild(hEl);
      });
    });
    // championship joins the round labels in the center column
    const cEl = el('div', 'colhead ch-final');
    cEl.textContent = bracket.final.label;
    if (bracket.final.due) cEl.appendChild(el('small', null, 'by ' + bracket.final.due));
    cEl.style.left = centerX + 'px';
    cEl.style.width = centerW + 'px';
    cEl.style.top = G.headTop + 'px';
    wrap.appendChild(cEl);
    // faint club crest watermark behind the championship area
    if (!opts.compact) {
      const wm = document.createElement('img');
      wm.className = 'crest-wm';
      wm.src = 'assets/logo.png';
      const wmW = 380;
      wm.style.width = wmW + 'px';
      wm.style.left = (W / 2 - wmW / 2) + 'px';
      wm.style.top = (G.y0 + BH / 2 - wmW / 2 - 40) + 'px';
      wrap.insertBefore(wm, svg);
    }
  }

  // slot boxes + wires (bye pairs render nothing in round 1)
  [['left', b.left], ['right', b.right]].forEach(([sideKey, side]) => {
    const colX = sideKey === 'left' ? colXL : colXR;
    side.columns.forEach((slots, ri) => {
      const r = ri + 1;
      slots.forEach((slot) => {
        const yc = Y(sideKey, r, slot.i);
        if (yc === undefined) return;          // collapsed bye slot
        let d;
        if (slot.team && slot.team.isBye) return;
        if (!slot.team) {
          d = el('div', `slot r${bcls(r)}` + (r === 1 ? ' await' : ' empty'));
          d.appendChild(el('span', 'nm', ''));
        } else {
          d = el('div', `slot r${bcls(r)}`);
          d.appendChild(nameNm(slot.team.short));
          // admin page: which match this name plays in, and which seat
          if (slot.matchId) {
            d.dataset.mid = slot.matchId;
            d.dataset.win = slot.i % 2 === 0 ? '1' : '2';
          }
          if (slot.result && slot.result.winner) {
            const won = (slot.result.winner === 1) === (slot.i % 2 === 0);
            d.classList.add(won ? 'won' : 'lost');
          }
          // Palmer Cup diagonal: red top-left & bottom-right, green the other two
          if (bracket.quads && d.classList.contains('won')) {
            const topHalf = slot.i < slots.length / 2;
            const green = (sideKey === 'left' && !topHalf) ||
                          (sideKey === 'right' && topHalf);
            if (green) d.classList.add('wq-green');
          }
        }
        // capsule corner faces the displayed partner (byes may be flipped)
        const py = Y(sideKey, r, slot.i ^ 1);
        d.classList.add(py === undefined || yc < py ? 'mt' : 'mb', 's-' + sideKey);
        d.style.left = colX(r) + 'px';
        // classic mode: name sits ABOVE the connector line (box bottom = yc)
        d.style.top = ((lines ? yc - bh(r) : yc - bh(r) / 2)) + 'px';
        d.style.height = bh(r) + 'px';
        d.style.width = G.boxW + 'px';
        wrap.appendChild(d);
      });
      // match score: below the match in round 1, between the players
      // (tucked toward the bracket) in every later round
      for (let k = 0; k < slots.length / 2; k++) {
        const res = slots[2 * k].result;
        if (!res || !res.winner || !res.score) continue;
        const yA = Y(sideKey, r, 2 * k), yB = Y(sideKey, r, 2 * k + 1);
        if (yA === undefined || yB === undefined) continue;
        // Palmer diagonal: this match's score is green in the green quadrants
        const topHalf = 2 * k < slots.length / 2;
        const qGreen = bracket.quads &&
          ((sideKey === 'left' && !topHalf) || (sideKey === 'right' && topHalf));
        const qcls = qGreen ? ' wq-green' : '';
        let tag;
        if (r === 1 && !evenR1 && !opts.band) {
          tag = el('div', 'advtag below' + qcls, res.score);
          tag.style.left = colX(r) + 'px';
          tag.style.width = G.boxW + 'px';
          tag.style.top = (Math.max(yA, yB) + bh(r) / 2 + 5) + 'px';
        } else {
          tag = el('div', 'advtag mid ' + (sideKey === 'left' ? 'ma-r' : 'ma-l') + qcls, res.score);
          tag.style.left = colX(r) + 'px';
          tag.style.width = G.boxW + 'px';
          // top-right of the match: a fixed fraction down from the top line so
          // tight and roomy matchups both read the same (like the Palmer Cup)
          tag.style.top = (Math.min(yA, yB) + Math.abs(yA - yB) * 0.2) + 'px';
        }
        wrap.appendChild(tag);
      }
      if (r < side.nRounds) {
        for (let k = 0; k < slots.length / 2; k++) {
          const yA = Y(sideKey, r, 2 * k), yB = Y(sideKey, r, 2 * k + 1);
          if (yA === undefined || yB === undefined) continue;  // bye pair
          const yC = Y(sideKey, r + 1, k);
          const hot = !lines && !!side.columns[r][k].team;
          const half = (G.step - G.boxW) / 2;
          // vertical spans the arms AND the next-round stub height
          const vT = Math.min(yA, yC), vB = Math.max(yB, yC);
          if (sideKey === 'left') {
            const inner = colX(r) + G.boxW, xm = inner + half, x2 = colX(r + 1);
            // classic mode: the arm runs under the whole name (from box edge)
            const s = lines ? colX(r) : inner;
            wirePath(svg, `M${s},${yA} H${xm} M${s},${yB} H${xm} M${xm},${vT} V${vB} M${xm},${yC} H${x2}`, hot);
          } else {
            const inner = colX(r), xm = inner - half, x2 = colX(r + 1) + G.boxW;
            const s = lines ? colX(r) + G.boxW : inner;
            wirePath(svg, `M${s},${yA} H${xm} M${s},${yB} H${xm} M${xm},${vT} V${vB} M${xm},${yC} H${x2}`, hot);
          }
        }
      }
    });
  });

  // center championship panel
  const panel = el('div', 'center');
  panel.style.left = centerX + 'px';
  panel.style.width = centerW + 'px';

  if (opts.band) {
    // title centered across the whole page, pinned above the final match
    const tw = el('div', 'band-titlewrap');
    tw.appendChild(el('h1', 'band-title', opts.label || bracket.sub || bracket.title));
    tw.style.left = '0px';
    tw.style.width = W + 'px';
    wrap.appendChild(tw);
    view._bandTitle = tw;
  }

  const fRes = b.final.result;
  const mk = (team, isTop) => {
    const box = el('div', 'fwrap');
    const f = el('div', 'fslot ' + (isTop ? 'ftop' : 'fbot') + (team ? '' : ' empty'));
    if (team) {
      f.appendChild(nameNm(team.short));
      f.dataset.mid = 'F1';
      f.dataset.win = isTop ? '1' : '2';
    }
    if (team && fRes && fRes.winner) {
      f.classList.add(((fRes.winner === 1) === isTop) ? 'won' : 'lost');
    }
    box.appendChild(f);
    return box;
  };
  panel.appendChild(mk(b.final.top, true));
  panel.appendChild(el('div', 'vs', 'VS'));
  panel.appendChild(mk(b.final.bot, false));
  wrap.appendChild(panel);

  // champion box, label under it (positioned below, once we know heights)
  const cw = el('div', 'champwrap');
  const cbox = el('div', 'champbox' + (b.final.champion ? ' won' : ' empty'));
  if (b.final.champion) cbox.appendChild(nameNm(b.final.champion.short));
  cw.appendChild(cbox);
  if (b.final.champScore) cw.appendChild(el('div', 'fadv', b.final.champScore));
  cw.appendChild(el('div', 'champlbl', bracket.champLabel));
  cw.style.left = (centerX + 10) + 'px';
  cw.style.width = (centerW - 20) + 'px';
  wrap.appendChild(cw);
  // align the champion box to the finalist lines (same width & x)
  const fwrap0 = panel.querySelector('.fwrap');
  if (fwrap0) {
    cw.style.left = (centerX + fwrap0.offsetLeft) + 'px';
    cw.style.width = fwrap0.offsetWidth + 'px';
  }

  // place the championship column vertically
  let panelTop, champTop;
  if (opts.band) {
    panelTop = Math.round(G.y0 + BH / 2 - 62);          // uniform band center
    champTop = G.y0 + BH - G.champUp;
  } else if (opts.compact) {
    panelTop = Math.round(G.y0 + BH / 2 - panel.offsetHeight / 2);
    champTop = G.y0 + BH - G.champUp;
  } else {
    // full page: finalists + champion are one block, centered so there is
    // an even amount of space above the finalists and below the champion
    const gap = 74;
    const total = panel.offsetHeight + gap + cw.offsetHeight;
    const blockTop = Math.round(G.y0 + (BH - total) / 2);
    panelTop = blockTop;
    champTop = blockTop + panel.offsetHeight + gap;
  }
  panel.style.top = panelTop + 'px';
  cw.style.top = champTop + 'px';

  if (opts.band && view._bandTitle) {
    view._bandTitle.style.top = Math.max(0, panelTop - 52) + 'px';
  }

  // full page: the bracket name sits as a centered title above the
  // semifinals, matching the flight titles on the other pages
  if (opts.centerLabel && !opts.band) {
    const cl = el('div', 'center-label');
    cl.textContent = opts.centerLabel;
    cl.style.left = centerX + 'px';
    cl.style.width = centerW + 'px';
    cl.style.top = (panelTop - 74) + 'px';
    wrap.appendChild(cl);
  }

  // wires from each side final into the final slots (measure actual layout).
  // classic mode connects at the slot's underline (bottom), else its center.
  const fslots = panel.querySelectorAll('.fslot');
  const fInto = (fs) => panelTop + fs.offsetTop + (lines ? fs.offsetHeight : fs.offsetHeight / 2);
  const f1Mid = fInto(fslots[0]);
  const f2Mid = fInto(fslots[1]);
  const nR = b.left.nRounds;
  // left semifinal connects into the TOP finalist slot, right into the BOTTOM
  const fw = panel.querySelectorAll('.fwrap');
  const fLeftEdge = centerX + fw[0].offsetLeft;
  const fRightEdge = centerX + fw[1].offsetLeft + fw[1].offsetWidth;
  // one straight line from the semifinal brace into the finalist slot
  {
    const yA = Y('left', nR, 0), yB = Y('left', nR, 1);
    const inner = colXL(nR) + G.boxW, xm = inner + (G.step - G.boxW) / 2;
    const s = lines ? colXL(nR) : inner;
    const vT = Math.min(yA, f1Mid), vB = Math.max(yB, f1Mid);
    wirePath(svg, `M${s},${yA} H${xm} M${s},${yB} H${xm} M${xm},${vT} V${vB} M${xm},${f1Mid} H${fLeftEdge}`, !lines && !!b.final.top);
  }
  {
    const yA = Y('right', nR, 0), yB = Y('right', nR, 1);
    const inner = colXR(nR), xm = inner - (G.step - G.boxW) / 2;
    const s = lines ? colXR(nR) + G.boxW : inner;
    const vT = Math.min(yA, f2Mid), vB = Math.max(yB, f2Mid);
    wirePath(svg, `M${s},${yA} H${xm} M${s},${yB} H${xm} M${xm},${vT} V${vB} M${xm},${f2Mid} H${fRightEdge}`, !lines && !!b.final.bot);
  }
  // classic mode: link the final down to the champion box
  if (lines) {
    const midX = Math.round(centerX + fwrap0.offsetLeft + fwrap0.offsetWidth / 2);
    const yTop = Math.max(f1Mid, f2Mid);
    wirePath(svg, `M${midX},${yTop} V${champTop}`);
  }

  // shrink any names that overflow their box instead of ellipsizing
  view.querySelectorAll('.slot .nm, .fslot .nm, .champbox .nm').forEach((nm) => {
    if (!nm.textContent) return;
    const range = document.createRange();
    range.selectNodeContents(nm);
    let size = parseFloat(getComputedStyle(nm.parentElement).fontSize);
    let guard = 24;
    while (guard-- > 0 && size > 8.5 &&
           range.getBoundingClientRect().width > nm.getBoundingClientRect().width - 0.5) {
      size -= 0.5;
      nm.parentElement.style.fontSize = size + 'px';
    }
  });
}

/* ── render the current slide ────────────────────────────────────────── */
function render() {
  const slide = SLIDES[current];
  const world = document.getElementById('world');
  world.innerHTML = '';
  // theme goes on the world only, so the top/bottom bars stay identical
  world.classList.toggle('ladies', slide.theme === 'ladies');

  const byId = (id) => BRACKETS.find((b) => b.id === id);

  if (slide.type === 'full') {
    const view = el('div');
    world.appendChild(view);
    renderInto(view, byId(slide.ids[0]),
      { variant: slide.variant, title: slide.title, sub: '', centerLabel: slide.label });
  } else if (slide.type === 'stack') {
    // brackets stacked full-width like one big sheet
    const th = el('div', 'slide-hdr');
    th.appendChild(el('h1', null, slide.title));
    world.appendChild(th);
    // one shared row of round labels for the whole page
    const pageBr = slide.ids.map(byId)
      .reduce((a, c) => (c.rounds.length > a.rounds.length ? c : a));
    const pageRounds = pageBr.rounds;
    pageRounds.forEach((rd, ri) => {
      [BANDGEOM.marginX + ri * BANDGEOM.step,
       W - BANDGEOM.marginX - BANDGEOM.boxW - ri * BANDGEOM.step].forEach((x) => {
        const hEl = el('div', 'colhead');
        hEl.textContent = rd.label;
        if (rd.due) hEl.appendChild(el('small', null, 'by ' + rd.due));
        hEl.style.left = x + 'px';
        hEl.style.width = BANDGEOM.boxW + 'px';
        hEl.style.top = '98px';
        world.appendChild(hEl);
      });
    });
    // championship label sits with the rounds, centered on the page
    const cX = BANDGEOM.marginX + pageRounds.length * BANDGEOM.step;
    const fEl = el('div', 'colhead ch-final');
    fEl.textContent = pageBr.final.label;
    if (pageBr.final.due) fEl.appendChild(el('small', null, 'by ' + pageBr.final.due));
    fEl.style.left = cX + 'px';
    fEl.style.width = (W - 2 * cX) + 'px';
    fEl.style.top = '98px';
    world.appendChild(fEl);
    const n = slide.ids.length;
    // fewer brackets → more breathing room between them
    const titleH = 140, padBottom = 42, gap = n <= 3 ? 30 : 18;
    const bandH = Math.floor((H - titleH - padBottom - (n - 1) * gap) / n);
    slide.ids.forEach((id, i) => {
      const br = byId(id);
      const cell = el('div', 'cellwrap');
      cell.style.left = '0px';
      cell.style.top = (titleH + i * (bandH + gap)) + 'px';
      cell.style.width = W + 'px';
      cell.style.height = bandH + 'px';
      world.appendChild(cell);
      const view = el('div');
      cell.appendChild(view);
      renderInto(view, br, {
        band: true, canvasH: bandH, dense: n >= 4, variant: 'lines',
        label: (slide.labels || {})[id],
        colOffset: pageRounds.length - br.rounds.length,
      });
    });
  } else if (slide.type === 'list') {
    // upcoming-matches directory: every open match, per player, A-Z
    const th = el('div', 'slide-hdr');
    th.appendChild(el('h1', null, slide.title));
    world.appendChild(th);
    const entries = upcomingEntries();
    slide._count = entries.length;
    const box = el('div', 'uplist');
    const groups = [
      ['Individual Matches', entries.filter((e) => !e.name.includes('/'))],
      ['Team Matches', entries.filter((e) => e.name.includes('/'))],
    ];
    groups.forEach(([label, list]) => {
      if (!list.length) return;
      box.appendChild(el('div', 'up-sec', label));
      const colsEl = el('div', 'upcols');
      list.forEach((e) => {
        const it = el('div', 'upitem');
        it.appendChild(el('span', 'up-name', e.name));
        it.appendChild(el('span', 'up-mid', e.t + ' · vs ' + e.opp));
        if (e.due) it.appendChild(el('span', 'up-due', e.due));
        colsEl.appendChild(it);
      });
      box.appendChild(colsEl);
    });
    world.appendChild(box);
    // pick the largest type tier that still fits the page
    for (const t of ['roomy', '', 'dense', 'denser', 'densest']) {
      box.className = 'uplist' + (t ? ' ' + t : '');
      if (box.scrollHeight <= box.clientHeight + 2) break;
    }
  } else if (slide.type === 'events') {
    // portal event calendar as a plain list on the background: upcoming
    // tournaments in date order (tagged by category), the recurring weekly
    // leagues with their next few round dates, then instruction/junior in
    // the same row style as the tournaments.
    const th = el('div', 'slide-hdr');
    th.appendChild(el('h1', null, slide.title));
    world.appendChild(th);
    const page = el('div', 'evpage');
    const today = new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD
    const cats = (ggEvents && ggEvents.categories) || [];
    const GROUPS = [
      { label: 'Club Tournaments', keys: ['mens', 'womens', 'mixed'], kind: 'future' },
      { label: 'Weekly Events', keys: ['mens', 'womens', 'mixed'], kind: 'league' },
      { label: 'Golf Instruction & Junior Golf', keys: ['junior', 'instruction'], kind: 'future' },
    ];
    const TAG = { mens: ["Men's", 'men'], womens: ["Women's", 'wom'],
      mixed: ['Mixed', 'mix'], junior: ['Junior', 'jr'], instruction: ['Adult', 'ad'] };
    let total = 0;
    GROUPS.forEach((g) => {
      const list = [];
      cats.filter((c) => g.keys.includes(c.key)).forEach((c) => {
        (c.events || []).forEach((ev) => {
          const isLeague = ev.product === 'league';
          if (g.kind === 'league'
            ? (isLeague && ev.end && ev.end >= today)
            : (!isLeague && ev.start && ev.start > today)) {
            list.push({ ...ev, cat: c.key });
          }
        });
      });
      const upNext = (ev) => (ev.upcoming || []).filter((d) => d >= today);
      const sortKey = (ev) => (g.kind === 'league'
        ? (upNext(ev)[0] || ev.next || ev.end)
        : ev.start);
      list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.name.localeCompare(b.name));
      total += list.length;
      page.appendChild(el('div', 'up-sec', g.label));
      const listEl = el('div', 'evlist');
      if (!list.length) listEl.appendChild(el('div', 'ev-none', 'Nothing on the calendar'));
      list.forEach((ev) => {
        const [tagTxt, tagCls] = TAG[ev.cat] || [ev.cat, ''];
        const row = el('div', 'evrow t-' + tagCls);
        // when column: next few rounds for a league, else the event date(s)
        const when = el('div', 'evr-when');
        if (g.kind === 'league') {
          const ups = upNext(ev).slice(0, 3);
          if (ups.length) {
            ups.forEach((d, i) => {
              if (i) when.appendChild(el('span', 'evr-dot', '·'));
              when.appendChild(el('span', 'evr-d', fmtDay(d, true)));
            });
          } else if (ev.next) {
            when.appendChild(el('span', 'evr-d', fmtDay(ev.next, true)));
          }
        } else {
          when.appendChild(el('span', 'evr-d', evWhen(ev)));
        }
        row.appendChild(when);
        // name + category tag
        const main = el('div', 'evr-main');
        main.appendChild(el('span', 'evr-tag', tagTxt));
        main.appendChild(el('span', 'evr-name', evName(ev.name)));
        row.appendChild(main);
        // registration: deadline (tournaments/instruction only) + status
        const reg = el('div', 'evr-reg');
        if (g.kind !== 'league') {
          let deadline = '';
          if (ev.status === 'Open' && ev.regEnd && ev.regEnd >= today) {
            deadline = 'Register by ' + fmtDay(ev.regEnd);   // open now, closes then
          } else if (ev.status !== 'Open' && ev.status !== 'Closed'
                     && ev.regStart && ev.regStart > today) {
            deadline = 'Opens ' + fmtDay(ev.regStart);       // not open yet
          }
          if (deadline) reg.appendChild(el('span', 'evr-deadline', deadline));
        }
        const st = ev.status === 'Open' ? ['open', 'Registration Open']
          : ev.status === 'Closed' ? ['closed', 'Registration Closed']
          : ['soon', 'Opening Soon'];
        reg.appendChild(el('span', 'evr-status ' + st[0], st[1]));
        row.appendChild(reg);
        listEl.appendChild(row);
      });
      page.appendChild(listEl);
    });
    slide._count = total;
    if (!cats.length) {
      page.innerHTML = '';
      page.appendChild(el('div', 'ev-empty', 'Loading events…'));
    }
    world.appendChild(page);
    // pick the largest row size that still fits the page
    for (const t of ['grand', '', 'dense', 'denser']) {
      page.className = 'evpage' + (t ? ' ' + t : '');
      if (page.scrollHeight <= page.clientHeight + 2) break;
    }
  } else {
    // grid of scaled mini brackets under a slide title band
    if (slide.title) {
      const th = el('div', 'slide-hdr');
      th.appendChild(el('h1', null, slide.title));
      world.appendChild(th);
    }
    const n = slide.ids.length;
    const cols = slide.cols || 2;
    const rows = Math.ceil(n / cols);
    const titleH = slide.title ? 84 : 20;
    const padX = 16, padBottom = 48, gap = 10;
    const cellW = (W - 2 * padX - (cols - 1) * gap) / cols;
    const cellH = (H - titleH - padBottom - (rows - 1) * gap) / rows;
    // stretch each mini's canvas vertically so it fills its cell edge to edge
    const sW = cellW / W;
    const canvasH = Math.max(900, Math.min(1980, Math.round(cellH / sW)));
    const s = Math.min(sW, cellH / canvasH);
    const drawW = W * s, drawH = canvasH * s;
    slide.ids.forEach((id, i) => {
      const c = i % cols, rw = Math.floor(i / cols);
      const inRow = Math.min(cols, n - rw * cols);  // cells in this row
      let cx;
      if (c === 0) cx = padX;                        // flush left
      else if (c === inRow - 1) cx = W - padX - drawW; // flush right
      else {
        // middle cells spread evenly between the flush outer cells
        cx = padX + c * ((W - 2 * padX - drawW) / (inRow - 1));
      }
      const cy = titleH + rw * (cellH + gap) + (cellH - drawH) / 2;
      const cell = el('div', 'cellwrap');
      cell.style.left = cx + 'px';
      cell.style.top = cy + 'px';
      cell.style.width = drawW + 'px';
      cell.style.height = drawH + 'px';
      world.appendChild(cell);
      const view = el('div');
      view.style.transform = `scale(${s})`;
      view.style.transformOrigin = '0 0';
      cell.appendChild(view);
      renderInto(view, byId(id), {
        compact: true, canvasH,
        label: (slide.labels || {})[id],
      });
      // bracket titles smaller than the 44px page title
      const h1 = view.querySelector('.hdr h1');
      if (h1) h1.style.fontSize = (31 / s) + 'px';
    });
  }

  // corner crests flank the page title
  const h1 = world.querySelector('.slide-hdr h1, .hdr h1');
  const lw = document.querySelector('.cl-left');
  const rw = document.querySelector('.cl-right');
  if (h1 && lw && rw) {
    const half = h1.offsetWidth / 2 + 54;
    const logoW = lw.offsetWidth || 42;
    lw.style.left = `calc(50% - ${half + logoW}px)`;
    rw.style.right = 'auto';
    rw.style.left = `calc(50% + ${half}px)`;
    lw.style.top = '27px';
    rw.style.top = '27px';
  }

  // footer: current round for this page's brackets (or open-match count)
  const fr = document.getElementById('fround');
  if (fr) {
    if (slide.type === 'list') {
      fr.textContent = (slide._count || 0) + ' Matches To Play';
    } else if (slide.type === 'events') {
      fr.textContent = (slide._count || 0) + ' Upcoming Events';
    } else {
      const rep = slide.ids.map(byId)
        .reduce((a, c) => (c.rounds.length > a.rounds.length ? c : a));
      const rd = currentRound(rep);
      fr.textContent = rd
        ? 'Current Round: ' + rd.label + (rd.due ? ' · by ' + rd.due : '')
        : 'Bracket Complete';
    }
  }

  // rotation dots
  const dots = document.getElementById('dots');
  dots.innerHTML = '';
  SLIDES.forEach((_, i) => dots.appendChild(el('span', 'dot2' + (i === current ? ' on' : ''))));
}

/* ── slide rotation ──────────────────────────────────────────────────── */
function armTimer(ms) {
  const f = document.getElementById('timerfill');
  f.style.transition = 'none';
  f.style.width = '0%';
  void f.offsetWidth;
  f.style.transition = `width ${ms}ms linear`;
  f.style.width = '100%';
}

function startRotation() {
  const params = new URLSearchParams(location.search);
  const pinned = params.get('bracket') || params.get('slide');
  if (pinned) {
    const ix = SLIDES.findIndex((s) => s.name === pinned);
    if (ix >= 0) { current = ix; }
    else if (BRACKETS.some((b) => b.id === pinned)) {
      SLIDES.push({ type: 'full', name: pinned, ids: [pinned],
        theme: (BRACKETS.find((b) => b.id === pinned) || {}).theme });
      current = SLIDES.length - 1;
    }
    render();
    document.getElementById('timerbar').style.display = 'none';
    return;
  }
  function next() {
    const hold = SLIDES[current].hold || HOLD_DEFAULT;
    armTimer(hold);
    const vp = document.getElementById('viewport');
    setTimeout(() => {
      vp.classList.add('fading');            // fade the whole page out…
      setTimeout(() => {
        current = (current + 1) % SLIDES.length;
        render();
        vp.classList.remove('fading');       // …and the new one back in
        next();
      }, FADE_MS);
    }, hold);
  }
  next();
}

/* ── fit stage to screen ─────────────────────────────────────────────── */
function fit() {
  const f = document.getElementById('fit');
  if (!f) return;   // admin page has no stage
  // stretch to fill the screen exactly — no bars on any side. On a 16:9
  // screen this is a perfect uniform fit; elsewhere the slight stretch
  // is preferable to letterboxing. ?fit=uniform restores letterboxed fit.
  const params = new URLSearchParams(location.search);
  if (params.get('fit') === 'uniform') {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    f.style.transform = `translate(-50%, -50%) scale(${s})`;
  } else {
    f.style.transform =
      `translate(-50%, -50%) scale(${window.innerWidth / W}, ${window.innerHeight / H})`;
  }
}

function tickClock() {
  const c = document.getElementById('fdate');
  if (!c) return;
  const d = new Date();
  c.textContent =
    d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* reload when a new version deploys: the page's etag changes on Vercel */
let pageEtag = null;
async function checkVersion() {
  try {
    const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
    const tag = res.headers.get('etag');
    if (!tag) return;
    if (pageEtag === null) { pageEtag = tag; return; }
    if (tag !== pageEtag) location.reload();
  } catch (e) { /* offline — try again next tick */ }
}

/* keep the screen awake on browsers that support the Wake Lock API */
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {});
      });
    }
  } catch (e) { /* not supported — kiosk app handles it */ }
}

window.addEventListener('resize', fit);
window.addEventListener('DOMContentLoaded', () => {
  if (window.ADMIN_MODE) return;   // admin page drives rendering itself
  keepAwake();
  fit();
  render();
  // re-render once fonts land so title/crest positions measure correctly
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render());
  fetchResults();
  fetchEvents();
  fetchGGResults();
  fetchBoardConfig();
  startRotation();
  tickClock();
  setInterval(fetchResults, 45000);
  setInterval(fetchEvents, 30 * 60000);
  setInterval(fetchGGResults, 10 * 60000);
  setInterval(fetchBoardConfig, 60000);
  checkVersion();
  setInterval(checkVersion, 5 * 60000);
  setInterval(tickClock, 5000);
  // nightly reload to pick up any site updates
  setInterval(() => {
    const d = new Date();
    if (d.getHours() === 4 && d.getMinutes() === 10) location.reload();
  }, 60000);
});
