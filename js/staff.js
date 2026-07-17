/* Treesdale Staff Tools hub — shell navigation + the TV Displays tab.
 * Reuses the deployed palmer-admin API and the slide list from app.js
 * (ALL_SLIDES). Nothing here touches the live TV display. */

const $ = (id) => document.getElementById(id);
let pin = localStorage.getItem('palmer_pin') || '';

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

/* ── tabs ─────────────────────────────────────────────────────────────── */
const TABS = [
  { key: 'tv', label: 'TV Displays', title: 'TV Displays',
    sub: 'Manage what shows on the clubhouse screens.', ready: true,
    icon: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' },
  { key: 'raffles', label: 'Raffles', title: 'Raffles',
    sub: 'Event raffles and prize draws.', ready: true,
    icon: '<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>' },
  { key: 'calcuttas', label: 'Calcuttas', title: 'Calcuttas',
    sub: 'Auction-style team pools.', ready: false,
    icon: '<path d="M3 21h18"/><path d="M6 21V10M18 21V10"/><path d="M4 10l8-6 8 6"/>' },
  { key: 'labels', label: 'Club Labels', title: 'Club Labels',
    sub: 'Print bag tags, signs and name plates.', ready: false,
    icon: '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>' },
  { key: 'scoreboards', label: 'Scoreboards', title: 'Scoreboards',
    sub: 'Live leaderboards for events and leagues.', ready: false,
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>' },
];

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '<div class="nav-lbl">Tools</div>';
  TABS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'nav-item';
    b.dataset.tab = t.key;
    b.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${t.icon}</svg>` +
      `<span>${t.label}</span>` + (t.ready ? '' : '<span class="soon">Soon</span>');
    b.onclick = () => showTab(t.key);
    nav.appendChild(b);
  });
}

function showTab(key) {
  const tab = TABS.find((t) => t.key === key) || TABS[0];
  document.querySelectorAll('.nav-item[data-tab]').forEach((b) =>
    b.classList.toggle('on', b.dataset.tab === key));
  TABS.forEach((t) => { const p = $('panel-' + t.key); if (p) p.hidden = t.key !== key; });
  $('crumb').textContent = '/ ' + tab.label;
  $('page-title').textContent = tab.title;
  $('page-sub').textContent = tab.sub;
  if (key === 'tv' && !tvLoaded) { tvLoaded = true; loadTV(); }
  if (key === 'raffles' && window.RafflesTab && !rafflesLoaded) { rafflesLoaded = true; window.RafflesTab.load(); }
}
let rafflesLoaded = false;

/* ── login ────────────────────────────────────────────────────────────── */
async function tryLogin() {
  pin = $('pin').value.trim();
  if (!pin) return;
  $('gate-err').textContent = '';
  $('login').textContent = 'Checking…';
  try {
    await api({ action: 'verify' });
    localStorage.setItem('palmer_pin', pin);
    enterApp();
  } catch (e) {
    $('gate-err').textContent = e.message === 'bad pin' ? 'Wrong PIN — try again.' : ('Error: ' + e.message);
  }
  $('login').textContent = 'Unlock';
}

function enterApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
  buildNav();
  showTab('tv');
}

/* ── TV Displays: ticker + slide rotation/visibility ──────────────────── */
const SLIDE_LABELS = {
  palmer: ['Palmer Cup', 'Full bracket'],
  mens1: ["Men's — Page 1", 'Championship · Blue F1'],
  mens2: ["Men's — Page 2", 'Blue F2 · Blue F3'],
  mens3: ["Men's — Page 3", 'Blue/White F1 · F2 · F3'],
  mens4: ["Men's — Page 4", 'White F1 · White F2'],
  ladies: ["Women's Match Play", 'Individual · Winnie Cup'],
  events: ['Upcoming Golf Events', 'From the Golf Genius portal'],
  season: ['2026 Season Points Race', 'Boros Cup · Women’s Golf Association'],
};

let tvLoaded = false;
let slideNames = [];
let hiddenSlides = new Set();

async function loadTV() {
  let cfg = {};
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/board_config?select=key,value`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    (await res.json()).forEach((r) => { cfg[r.key] = r.value; });
  } catch (e) { toast('Could not load board settings', true); }

  // ten message inputs
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

  // slide order + visibility (ALL_SLIDES is the master list from app.js)
  const known = ALL_SLIDES.map((s) => s.name);
  const saved = Array.isArray(cfg.slide_order) ? cfg.slide_order.filter((n) => known.includes(n)) : [];
  slideNames = [...saved, ...known.filter((n) => !saved.includes(n))];
  hiddenSlides = Array.isArray(cfg.hidden_slides)
    ? new Set(cfg.hidden_slides.filter((n) => known.includes(n)))
    : new Set(ALL_SLIDES.filter((s) => s.hidden).map((s) => s.name));
  drawSlides();
}

function drawSlides() {
  const list = $('slides');
  list.innerHTML = '';
  slideNames.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'slide-row' + (hiddenSlides.has(name) ? ' hidden-slide' : '');

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
    if (sub) { const s = document.createElement('small'); s.textContent = sub; label.appendChild(s); }

    const btns = document.createElement('div');
    btns.className = 'slide-btns';
    const up = document.createElement('button');
    up.textContent = '▲'; up.disabled = i === 0;
    up.onclick = () => moveSlide(i, -1);
    const dn = document.createElement('button');
    dn.textContent = '▼'; dn.disabled = i === slideNames.length - 1;
    dn.onclick = () => moveSlide(i, 1);
    const eye = document.createElement('button');
    const hidden = hiddenSlides.has(name);
    eye.className = 'slide-eye';
    eye.textContent = hidden ? 'Hidden' : 'Shown';
    eye.onclick = () => { hidden ? hiddenSlides.delete(name) : hiddenSlides.add(name); drawSlides(); };
    btns.appendChild(up); btns.appendChild(dn); btns.appendChild(eye);

    row.appendChild(prev); row.appendChild(label); row.appendChild(btns);
    list.appendChild(row);
  });
}

function moveSlide(i, dir) {
  const j = i + dir;
  [slideNames[i], slideNames[j]] = [slideNames[j], slideNames[i]];
  drawSlides();
}

async function saveMessages() {
  const value = Array.from($('msgs').querySelectorAll('input'))
    .map((inp) => inp.value.trim()).filter(Boolean);
  $('save-msgs').disabled = true;
  try {
    await api({ action: 'set_config', key: 'messages', value });
    toast(value.length ? 'Messages saved — on the TV within a minute' : 'Ticker cleared');
  } catch (e) { toast(e.message, true); }
  $('save-msgs').disabled = false;
}

async function saveSlides() {
  $('save-order').disabled = true;
  try {
    await api({ action: 'set_config', key: 'slide_order', value: slideNames });
    await api({ action: 'set_config', key: 'hidden_slides',
      value: slideNames.filter((n) => hiddenSlides.has(n)) });
    toast('Slides saved — on the TV within a minute');
  } catch (e) { toast(e.message, true); }
  $('save-order').disabled = false;
}

/* ── wire up ──────────────────────────────────────────────────────────── */
$('login').onclick = tryLogin;
$('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('logout').onclick = () => { localStorage.removeItem('palmer_pin'); location.reload(); };
$('save-msgs').onclick = saveMessages;
$('save-order').onclick = saveSlides;

// skip the gate if a good PIN is already stored
if (pin) {
  api({ action: 'verify' }).then(enterApp).catch(() => { $('pin').focus(); });
} else {
  $('pin').focus();
}
