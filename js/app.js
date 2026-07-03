/* 2026 Match Play brackets — 16:9 rotating TV display */

/* ── geometry (fixed 1920×1080 design canvas) ────────────────────────── */
const W = 1920, H = 1080;

/* per-bracket-size layout: 32 leaves/side (Palmer) vs 8 leaves/side */
const GEOM = {
  32: { marginX: 30, boxW: 148, step: 162, y0: 136, yBottom: 56,
        boxH: { 1: 24, 2: 26, 3: 30, 4: 34, 5: 40 }, cls: 'b64',
        headTop: 104, panelH: 380 },
  8:  { marginX: 56, boxW: 236, step: 260, y0: 190, yBottom: 90,
        boxH: { 1: 52, 2: 58, 3: 64 }, cls: 'b16',
        headTop: 150, panelH: 420 },
};

/* ── state ───────────────────────────────────────────────────────────── */
let allResults = {};        // bracketId -> matchId -> {winner, score}
let lastPayload = '';
let current = 0;            // index into BRACKETS

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

/* ── render ──────────────────────────────────────────────────────────── */
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

function render() {
  const bracket = BRACKETS[current];
  const results = allResults[bracket.id] || {};
  const G = GEOM[bracket.left.length];
  const BH = H - G.y0 - G.yBottom;
  const nLeaves = bracket.left.length;
  const pitch = BH / nLeaves;
  const colXL = (r) => G.marginX + (r - 1) * G.step;
  const colXR = (r) => W - G.marginX - G.boxW - (r - 1) * G.step;
  const centerX = G.marginX + bracket.rounds.length * G.step;
  const centerW = W - 2 * centerX;
  const slotYC = (r, i) => G.y0 + (i + 0.5) * pitch * 2 ** (r - 1);

  const world = document.getElementById('world');
  world.className = G.cls;
  document.body.classList.toggle('ladies', bracket.theme === 'ladies');

  // header
  document.getElementById('title').textContent = bracket.title;
  const subEl = document.getElementById('subtitle');
  subEl.textContent = bracket.sub || 'Match Play · Championship Bracket';
  subEl.classList.toggle('flight', !!bracket.sub);

  const b = buildBracket(bracket, results);
  const wrap = document.getElementById('bracket');
  wrap.innerHTML = '';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'wires';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
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
          // blank leaf = solid awaiting-name box; downstream TBD = dashed
          d = el('div', `slot r${r}` + (r === 1 ? ' await' : ' empty'));
          d.appendChild(el('span', 'nm', ''));
        } else {
          d = el('div', `slot r${r}`);
          d.appendChild(el('span', 'nm', slot.team.short));
          if (slot.autoWin) d.classList.add('won');
          if (slot.result && slot.result.winner) {
            const won = (slot.result.winner === 1) === (slot.i % 2 === 0);
            d.classList.add(won ? 'won' : 'lost');
            if (won && slot.result.score) d.appendChild(el('span', 'sc', slot.result.score));
          }
        }
        d.style.left = colX(r) + 'px';
        d.style.top = (slotYC(r, slot.i) - G.boxH[r] / 2) + 'px';
        d.style.height = G.boxH[r] + 'px';
        d.style.width = G.boxW + 'px';
        wrap.appendChild(d);
      });
      // wires to next column
      if (r < side.nRounds) {
        for (let k = 0; k < slots.length / 2; k++) {
          const yA = slotYC(r, 2 * k), yB = slotYC(r, 2 * k + 1), yC = slotYC(r + 1, k);
          const hot = !!side.columns[r][k].team;
          if (sideKey === 'left') {
            const x1 = colX(r) + G.boxW, xm = x1 + G.step - G.boxW - 8, x2 = colX(r + 1);
            wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`, hot);
          } else {
            const x1 = colX(r), xm = x1 - (G.step - G.boxW) + 8, x2 = colX(r + 1) + G.boxW;
            wirePath(svg, `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`, hot);
          }
        }
      }
    });
  });

  // center championship panel
  const panel = el('div', null); panel.id = 'center';
  panel.style.left = centerX + 'px';
  panel.style.width = centerW + 'px';

  const crest = document.createElement('img');
  crest.src = 'assets/logo.png'; crest.className = 'crest'; crest.alt = '';
  panel.appendChild(crest);
  panel.appendChild(el('div', 'fin-title', bracket.final.label));
  if (bracket.final.due) panel.appendChild(el('div', 'fin-date', 'by ' + bracket.final.due));

  const fRes = b.final.result;
  const mk = (team, isTop) => {
    const f = el('div', 'fslot' + (team ? '' : ' empty'), team ? team.short : '');
    if (team && fRes && fRes.winner) {
      const won = (fRes.winner === 1) === isTop;
      f.classList.add(won ? 'won' : 'lost');
      if (won && fRes.score) f.appendChild(el('span', 'sc', fRes.score));
    }
    return f;
  };
  panel.appendChild(mk(b.final.top, true));
  panel.appendChild(el('div', 'vs', 'VS'));
  panel.appendChild(mk(b.final.bot, false));

  const champ = el('div', 'champ');
  champ.appendChild(el('div', 'lbl', bracket.champLabel));
  champ.appendChild(el('div', 'who' + (b.final.champion ? '' : ' tbd'),
    b.final.champion ? b.final.champion.short : 'To be decided'));
  panel.appendChild(champ);
  wrap.appendChild(panel);

  const panelTop = G.y0 + BH / 2 - G.panelH / 2;
  panel.style.top = panelTop + 'px';

  // wires from each side final into the final slots
  const crestH = G.cls === 'b16' ? 110 : 96;
  const f1Mid = panelTop + crestH + 10 + 31 + (bracket.final.due ? 24 : 6) + 8 + 22;
  const f2Mid = f1Mid + 22 + 8 + 21 + 8 + 22;
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
  wrap.querySelectorAll('.slot .nm').forEach((nm) => {
    let size = parseFloat(getComputedStyle(nm.parentElement).fontSize);
    while (nm.scrollWidth >= nm.clientWidth && size > 8.5) {
      size -= 0.5;
      nm.parentElement.style.fontSize = size + 'px';
    }
  });

  // rotation dots
  const dots = document.getElementById('dots');
  dots.innerHTML = '';
  BRACKETS.forEach((_, i) => dots.appendChild(el('span', 'dot2' + (i === current ? ' on' : ''))));
}

/* ── bracket rotation ────────────────────────────────────────────────── */
const HOLD = { palmer: 25000 };   // default below for the rest
const HOLD_DEFAULT = 14000;
const FADE_MS = 600;

/* fill the bottom bar from 0 → 100% over the current slide's hold time */
function armTimer(ms) {
  const f = document.getElementById('timerfill');
  f.style.transition = 'none';
  f.style.width = '0%';
  void f.offsetWidth;                          // flush so the reset lands
  f.style.transition = `width ${ms}ms linear`;
  f.style.width = '100%';
}

function startRotation() {
  const params = new URLSearchParams(location.search);
  const pinned = params.get('bracket');       // ?bracket=palmer pins one
  if (pinned) {
    const ix = BRACKETS.findIndex((br) => br.id === pinned);
    if (ix >= 0) { current = ix; render(); }
    document.getElementById('timerbar').style.display = 'none';
    return;
  }
  function next() {
    const hold = HOLD[BRACKETS[current].id] || HOLD_DEFAULT;
    armTimer(hold);
    const world = document.getElementById('world');
    setTimeout(() => {
      world.classList.add('fading');
      setTimeout(() => {
        current = (current + 1) % BRACKETS.length;
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
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  document.getElementById('fit').style.transform = `translate(-50%, -50%) scale(${s})`;
}

function tickClock() {
  const c = document.getElementById('clock');
  if (c) c.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

window.addEventListener('resize', fit);
window.addEventListener('DOMContentLoaded', () => {
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
