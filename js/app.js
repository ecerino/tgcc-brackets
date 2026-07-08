/* 2026 Match Play brackets — 16:9 rotating TV display */

/* ── geometry (fixed 1920×1080 design canvas per bracket view) ───────── */
const W = 1920, H = 1080;

/* per-bracket-size layout: 32 leaves/side (Palmer) vs 8 vs 4 */
const GEOM = {
  32: { marginX: 22, boxW: 154, step: 168, y0: 148, yBottom: 52,
        boxH: { 1: 27, 2: 27, 3: 27, 4: 27, 5: 27 }, cls: 'b64',
        headTop: 106, panelH: 200, champUp: 100 },
  8:  { marginX: 52, boxW: 248, step: 264, y0: 196, yBottom: 96,
        boxH: { 1: 58, 2: 58, 3: 58 }, cls: 'b16',
        headTop: 106, panelH: 250, champUp: 120 },
  4:  { marginX: 110, boxW: 320, step: 350, y0: 210, yBottom: 110,
        boxH: { 1: 68, 2: 68 }, cls: 'b16 b8',
        headTop: 106, panelH: 260, champUp: 130 },
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
  boxH: { 1: 26, 2: 26, 3: 26 }, cls: 'band',
  headTop: 0, panelH: 200, champUp: 54,
};

/* ── slides: every full bracket + composite screens ──────────────────── */
const HOLD_DEFAULT = 14000;
const FADE_MS = 600;

function buildSlides() {
  return [
    { type: 'full', name: 'palmer', ids: ['palmer'], hold: 25000 },
    { type: 'stack', name: 'mens1', title: "2026 Men's Match Play Tournaments", hold: 20000,
      ids: ['mpc', 'mpt-blue-f1', 'mpt-blue-f2'],
      labels: { mpc: 'Championship Flight' } },
    { type: 'stack', name: 'mens2', title: "2026 Men's Match Play Tournaments", hold: 20000,
      ids: ['mpt-blue-f3', 'mpt-bw-f1', 'mpt-bw-f2'] },
    { type: 'stack', name: 'mens3', title: "2026 Men's Match Play Tournaments", hold: 20000,
      ids: ['mpt-bw-f3', 'mpt-white-f1', 'mpt-white-f2'] },
    { type: 'stack', name: 'ladies', title: '2026 WGA Match Play Tournaments',
      theme: 'ladies', hold: 18000,
      ids: ['winnie', 'wga'],
      labels: { wga: 'Individual Match Play', winnie: 'Winnie Cup' } },
  ];
}
const SLIDES = buildSlides();

/* ── state ───────────────────────────────────────────────────────────── */
let allResults = {};        // bracketId -> matchId -> {winner, score}
let lastPayload = '';
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
      render();
    }
  } catch (e) {
    console.warn('fetch failed', e); /* keep showing last good data */
  }
}

/* earliest round of this bracket that still has an undecided match */
function currentRound(bracket) {
  const results = allResults[bracket.id] || {};
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

/* ── DOM helpers ─────────────────────────────────────────────────────── */
function el(tag, cls, txt) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
}

function wirePath(svg, d, hot) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  if (hot) p.classList.add('hot');
  svg.appendChild(p);
}

/* ── render one bracket into a 1920×1080 view node ───────────────────── */

/* Vertical layout: bye pairs are collapsed — the seeded player first
 * appears in round 2, taking ~60% of the space a real match needs. */
function computeY(side, y0, BH, quads, BH1) {
  const leaves = side.columns[0];
  const nP = leaves.length / 2;
  const isByeP = (p) => {
    const a = leaves[2 * p].team, c = leaves[2 * p + 1].team;
    return !!((a && a.isBye) || (c && c.isBye));
  };
  const UNIT_BYE = 1.0;
  let U = 0;
  for (let p = 0; p < nP; p++) U += isByeP(p) ? UNIT_BYE : 2;
  const QGAP = quads ? 20 : 0;
  const unitH = (BH - QGAP) / U;
  const y = {};
  let cur = y0;
  let divider = null;
  for (let p = 0; p < nP; p++) {
    if (quads && p === nP / 2) { divider = cur + QGAP / 2; cur += QGAP; }
    if (isByeP(p)) {
      y['2:' + p] = cur + (UNIT_BYE * unitH) / 2;
      cur += UNIT_BYE * unitH;
    } else {
      // small uniform pair gap — the score sits on the connector brace
      const mid = cur + unitH;
      const gMax = 2 * unitH - BH1 - 6;
      const g = Math.max(BH1 + 3, Math.min(BH1 + 8, gMax));
      y['1:' + (2 * p)] = mid - g / 2;
      y['1:' + (2 * p + 1)] = mid + g / 2;
      y['2:' + p] = mid;
      cur += 2 * unitH;
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
  const results = allResults[bracket.id] || {};
  const base = GEOM[bracket.left.length];
  const CH = opts.canvasH || H;
  const G = opts.band ? BANDGEOM
    : (opts.compact && opts.canvasH ? miniGeom(base, bracket.left.length, CH) : base);
  view.className = 'brview ' + G.cls + (opts.compact ? ' mini' : '') +
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
      titles.appendChild(el('h1', null, bracket.title));
      if (bracket.sub) titles.appendChild(el('div', 'sub flight', bracket.sub));
    }
    hdr.appendChild(titles);
    view.appendChild(hdr);
  }

  const b = buildBracket(bracket, results);
  // size boxes by PAGE column, not bracket round, so offset brackets
  // (e.g. Winnie Cup) match their neighbors' boxes in the same column
  const bh = (r) => G.boxH[opts.band ? r + off : r];
  const bcls = (r) => (opts.band ? r + off : r);
  const maps = {
    left: computeY(b.left, G.y0, BH, !!bracket.quads, bh(1)),
    right: computeY(b.right, G.y0, BH, !!bracket.quads, bh(1)),
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
          d.appendChild(el('span', 'nm', slot.team.short));
          // admin page: which match this name plays in, and which seat
          if (slot.matchId) {
            d.dataset.mid = slot.matchId;
            d.dataset.win = slot.i % 2 === 0 ? '1' : '2';
          }
          if (slot.result && slot.result.winner) {
            const won = (slot.result.winner === 1) === (slot.i % 2 === 0);
            d.classList.add(won ? 'won' : 'lost');
          }
          // Palmer Cup quadrants: red TL, charcoal BL, green TR, gold BR
          if (bracket.quads && d.classList.contains('won')) {
            const topHalf = slot.i < slots.length / 2;
            if (sideKey === 'left' && !topHalf) d.classList.add('wq-char');
            else if (sideKey === 'right' && topHalf) d.classList.add('wq-green');
            else if (sideKey === 'right' && !topHalf) d.classList.add('wq-gold');
          }
        }
        d.classList.add(slot.i % 2 === 0 ? 'mt' : 'mb', 's-' + sideKey);
        d.style.left = colX(r) + 'px';
        d.style.top = (yc - bh(r) / 2) + 'px';
        d.style.height = bh(r) + 'px';
        d.style.width = G.boxW + 'px';
        wrap.appendChild(d);
      });
      // match score written sideways on the pair's connector brace
      for (let k = 0; k < slots.length / 2; k++) {
        const res = slots[2 * k].result;
        if (!res || !res.winner || !res.score) continue;
        const yA = Y(sideKey, r, 2 * k), yB = Y(sideKey, r, 2 * k + 1);
        if (yA === undefined || yB === undefined) continue;
        const halfW = (G.step - G.boxW) / 2;
        const xm = sideKey === 'left' ? colX(r) + G.boxW + halfW : colX(r) - halfW;
        const tag = el('div', 'advtag vert ' + (sideKey === 'left' ? 'vl' : 'vr'), res.score);
        tag.style.left = xm + 'px';
        tag.style.top = ((yA + yB) / 2) + 'px';
        wrap.appendChild(tag);
      }
      if (r < side.nRounds) {
        for (let k = 0; k < slots.length / 2; k++) {
          const yA = Y(sideKey, r, 2 * k), yB = Y(sideKey, r, 2 * k + 1);
          if (yA === undefined || yB === undefined) continue;  // bye pair
          const yC = Y(sideKey, r + 1, k);
          const hot = !!side.columns[r][k].team;
          const half = (G.step - G.boxW) / 2;
          if (sideKey === 'left') {
            const x1 = colX(r) + G.boxW, xm = x1 + half, x2 = colX(r + 1);
            wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`, hot);
          } else {
            const x1 = colX(r), xm = x1 - half, x2 = colX(r + 1) + G.boxW;
            wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`, hot);
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
    // title pinned to the top of the band; the final match centers below
    const tw = el('div', 'band-titlewrap');
    tw.appendChild(el('h1', 'band-title', opts.label || bracket.sub || bracket.title));
    tw.style.left = centerX + 'px';
    tw.style.width = centerW + 'px';
    wrap.appendChild(tw);
    view._bandTitle = tw;
  }

  const fRes = b.final.result;
  const mk = (team, isTop) => {
    const box = el('div', 'fwrap');
    const f = el('div', 'fslot ' + (isTop ? 'ftop' : 'fbot') + (team ? '' : ' empty'));
    if (team) {
      f.appendChild(el('span', 'nm', team.short));
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

  const nRr = b.left.nRounds;
  const semiMid = ((Y('left', nRr, 0) + Y('left', nRr, 1)) / 2 +
                   (Y('right', nRr, 0) + Y('right', nRr, 1)) / 2) / 2;
  const panelTop = opts.band
    ? Math.round(G.y0 + BH / 2 - 62)    // fixed band center: uniform across pages
    : Math.round(G.y0 + BH / 2 - panel.offsetHeight / 2);
  panel.style.top = panelTop + 'px';

  if (opts.band && view._bandTitle) {
    view._bandTitle.style.top = Math.max(0, panelTop - 52) + 'px';
  }

  // champion box at the bottom of the bracket, label under it
  const cw = el('div', 'champwrap');
  const cbox = el('div', 'champbox' + (b.final.champion ? ' won' : ' empty'));
  if (b.final.champion) cbox.appendChild(el('span', 'nm', b.final.champion.short));
  cw.appendChild(cbox);
  if (b.final.champScore) cw.appendChild(el('div', 'fadv', b.final.champScore));
  cw.appendChild(el('div', 'champlbl', bracket.champLabel));
  cw.style.left = (centerX + 10) + 'px';
  cw.style.width = (centerW - 20) + 'px';
  cw.style.top = (G.y0 + BH - G.champUp) + 'px';
  wrap.appendChild(cw);

  // wires from each side final into the final slots (measure actual layout)
  const fslots = panel.querySelectorAll('.fslot');
  const f1Mid = panelTop + fslots[0].offsetTop + fslots[0].offsetHeight / 2;
  const f2Mid = panelTop + fslots[1].offsetTop + fslots[1].offsetHeight / 2;
  const nR = b.left.nRounds;
  // left semifinal connects into the TOP finalist slot, right into the BOTTOM
  const fw = panel.querySelectorAll('.fwrap');
  const fLeftEdge = centerX + fw[0].offsetLeft;
  const fRightEdge = centerX + fw[1].offsetLeft + fw[1].offsetWidth;
  {
    const yA = Y('left', nR, 0), yB = Y('left', nR, 1);
    const x1 = colXL(nR) + G.boxW, xm = x1 + (G.step - G.boxW) / 2;
    wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${fLeftEdge - 22} V${f1Mid} H${fLeftEdge}`, !!b.final.top);
  }
  {
    const yA = Y('right', nR, 0), yB = Y('right', nR, 1);
    const x1 = colXR(nR), xm = x1 - (G.step - G.boxW) / 2;
    wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${fRightEdge + 22} V${f2Mid} H${fRightEdge}`, !!b.final.bot);
  }

  // shrink any names that overflow their box instead of ellipsizing
  view.querySelectorAll('.slot .nm').forEach((nm) => {
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
    renderInto(view, byId(slide.ids[0]));
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
        hEl.style.top = '106px';
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
    fEl.style.top = '106px';
    world.appendChild(fEl);
    const titleH = 148, padBottom = 42, gap = 18;
    const bandH = Math.floor((H - titleH - padBottom - (slide.ids.length - 1) * gap) / slide.ids.length);
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
        band: true, canvasH: bandH,
        label: (slide.labels || {})[id],
        colOffset: pageRounds.length - br.rounds.length,
      });
    });
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

  // footer: current round for this page's brackets
  const fr = document.getElementById('fround');
  if (fr) {
    const rep = slide.ids.map(byId)
      .reduce((a, c) => (c.rounds.length > a.rounds.length ? c : a));
    const rd = currentRound(rep);
    fr.textContent = rd
      ? 'Current Round: ' + rd.label + (rd.due ? ' · by ' + rd.due : '')
      : 'Bracket Complete';
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
  startRotation();
  tickClock();
  setInterval(fetchResults, 45000);
  setInterval(tickClock, 5000);
  // nightly reload to pick up any site updates
  setInterval(() => {
    const d = new Date();
    if (d.getHours() === 4 && d.getMinutes() === 10) location.reload();
  }, 60000);
});
