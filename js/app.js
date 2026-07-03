/* 2026 Palmer Cup — 16:9 rotating bracket display */

/* ── geometry (fixed 1920×1080 design canvas) ────────────────────────── */
const W = 1920, H = 1080;
const BOX_W = 152, STEP = 168;
const Y0 = 132, BH = 1080 - Y0 - 48;      // bracket band
const PITCH = BH / 32;
const BOX_H = { 1: 24, 2: 26, 3: 30, 4: 34, 5: 40 };
const CENTER_X = 840, CENTER_W = 240;

const colXL = (r) => 8 + (r - 1) * STEP;
const colXR = (r) => W - 8 - BOX_W - (r - 1) * STEP;
const slotYC = (r, i) => Y0 + (i + 0.5) * PITCH * 2 ** (r - 1);

/* ── state ───────────────────────────────────────────────────────────── */
let results = {};
let lastPayload = '';

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
      results = {};
      rows.forEach((r) => { results[r.id] = r; });
      render();
      stamp();
    }
  } catch (e) {
    /* keep showing last good data */
    console.warn('fetch failed', e);
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

function slotBox(slot, r, x) {
  const yc = slotYC(r, slot.i);
  const h = BOX_H[r];
  let d;
  if (slot.team && slot.team.isBye) {
    d = el('div', `slot bye r${r}`, 'Bye');
  } else if (!slot.team) {
    d = el('div', `slot empty r${r}`);
    d.appendChild(el('span', 'nm', ''));
  } else {
    d = el('div', `slot r${r}`);
    d.appendChild(el('span', 'nm', slot.team.short));
    if (slot.autoWin) d.classList.add('won');
    // won/lost coloring: this slot's own match (feeding next round) decided?
    if (slot.result && slot.result.winner) {
      const iAmTop = slot.i % 2 === 0;
      const won = (slot.result.winner === 1) === iAmTop;
      d.classList.add(won ? 'won' : 'lost');
      if (won && slot.result.score) d.appendChild(el('span', 'sc', slot.result.score));
    }
  }
  d.style.left = x + 'px';
  d.style.top = (yc - h / 2) + 'px';
  d.style.height = h + 'px';
  return d;
}

function wirePath(d, hot) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  if (hot) p.classList.add('hot');
  return p;
}

function render() {
  const b = buildBracket(results);
  const wrap = document.getElementById('bracket');
  wrap.innerHTML = '';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'wires';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  wrap.appendChild(svg);

  // column headers
  EVENT.rounds.slice(0, 5).forEach((rd) => {
    [[colXL(rd.n)], [colXR(rd.n)]].forEach(([x]) => {
      const hEl = el('div', 'colhead');
      hEl.textContent = rd.label;
      const s = el('small', null, 'by ' + rd.due);
      hEl.appendChild(s);
      hEl.style.left = x + 'px';
      hEl.style.top = '100px';
      wrap.appendChild(hEl);
    });
  });

  // sides
  [['left', b.left], ['right', b.right]].forEach(([sideKey, side]) => {
    const colX = sideKey === 'left' ? colXL : colXR;
    for (let r = 1; r <= 5; r++) {
      side.columns[r - 1].forEach((slot) => wrap.appendChild(slotBox(slot, r, colX(r))));
    }
    // wires between rounds
    for (let r = 1; r <= 4; r++) {
      const n = 2 ** (6 - r);
      for (let k = 0; k < n / 2; k++) {
        const yA = slotYC(r, 2 * k), yB = slotYC(r, 2 * k + 1), yC = slotYC(r + 1, k);
        const decided = !!side.columns[r][k].team; // next-round slot filled
        let d;
        if (sideKey === 'left') {
          const x1 = colX(r) + BOX_W, xm = x1 + STEP - BOX_W - 8, x2 = colX(r + 1);
          d = `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`;
        } else {
          const x1 = colX(r), xm = x1 - (STEP - BOX_W) + 8, x2 = colX(r + 1) + BOX_W;
          d = `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${yC} H${x2}`;
        }
        svg.appendChild(wirePath(d, decided));
      }
    }
  });

  // center championship panel
  const panel = el('div', null); panel.id = 'center';
  panel.style.left = CENTER_X + 'px';
  panel.style.width = CENTER_W + 'px';

  const crest = document.createElement('img');
  crest.src = 'assets/logo.png'; crest.className = 'crest'; crest.alt = '';
  panel.appendChild(crest);
  panel.appendChild(el('div', 'fin-title', 'Championship'));
  panel.appendChild(el('div', 'fin-date', 'by Oct 31'));

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
  const f1 = mk(b.final.top, true);
  const f2 = mk(b.final.bot, false);
  panel.appendChild(f1);
  panel.appendChild(el('div', 'vs', 'VS'));
  panel.appendChild(f2);

  const champ = el('div', 'champ');
  champ.appendChild(el('div', 'lbl', 'Palmer Cup Champions'));
  champ.appendChild(el('div', 'who' + (b.final.champion ? '' : ' tbd'),
    b.final.champion ? b.final.champion.short : 'To be decided'));
  panel.appendChild(champ);
  wrap.appendChild(panel);

  // shrink any names that overflow their box instead of ellipsizing
  wrap.querySelectorAll('.slot .nm').forEach((nm) => {
    let size = parseFloat(getComputedStyle(nm.parentElement).fontSize);
    while (nm.scrollWidth > nm.clientWidth && size > 8.5) {
      size -= 0.5;
      nm.parentElement.style.fontSize = size + 'px';
    }
  });

  // vertical placement of panel + wires from side finals into it
  const panelH = 380;
  const panelTop = Y0 + BH / 2 - panelH / 2;
  panel.style.top = panelTop + 'px';

  // measure-ish: fslots sit below crest(96)+title(31)+date(24) ≈ 165 within panel
  const f1Mid = panelTop + 96 + 10 + 31 + 24 + 8 + 22;
  const f2Mid = f1Mid + 22 + 8 + 21 + 8 + 22;

  { // left side final → final slot 1
    const yA = slotYC(5, 0), yB = slotYC(5, 1);
    const x1 = colXL(5) + BOX_W, xm = x1 + 6;
    svg.appendChild(wirePath(
      `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${CENTER_X + 4} V${f1Mid} H${CENTER_X + 10}`,
      !!b.final.top));
  }
  { // right side final → final slot 2
    const yA = slotYC(5, 0), yB = slotYC(5, 1);
    const x1 = colXR(5), xm = x1 - 6;
    svg.appendChild(wirePath(
      `M${x1},${yA} H${xm} V${yB} H${x1} M${xm},${(yA + yB) / 2} H${CENTER_X + CENTER_W - 4} V${f2Mid} H${CENTER_X + CENTER_W - 10}`,
      !!b.final.bot));
  }
}

/* ── camera (rotation) ───────────────────────────────────────────────── */
const world = () => document.getElementById('world');

const VIEWS = [
  { name: 'full',  rect: [0, 0, 1920, 1080],  hold: 18000, pan: false },
  { name: 'left',  rect: [0, 0, 1080, 1080],  hold: 27000, pan: true },
  { name: 'right', rect: [840, 0, 1080, 1080], hold: 27000, pan: true },
];
const ZOOM_MS = 2600;

function applyCam(x0, y, s, ms, ease) {
  const w = world();
  w.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
  w.style.transform = `translate(${-x0 * s}px, ${-y * s}px) scale(${s})`;
}

function startRotation() {
  const params = new URLSearchParams(location.search);
  const fixed = params.get('view');           // ?view=full|left|right pins one view
  let idx = 0;
  const seq = fixed ? VIEWS.filter(v => v.name === fixed) : VIEWS;
  if (!seq.length) seq.push(VIEWS[0]);

  function show() {
    const v = seq[idx];
    const [x0, , rw] = v.rect;
    const s = W / rw;
    applyCam(x0, 0, s, ZOOM_MS, 'cubic-bezier(.45,.05,.25,1)');
    if (v.pan && !fixed) {
      const visH = H / s;
      const yEnd = Math.max(0, H - visH);
      setTimeout(() => {
        applyCam(x0, yEnd, s, v.hold - ZOOM_MS - 800, 'linear');
      }, ZOOM_MS + 400);
    }
    if (!fixed || seq.length > 1) {
      setTimeout(() => { idx = (idx + 1) % seq.length; show(); }, v.hold + ZOOM_MS);
    }
  }
  show();
}

/* ── fit stage to screen ─────────────────────────────────────────────── */
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  document.getElementById('fit').style.transform =
    `translate(-50%, -50%) scale(${s})`;
}

/* ── clock + kiosk hygiene ───────────────────────────────────────────── */
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
    const h = new Date().getHours(), m = new Date().getMinutes();
    if (h === 4 && m === 10) location.reload();
  }, 60000);
});
