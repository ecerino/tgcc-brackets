/* 2026 Match Play brackets — 16:9 rotating TV display */

/* ── geometry (fixed 1920×1080 design canvas per bracket view) ───────── */
const W = 1920, H = 1080;

/* per-bracket-size layout: 32 leaves/side (Palmer) vs 8 vs 4 */
const GEOM = {
  32: { marginX: 22, boxW: 158, step: 168, y0: 132, yBottom: 58,
        boxH: { 1: 25, 2: 28, 3: 32, 4: 38, 5: 44 }, cls: 'b64',
        headTop: 100, panelH: 200, champUp: 100 },
  8:  { marginX: 52, boxW: 248, step: 264, y0: 196, yBottom: 96,
        boxH: { 1: 58, 2: 64, 3: 70 }, cls: 'b16',
        headTop: 152, panelH: 250, champUp: 120 },
  4:  { marginX: 110, boxW: 320, step: 350, y0: 210, yBottom: 110,
        boxH: { 1: 68, 2: 76 }, cls: 'b16 b8',
        headTop: 162, panelH: 260, champUp: 130 },
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

/* full-width stacked bands: Palmer-sized badges, lines stretch to fill */
const BANDGEOM = {
  8: { marginX: 22, boxW: 175, step: 262, y0: 52, yBottom: 8,
       boxH: { 1: 25, 2: 28, 3: 32 }, cls: 'band',
       headTop: 4, panelH: 200, champUp: 54 },
  4: { marginX: 22, boxW: 330, step: 394, y0: 52, yBottom: 8,
       boxH: { 1: 26, 2: 30 }, cls: 'band',
       headTop: 4, panelH: 200, champUp: 54 },
};

/* ── slides: every full bracket + composite screens ──────────────────── */
const HOLD_DEFAULT = 14000;
const FADE_MS = 600;

function buildSlides() {
  return [
    { type: 'full', name: 'palmer', ids: ['palmer'], hold: 25000 },
    { type: 'stack', name: 'mens1', title: "Men's Match Play Tournaments", hold: 20000,
      ids: ['mpc', 'mpt-blue-f1', 'mpt-blue-f2'],
      labels: { mpc: 'Championship Flight' } },
    { type: 'stack', name: 'mens2', title: "Men's Match Play Tournaments", hold: 20000,
      ids: ['mpt-blue-f3', 'mpt-bw-f1', 'mpt-bw-f2'] },
    { type: 'stack', name: 'mens3', title: "Men's Match Play Tournaments", hold: 20000,
      ids: ['mpt-bw-f3', 'mpt-white-f1', 'mpt-white-f2'] },
    { type: 'stack', name: 'ladies', title: 'WGA Match Play', theme: 'ladies', hold: 18000,
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
      stamp();
    }
  } catch (e) {
    console.warn('fetch failed', e); /* keep showing last good data */
  }
}

function stamp() {
  const el = document.getElementById('updated');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
function renderInto(view, bracket, opts = {}) {
  const results = allResults[bracket.id] || {};
  const base = GEOM[bracket.left.length];
  const CH = opts.canvasH || H;
  const G = opts.band ? BANDGEOM[bracket.left.length]
    : (opts.compact && opts.canvasH ? miniGeom(base, bracket.left.length, CH) : base);
  view.className = 'brview ' + G.cls + (opts.compact ? ' mini' : '') +
    (bracket.accent === 'green' ? ' acc-green' : '');
  view.style.height = CH + 'px';

  const BH = CH - G.y0 - G.yBottom;
  const pitch = BH / bracket.left.length;
  const colXL = (r) => G.marginX + (r - 1) * G.step;
  const colXR = (r) => W - G.marginX - G.boxW - (r - 1) * G.step;
  const centerX = G.marginX + bracket.rounds.length * G.step;
  const centerW = W - 2 * centerX;
  const slotYC = (r, i) => G.y0 + (i + 0.5) * pitch * 2 ** (r - 1);

  // header (band mode puts the title in the center column instead)
  if (!opts.band) {
    const hdr = el('header', 'hdr');
    const titles = el('div', 'titles');
    if (opts.compact) {
      titles.appendChild(el('h1', null, opts.label || bracket.sub || bracket.title));
    } else {
      titles.appendChild(el('h1', null, bracket.title));
      if (bracket.sub) {
        const s = el('div', 'sub flight', bracket.sub);
        titles.appendChild(s);
      }
    }
    hdr.appendChild(titles);
    view.appendChild(hdr);
  }

  const b = buildBracket(bracket, results);
  const wrap = el('div', 'brk');
  view.appendChild(wrap);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wires');
  svg.setAttribute('viewBox', `0 0 ${W} ${CH}`);
  svg.setAttribute('width', W); svg.setAttribute('height', CH);
  wrap.appendChild(svg);

  // column headers
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

  // slot boxes + wires
  [['left', b.left], ['right', b.right]].forEach(([sideKey, side]) => {
    const colX = sideKey === 'left' ? colXL : colXR;
    side.columns.forEach((slots, ri) => {
      const r = ri + 1;
      slots.forEach((slot) => {
        let d;
        if (slot.team && slot.team.isBye) {
          d = el('div', `slot bye r${r}`, 'Bye');
        } else if (!slot.team) {
          d = el('div', `slot r${r}` + (r === 1 ? ' await' : ' empty'));
          d.appendChild(el('span', 'nm', ''));
        } else {
          d = el('div', `slot r${r}`);
          d.appendChild(el('span', 'nm', slot.team.short));
          if (slot.autoWin) d.classList.add('won');
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
        d.style.top = (slotYC(r, slot.i) - G.boxH[r] / 2) + 'px';
        d.style.height = G.boxH[r] + 'px';
        d.style.width = G.boxW + 'px';
        wrap.appendChild(d);
        if (slot.advScore) {
          const tag = el('div', 'advtag', slot.advScore);
          tag.style.left = colX(r) + 'px';
          tag.style.width = G.boxW + 'px';
          tag.style.top = (slotYC(r, slot.i) + G.boxH[r] / 2 + 3) + 'px';
          wrap.appendChild(tag);
        }
      });
      if (r < side.nRounds) {
        for (let k = 0; k < slots.length / 2; k++) {
          const yA = slotYC(r, 2 * k), yB = slotYC(r, 2 * k + 1), yC = slotYC(r + 1, k);
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
    tw.style.top = '2px';
    wrap.appendChild(tw);
  } else {
    panel.appendChild(el('div', 'fin-title', bracket.final.label));
    if (bracket.final.due) panel.appendChild(el('div', 'fin-date', 'by ' + bracket.final.due));
  }

  const fRes = b.final.result;
  const mk = (team, isTop, advScore) => {
    const box = el('div', 'fwrap');
    const f = el('div', 'fslot ' + (isTop ? 'ftop' : 'fbot') + (team ? '' : ' empty'));
    if (team) f.appendChild(el('span', 'nm', team.short));
    if (team && fRes && fRes.winner) {
      f.classList.add(((fRes.winner === 1) === isTop) ? 'won' : 'lost');
    }
    box.appendChild(f);
    if (team && advScore) box.appendChild(el('div', 'fadv', advScore));
    return box;
  };
  panel.appendChild(mk(b.final.top, true, b.final.topScore));
  panel.appendChild(el('div', 'vs', 'VS'));
  panel.appendChild(mk(b.final.bot, false, b.final.botScore));
  wrap.appendChild(panel);

  const panelTop = opts.band
    ? Math.round(G.y0 + BH / 2 - 64)   // center the VS block in the band
    : G.y0 + BH / 2 - G.panelH / 2;
  panel.style.top = panelTop + 'px';

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
  {
    const yA = slotYC(nR, 0), yB = slotYC(nR, 1);
    const x1 = colXL(nR) + G.boxW, xm = x1 + 6;
    wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${centerX + 4} V${f1Mid} H${centerX + 10}`, !!b.final.top);
  }
  {
    const yA = slotYC(nR, 0), yB = slotYC(nR, 1);
    const x1 = colXR(nR), xm = x1 - 6;
    wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${centerX + centerW - 4} V${f2Mid} H${centerX + centerW - 10}`, !!b.final.bot);
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
  document.body.classList.toggle('ladies', slide.theme === 'ladies');

  const byId = (id) => BRACKETS.find((b) => b.id === id);

  if (slide.type === 'full') {
    const view = el('div');
    world.appendChild(view);
    renderInto(view, byId(slide.ids[0]));
  } else if (slide.type === 'stack') {
    // four brackets stacked full-width like one big sheet
    const th = el('div', 'slide-hdr');
    th.appendChild(el('h1', null, slide.title));
    world.appendChild(th);
    const titleH = 84, padBottom = 44, gap = 8;
    const bandH = Math.floor((H - titleH - padBottom - (slide.ids.length - 1) * gap) / slide.ids.length);
    slide.ids.forEach((id, i) => {
      const cell = el('div', 'cellwrap');
      cell.style.left = '0px';
      cell.style.top = (titleH + i * (bandH + gap)) + 'px';
      cell.style.width = W + 'px';
      cell.style.height = bandH + 'px';
      world.appendChild(cell);
      const view = el('div');
      cell.appendChild(view);
      renderInto(view, byId(id), {
        band: true, canvasH: bandH,
        label: (slide.labels || {})[id],
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
    const world = document.getElementById('world');
    setTimeout(() => {
      world.classList.add('fading');
      setTimeout(() => {
        current = (current + 1) % SLIDES.length;
        render();
        world.classList.remove('fading');
        next();
      }, FADE_MS);
    }, hold);
  }
  next();
}

/* ── fit stage to screen ─────────────────────────────────────────────── */
function fit() {
  // cover: the framed stage always touches every edge of the screen
  const params = new URLSearchParams(location.search);
  const mode = params.get('fit') === 'contain' ? Math.min : Math.max;
  const s = mode(window.innerWidth / W, window.innerHeight / H);
  document.getElementById('fit').style.transform = `translate(-50%, -50%) scale(${s})`;
}

function tickClock() {
  const c = document.getElementById('clock');
  if (c) c.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  keepAwake();
  fit();
  render();
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
