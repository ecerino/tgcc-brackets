/* Brackets admin — pick a bracket, tap a team to record the win. */

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

/* ── main list ───────────────────────────────────────────────────────── */
async function refresh() {
  await loadResults();
  const app = $('list');
  app.innerHTML = '';
  const list = allMatches(selected, results);
  const sideName = { left: 'Left Bracket', right: 'Right Bracket', final: '' };
  const roundLabel = (m) => m.side === 'final'
    ? selected.final.label
    : selected.rounds[m.round - 1].label;
  const roundDue = (m) => m.side === 'final'
    ? selected.final.due
    : selected.rounds[m.round - 1].due;

  if (!selected.left.some(Boolean) && !selected.right.some(Boolean)) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'No players loaded for this bracket yet.';
    app.appendChild(note);
  }

  let lastKey = '';
  list.sort((a, b) => a.round - b.round || (a.side > b.side ? 1 : -1) || (a.id > b.id ? 1 : -1));
  list.forEach((m) => {
    const key = m.round + m.side;
    if (key !== lastKey) {
      lastKey = key;
      const h = document.createElement('div');
      h.className = 'roundhdr';
      const due = roundDue(m);
      h.innerHTML = `<span>${roundLabel(m)}${sideName[m.side] ? ' — ' + sideName[m.side] : ''}</span>` +
        (due ? `<small>by ${due}</small>` : '');
      app.appendChild(h);
    }
    app.appendChild(matchCard(m));
  });
}

function matchCard(m) {
  const card = document.createElement('div');
  card.className = 'match';
  const teams = document.createElement('div');
  teams.className = 'teams';

  [[m.top, 1], [m.bot, 2]].forEach(([team, n]) => {
    const b = document.createElement('button');
    b.className = 'tbtn';
    const won = m.result && m.result.winner === n;
    if (won) b.classList.add('winner');
    b.innerHTML = `<span>${team ? team.short : '— winner of earlier match —'}</span>` +
      (won && m.result.score ? `<span class="score">${m.result.score}</span>` : won ? '<span class="score">WIN</span>' : '');
    if (!team) b.disabled = true;
    else b.onclick = () => openScoreDlg(m, n, team);
    teams.appendChild(b);
  });
  card.appendChild(teams);

  if (m.result && m.result.winner) {
    const tools = document.createElement('div');
    tools.className = 'tools';
    const clear = document.createElement('button');
    clear.className = 'danger';
    clear.textContent = 'Clear result';
    clear.onclick = async () => {
      if (!confirm('Clear this result? Teams advanced from it will be pulled back.')) return;
      try {
        await api({ action: 'clear', match_id: selected.id + ':' + m.id });
        toast('Result cleared');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
    tools.appendChild(clear);
    card.appendChild(tools);
  }
  return card;
}

/* ── score dialog ────────────────────────────────────────────────────── */
const QUICK = ['1 UP', '2 UP', '2&1', '3&2', '4&3', '5&4', '19 holes'];
let pending = null;

function openScoreDlg(m, winner, team) {
  pending = { m, winner };
  $('dlg-title').textContent = team.short + ' won';
  const q = $('quick');
  q.innerHTML = '';
  const existing = (m.result && m.result.winner === winner && m.result.score) || '';
  $('score').value = existing;
  QUICK.forEach((s) => {
    const b = document.createElement('button');
    b.textContent = s;
    if (s === existing) b.classList.add('sel');
    b.onclick = () => {
      q.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      $('score').value = s;
    };
    q.appendChild(b);
  });
  $('scoredlg').showModal();
}

$('dlg-cancel').onclick = () => $('scoredlg').close();
$('dlg-ok').onclick = async () => {
  const { m, winner } = pending;
  const score = $('score').value.trim();
  $('scoredlg').close();
  try {
    await api({ action: 'set', match_id: selected.id + ':' + m.id, winner, score: score || null });
    toast('Saved — board updates within a minute');
    await refresh();
  } catch (e) { toast(e.message, true); }
};

/* ── boot ────────────────────────────────────────────────────────────── */
$('login').onclick = tryLogin;
$('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
window.addEventListener('DOMContentLoaded', async () => {
  if (pin) {
    $('pin').value = pin;
    tryLogin();
  }
});
