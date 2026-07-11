/* Brackets admin — shows the live bracket; tap a name to record the win. */

let results = {};            // matchId -> row, scoped to the selected bracket
let selected = BRACKETS[0];
let pin = localStorage.getItem('palmer_pin') || '';

const $ = (id) => document.getElementById(id);

function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = ''; }, 2600);
}

async function api(body) {
  const res = await fetch(ADMIN_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}

async function loadResults() {
  const prefix = selected.id + ':';
  const res = await fetch(
    `${SUPA_URL}/rest/v1/palmer_matches?select=id,winner,score&id=like.${encodeURIComponent(prefix + '*')}`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  const rows = await res.json();
  results = {};
  rows.forEach((r) => { results[r.id.slice(prefix.length)] = r; });
}

/* ── login ───────────────────────────────────────────────────────────── */
async function tryLogin() {
  pin = $('pin').value.trim();
  if (!pin) return;
  $('gate-err').textContent = '';
  $('login').textContent = 'Checking…';
  try {
    await api({ action: 'verify' });
    localStorage.setItem('palmer_pin', pin);
    $('gate').hidden = true;
    $('app').hidden = false;
    buildPicker();
    await loadBoardTab();
  } catch (e) {
    $('gate-err').textContent = e.message === 'bad pin' ? 'Wrong PIN — try again.' : ('Error: ' + e.message);
  }
  $('login').textContent = 'Unlock';
}

/* ── tabs: Board (ticker + slide order) / Results (bracket editor) /
 *         Raffle (beat-the-pro draw) ─────────────────────────────────── */
let resultsLoaded = false;

function showTab(which) {
  ['board', 'results', 'raffle'].forEach((t) => {
    $('tab-btn-' + t).classList.toggle('on', which === t);
    $('tab-' + t).hidden = which !== t;
  });
  $('picker').hidden = which !== 'results';   // bracket picker is a Results tool
  if (which === 'results') {
    if (!resultsLoaded) { resultsLoaded = true; refresh(); }
    else scaleStage();
  } else if (which === 'raffle' && window.RaffleTab) {
    window.RaffleTab.load();                   // lazy-load the leaderboard once
  }
}

/* ── board tab: ticker messages + slide order ────────────────────────── */
const SLIDE_LABELS = {
  palmer: ['Palmer Cup', 'Full bracket'],
  mens1: ["Men's — Page 1", 'Championship · Blue F1'],
  mens2: ["Men's — Page 2", 'Blue F2 · Blue F3'],
  mens3: ["Men's — Page 3", 'Blue/White F1 · F2 · F3'],
  mens4: ["Men's — Page 4", 'White F1 · White F2'],
  ladies: ["Women's Match Play", 'Individual · Winnie Cup'],
  events: ['Upcoming Golf Events', 'From the Golf Genius portal'],
};

let slideNames = [];   // current (unsaved) order shown in the list

async function loadBoardTab() {
  // current config straight from the public table
  let cfg = {};
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/board_config?select=key,value`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    (await res.json()).forEach((r) => { cfg[r.key] = r.value; });
  } catch (e) { toast('Could not load board settings', true); }

  // up to ten message inputs
  const msgs = Array.isArray(cfg.messages) ? cfg.messages : [];
  const box = $('msgs');
  box.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const row = document.createElement('div');
    row.className = 'msg-row';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = (i + 1) + '.';
    const inp = document.createElement('input');
    inp.maxLength = 160;
    inp.placeholder = i === 0 ? 'e.g. Welcome to Treesdale Golf & Country Club' : '';
    inp.value = msgs[i] || '';
    row.appendChild(n);
    row.appendChild(inp);
    box.appendChild(row);
  }

  // slide order list with live previews
  const known = SLIDES.map((s) => s.name);
  const saved = Array.isArray(cfg.slide_order) ? cfg.slide_order.filter((n) => known.includes(n)) : [];
  slideNames = [...saved, ...known.filter((n) => !saved.includes(n))];
  drawSlideList();
}

function drawSlideList() {
  const list = $('slides');
  list.innerHTML = '';
  slideNames.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'slide-row';
    const prev = document.createElement('div');
    prev.className = 'slide-prev';
    const ifr = document.createElement('iframe');
    ifr.src = 'index.html?slide=' + encodeURIComponent(name);
    ifr.loading = 'lazy';
    ifr.tabIndex = -1;
    prev.appendChild(ifr);
    const label = document.createElement('div');
    label.className = 'slide-name';
    const [t, sub] = SLIDE_LABELS[name] || [name, ''];
    label.textContent = (i + 1) + '. ' + t;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      label.appendChild(s);
    }
    const btns = document.createElement('div');
    btns.className = 'slide-btns';
    const up = document.createElement('button');
    up.textContent = '▲';
    up.disabled = i === 0;
    up.onclick = () => { moveSlide(i, -1); };
    const dn = document.createElement('button');
    dn.textContent = '▼';
    dn.disabled = i === slideNames.length - 1;
    dn.onclick = () => { moveSlide(i, 1); };
    btns.appendChild(up);
    btns.appendChild(dn);
    row.appendChild(prev);
    row.appendChild(label);
    row.appendChild(btns);
    list.appendChild(row);
  });
}

function moveSlide(i, dir) {
  const j = i + dir;
  [slideNames[i], slideNames[j]] = [slideNames[j], slideNames[i]];
  drawSlideList();
}

async function saveMessages() {
  const value = Array.from($('msgs').querySelectorAll('input'))
    .map((inp) => inp.value.trim())
    .filter(Boolean);
  $('save-msgs').disabled = true;
  try {
    await api({ action: 'set_config', key: 'messages', value });
    toast(value.length ? 'Messages saved — on the TV within a minute' : 'Ticker cleared');
  } catch (e) { toast(e.message, true); }
  $('save-msgs').disabled = false;
}

async function saveOrder() {
  $('save-order').disabled = true;
  try {
    await api({ action: 'set_config', key: 'slide_order', value: slideNames });
    toast('Slide order saved — on the TV within a minute');
  } catch (e) { toast(e.message, true); }
  $('save-order').disabled = false;
}

/* ── bracket picker ──────────────────────────────────────────────────── */
function buildPicker() {
  const sel = $('picker');
  sel.innerHTML = '';
  BRACKETS.forEach((br) => {
    const o = document.createElement('option');
    o.value = br.id;
    o.textContent = br.title + (br.sub ? ' — ' + br.sub : '');
    sel.appendChild(o);
  });
  sel.value = selected.id;
  sel.onchange = async () => {
    selected = BRACKETS.find((br) => br.id === sel.value);
    await refresh();
  };
}

/* ── bracket stage ───────────────────────────────────────────────────── */
async function refresh() {
  await loadResults();
  drawBracket();
}

function drawBracket() {
  document.body.classList.toggle('ladies', selected.theme === 'ladies');
  const world = $('aworld');
  world.innerHTML = '';
  allResults = { [selected.id]: results };   // shared global read by renderInto
  const view = document.createElement('div');
  world.appendChild(view);
  renderInto(view, selected);
  world.querySelectorAll('[data-mid]').forEach((elm) => {
    elm.addEventListener('click', () => {
      const nm = elm.querySelector('.nm');
      openScoreDlg(elm.dataset.mid, +elm.dataset.win, nm ? nm.textContent : '');
    });
  });
  scaleStage();
}

function scaleStage() {
  const box = $('stagebox');
  if (!box || $('app').hidden || $('tab-results').hidden) return;
  const s = Math.min(1, box.clientWidth / 1920);
  $('stage').style.transform = `scale(${s})`;
  box.style.height = (Math.ceil(1080 * s) + 2) + 'px';   // +2 for card borders
}
window.addEventListener('resize', scaleStage);

/* ── score dialog ────────────────────────────────────────────────────── */
let pending = null;

function openScoreDlg(mid, winner, name) {
  pending = { mid, winner };
  $('dlg-title').textContent = name + ' won';
  const cur = results[mid];
  $('score').value = (cur && cur.winner === winner && cur.score) || '';
  $('dlg-clear').hidden = !(cur && cur.winner);
  $('scoredlg').showModal();
}

$('dlg-cancel').onclick = () => $('scoredlg').close();

$('dlg-ok').onclick = async () => {
  const { mid, winner } = pending;
  const score = $('score').value.trim();
  $('scoredlg').close();
  try {
    await api({ action: 'set', match_id: selected.id + ':' + mid, winner, score: score || null });
    toast('Saved — board updates within a minute');
    await refresh();
  } catch (e) { toast(e.message, true); }
};

$('dlg-clear').onclick = async () => {
  const { mid } = pending;
  $('scoredlg').close();
  if (!confirm('Clear this result? Players advanced from it will be pulled back.')) return;
  try {
    await api({ action: 'clear', match_id: selected.id + ':' + mid });
    toast('Result cleared');
    await refresh();
  } catch (e) { toast(e.message, true); }
};

/* ── boot ────────────────────────────────────────────────────────────── */
$('login').onclick = tryLogin;
$('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('tab-btn-board').onclick = () => showTab('board');
$('tab-btn-results').onclick = () => showTab('results');
$('tab-btn-raffle').onclick = () => showTab('raffle');
$('save-msgs').onclick = saveMessages;
$('save-order').onclick = saveOrder;
window.addEventListener('DOMContentLoaded', () => {
  if (pin) {
    $('pin').value = pin;
    tryLogin();
  }
});
