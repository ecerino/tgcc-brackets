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
    $('picker').hidden = false;
    buildPicker();
    await refresh();
  } catch (e) {
    $('gate-err').textContent = e.message === 'bad pin' ? 'Wrong PIN — try again.' : ('Error: ' + e.message);
  }
  $('login').textContent = 'Unlock';
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
  if (!box || $('app').hidden) return;
  const s = Math.min(1, box.clientWidth / 1920);
  $('stage').style.transform = `scale(${s})`;
  box.style.height = Math.ceil(1080 * s) + 'px';
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
window.addEventListener('DOMContentLoaded', () => {
  if (pin) {
    $('pin').value = pin;
    tryLogin();
  }
});
