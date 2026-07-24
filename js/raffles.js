/* Raffles tab for the staff hub. Pick a tournament (or go custom), pull the
 * roster, set per-type entry rules (base entries for getting in + bonus tickets
 * for hitting the goal), then draw weighted winners. Everything saves to the
 * Supabase `raffles` table via palmer-admin, so history and progress persist.
 *
 * Loaded after staff.js; reuses its globals: $, api, toast, SUPA_URL, SUPA_KEY,
 * EVENTS_FN. Kept in an IIFE so nothing leaks. */
(function () {
  const ROSTER_FN = SUPA_URL + '/functions/v1/gg-roster';
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  // raffle-type presets: default entry rules + whether it needs a tournament
  const TYPES = {
    'beat-pro': { label: 'Beat the Pro', blurb: 'Everyone gets in; big bonus for beating (or tying) the pro.',
      participation: 1, goals: [{ key: 'beat', label: 'Beat the Pro', entries: 10 }, { key: 'tie', label: 'Tied the Pro', entries: 3 }], tournament: true,
      icon: '<path d="M6 9a6 6 0 0 0 12 0V3H6z"/><path d="M4 4H2v3a3 3 0 0 0 3 3M20 4h2v3a3 3 0 0 1-3 3M9 21h6M12 15v6"/>' },
    'hit-green': { label: 'Hit The Green', blurb: 'Base entries for playing, bonus tickets for hitting the green.',
      participation: 1, goals: [{ key: 'green', label: 'Hit the Green', entries: 5 }], tournament: true,
      icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3v6M12 12l4 2"/>' },
    'basic': { label: 'Basic Raffle', blurb: 'One entry per player from the tournament roster.',
      participation: 1, goals: [], tournament: true,
      icon: '<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>' },
    'custom': { label: 'Custom Raffle', blurb: 'No tournament — type in any entrants and rules.',
      participation: 1, goals: [], tournament: false,
      icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  };

  let raffles = [];        // saved rows (list view)
  let cur = null;          // raffle being edited
  let tournaments = null;  // cached gg-events tournaments
  let saveTimer = null;

  const panel = () => $('panel-raffles');

  /* ── entry math ─────────────────────────────────────────────────────── */
  function totalEntries(e) {
    const c = cur.config;
    let n = Number(c.participation) || 0;
    (c.goals || []).forEach((g) => { if (e.marks && e.marks[g.key]) n += Number(g.entries) || 0; });
    n += Number(e.extra) || 0;
    return Math.max(0, n);
  }

  /* ── persistence ────────────────────────────────────────────────────── */
  async function loadList() {
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/raffles?select=*&order=updated_at.desc`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
      raffles = await res.json();
      if (!Array.isArray(raffles)) raffles = [];
    } catch (e) { raffles = []; toast('Could not load raffles', true); }
  }

  function scheduleSave() {
    $('rf-saved') && ($('rf-saved').textContent = 'Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    if (!cur) return;
    cur.updated_at = new Date().toISOString();
    try {
      await api({ action: 'save_raffle', raffle: cur });
      if ($('rf-saved')) $('rf-saved').textContent = 'All changes saved';
    } catch (e) { if ($('rf-saved')) $('rf-saved').textContent = 'Save failed'; toast(e.message, true); }
  }

  /* ── tournaments (from gg-events, on-date or previous) ──────────────── */
  async function loadTournaments() {
    if (tournaments) return tournaments;
    const now = new Date();
    const today = now.toLocaleDateString('en-CA');
    // window: today back through the last two months (day-of is fine)
    const since = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()).toLocaleDateString('en-CA');
    let cats = [];
    try { cats = ((await (await fetch(EVENTS_FN)).json()).categories) || []; } catch (e) { /* offline */ }
    const wantCat = { mens: "Men's", womens: "Women's", mixed: 'Mixed' };
    const out = [];
    cats.forEach((c) => {
      if (!wantCat[c.key]) return;
      (c.events || []).forEach((ev) => {
        const rosterPage = ev.teeSheet || ev.results;   // needs a pullable roster source
        if (!rosterPage) return;
        // effective date = latest event date that is today or earlier
        const past = [ev.start, ev.next, ev.end].filter(Boolean).filter((d) => d <= today).sort();
        const date = past.length ? past[past.length - 1] : '';
        if (!date || date < since) return;              // none on-or-before today, or older than 2 months
        out.push({ id: String(ev.id), name: ev.name, date, cat: wantCat[c.key], catKey: c.key, rosterPage });
      });
    });
    out.sort((a, b) => b.date.localeCompare(a.date));
    tournaments = out;
    return out;
  }

  /* ── roster ─────────────────────────────────────────────────────────── */
  async function pullRoster(pagePath) {
    if (!pagePath) return [];
    const res = await fetch(`${ROSTER_FN}?page=${encodeURIComponent(pagePath)}`);
    const j = await res.json();
    return Array.isArray(j.players) ? j.players.map((p) => p.name).filter(Boolean) : [];
  }
  const lastName = (s) => { const p = String(s).trim().split(/\s+/); return (p[p.length - 1] || '').toLowerCase(); };
  function sortEntrants() {
    cur.state.entrants.sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name));
  }

  /* ── views ──────────────────────────────────────────────────────────── */
  async function load() {
    renderLoading();
    await loadList();
    renderList();
  }
  function renderLoading() { panel().innerHTML = '<div class="card" style="text-align:center;color:#9ca3af">Loading…</div>'; }

  function renderList() {
    cur = null;
    const p = panel();
    p.innerHTML = '';
    const list = el('div', 'card');
    const hd = el('div', 'card-hd');
    const lh = el('h3', null, 'Raffles');
    const cnt = el('span'); cnt.style.cssText = 'font-weight:600;color:var(--faint);font-size:13px;margin-left:6px';
    cnt.textContent = raffles.length ? `· ${raffles.length}` : '';
    lh.appendChild(cnt);
    const btn = el('button', 'btn primary'); btn.innerHTML = '＋ Start New Raffle'; btn.onclick = chooseType;
    hd.appendChild(lh); hd.appendChild(btn);
    list.appendChild(hd);
    if (!raffles.length) {
      list.appendChild(el('p', 'desc', 'No raffles yet — tap “Start New Raffle”.'));
    } else {
      raffles.forEach((r) => list.appendChild(rowFor(r)));
    }
    p.appendChild(list);
  }

  function rowFor(r) {
    const row = el('div', 'slide-row');
    const t = TYPES[r.type] || { label: r.type };
    const nm = el('div', 'slide-name');
    nm.textContent = r.name || t.label;
    const sub = el('small');
    const when = (r.updated_at || '').slice(0, 10);
    sub.textContent = [t.label, r.tournament_name, r.status === 'complete' ? 'Complete' : 'In progress', when].filter(Boolean).join(' · ');
    nm.appendChild(sub);
    const btns = el('div', 'slide-btns');
    const open = el('button', 'btn'); open.textContent = 'Open'; open.onclick = () => openRaffle(r);
    const del = el('button'); del.className = 'slide-eye'; del.textContent = 'Delete'; del.style.color = '#b4232f';
    del.onclick = async () => {
      if (!confirm('Delete this raffle?')) return;
      try { await api({ action: 'delete_raffle', raffle_id: r.id }); toast('Raffle deleted'); await loadList(); renderList(); }
      catch (e) { toast(e.message, true); }
    };
    btns.appendChild(open); btns.appendChild(del);
    row.appendChild(nm); row.appendChild(btns);
    return row;
  }

  /* ── new raffle: pick a type ────────────────────────────────────────── */
  function chooseType() {
    const p = panel();
    p.innerHTML = '';
    const back = el('button', 'btn'); back.textContent = '← Back'; back.style.marginBottom = '16px'; back.onclick = renderList;
    p.appendChild(back);
    const card = el('div', 'card');
    card.appendChild(el('h3', null, 'Choose a raffle type'));
    card.appendChild(el('p', 'desc', 'Each type comes with default entry rules you can adjust after.'));
    const grid = el('div', 'grid cols-2');
    Object.entries(TYPES).forEach(([key, t]) => {
      const tile = el('div', 'tile'); tile.style.cursor = 'pointer';
      tile.innerHTML = `<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${t.icon}</svg></div>` +
        `<div class="tt">${esc(t.label)}</div><div class="td">${esc(t.blurb)}</div>`;
      tile.onclick = () => t.tournament ? chooseTournament(key) : startCustom(key);
      grid.appendChild(tile);
    });
    card.appendChild(grid);
    p.appendChild(card);
  }

  /* ── new raffle: pick a tournament ──────────────────────────────────── */
  async function chooseTournament(type) {
    const p = panel();
    p.innerHTML = '';
    const back = el('button', 'btn'); back.textContent = '← Back'; back.style.marginBottom = '16px'; back.onclick = chooseType;
    p.appendChild(back);
    const card = el('div', 'card');
    card.appendChild(el('h3', null, 'Select a tournament'));
    card.appendChild(el('p', 'desc', "Men's, women's and mixed tournaments on today's date or earlier."));
    const body = el('div'); body.textContent = 'Loading tournaments…'; body.style.color = '#9ca3af';
    card.appendChild(body); p.appendChild(card);

    const list = await loadTournaments();
    body.textContent = '';
    if (!list.length) {
      body.textContent = 'No tournaments in the last two months (the events feed may be offline). You can still run a Custom Raffle.';
      body.style.color = '#9ca3af';
      return;
    }
    // section by Men's / Women's / Mixed
    [['mens', "Men's"], ['womens', "Women's"], ['mixed', 'Mixed']].forEach(([key, label]) => {
      const group = list.filter((t) => t.catKey === key);
      if (!group.length) return;
      const hd = el('div', null, label);
      hd.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin:18px 0 4px;';
      body.appendChild(hd);
      group.forEach((tour) => {
        const row = el('div', 'slide-row');
        const nm = el('div', 'slide-name'); nm.textContent = tour.name;
        nm.appendChild(el('small', null, fmtDate(tour.date)));
        const b = el('button', 'btn'); b.textContent = 'Use'; b.onclick = () => startTournament(type, tour);
        const btns = el('div', 'slide-btns'); btns.appendChild(b);
        row.appendChild(nm); row.appendChild(btns);
        body.appendChild(row);
      });
    });
  }

  function fmtDate(d) {
    try { return new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return d; }
  }

  function newRaffle(type) {
    const t = TYPES[type];
    return {
      id: 'rf_' + Date.now().toString(36) + uid(),
      type, name: '', tournament_id: null, tournament_name: null, status: 'active',
      config: { participation: t.participation, goals: t.goals.map((g) => ({ ...g })), rosterPage: null },
      state: { entrants: [], prizes: [] },
    };
  }

  async function startTournament(type, tour) {
    cur = newRaffle(type);
    cur.tournament_id = tour.id;
    cur.tournament_name = tour.name;
    cur.config.rosterPage = tour.rosterPage || null;
    cur.name = TYPES[type].label + ' — ' + tour.name;
    renderEdit(true);            // show immediately, roster loads in
    try {
      const names = await pullRoster(cur.config.rosterPage);
      cur.state.entrants = names.map((n) => ({ id: uid(), name: n, marks: {}, extra: 0 }));
      sortEntrants();
    } catch (e) { /* roster offline — staff can add manually */ }
    renderEdit();
    scheduleSave();
  }

  function startCustom(type) {
    cur = newRaffle(type);
    cur.name = 'Custom Raffle';
    renderEdit();
    scheduleSave();
  }

  function openRaffle(r) {
    // clone so edits are local until saved
    cur = JSON.parse(JSON.stringify(r));
    cur.config = cur.config || { participation: 1, goals: [] };
    cur.state = cur.state || { entrants: [], prizes: [] };
    cur.state.entrants = cur.state.entrants || [];
    cur.state.prizes = cur.state.prizes || [];
    renderEdit();
  }

  /* ── edit view ──────────────────────────────────────────────────────── */
  function renderEdit(loadingRoster) {
    const p = panel();
    p.innerHTML = '';
    const t = TYPES[cur.type] || { label: cur.type };

    // header
    const head = el('div', 'card');
    head.style.display = 'flex'; head.style.alignItems = 'center'; head.style.gap = '14px';
    const back = el('button', 'btn'); back.textContent = '←'; back.title = 'Back to list';
    back.onclick = async () => { await saveNow(); await loadList(); renderList(); };
    const nameWrap = el('div'); nameWrap.style.flex = '1'; nameWrap.style.minWidth = '0';
    const nameIn = el('input'); nameIn.value = cur.name || ''; nameIn.placeholder = 'Raffle name';
    nameIn.style.cssText = 'width:100%;font-size:17px;font-weight:800;border:0;outline:none;background:none;color:inherit;';
    nameIn.oninput = () => { cur.name = nameIn.value; scheduleSave(); };
    const meta = el('div'); meta.style.cssText = 'font-size:12.5px;color:#6b7280;margin-top:2px;';
    meta.textContent = [t.label, cur.tournament_name].filter(Boolean).join(' · ');
    nameWrap.appendChild(nameIn); nameWrap.appendChild(meta);
    const saved = el('div'); saved.id = 'rf-saved'; saved.style.cssText = 'font-size:12px;color:#9ca3af;'; saved.textContent = 'All changes saved';
    head.appendChild(back); head.appendChild(nameWrap); head.appendChild(saved);
    p.appendChild(head);

    p.appendChild(entrySettingsCard());
    p.appendChild(entrantsCard(loadingRoster));
    p.appendChild(drawCard());
  }

  function entrySettingsCard() {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, 'Entry Settings'));
    card.appendChild(el('p', 'desc', 'Tickets each player gets for entering, plus bonus tickets for hitting the goal.'));
    const numRow = (label, val, on) => {
      const r = el('div'); r.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
      const l = el('div', null, label); l.style.cssText = 'flex:1;font-size:14px;font-weight:600;';
      const inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.value = val;
      inp.style.cssText = 'width:88px;padding:9px 11px;border:1px solid #e2e0da;border-radius:9px;font-size:14px;text-align:center;';
      inp.oninput = () => { on(Math.max(0, parseInt(inp.value, 10) || 0)); scheduleSave(); refreshTotals(); };
      const unit = el('div', null, 'tickets'); unit.style.cssText = 'font-size:12px;color:#9ca3af;width:44px;';
      r.appendChild(l); r.appendChild(inp); r.appendChild(unit);
      return r;
    };
    card.appendChild(numRow('Entries for getting in', cur.config.participation, (v) => cur.config.participation = v));
    (cur.config.goals || []).forEach((g, i) => {
      const r = el('div'); r.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
      const l = el('input'); l.value = g.label; l.style.cssText = 'flex:1;padding:9px 11px;border:1px solid #e2e0da;border-radius:9px;font-size:14px;font-weight:600;';
      l.oninput = () => { g.label = l.value; scheduleSave(); };
      const inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.value = g.entries;
      inp.style.cssText = 'width:88px;padding:9px 11px;border:1px solid #e2e0da;border-radius:9px;font-size:14px;text-align:center;';
      inp.oninput = () => { g.entries = Math.max(0, parseInt(inp.value, 10) || 0); scheduleSave(); refreshTotals(); };
      const rm = el('button', 'btn'); rm.textContent = '✕'; rm.title = 'Remove goal';
      rm.onclick = () => { const key = g.key; cur.config.goals.splice(i, 1); cur.state.entrants.forEach((e) => e.marks && delete e.marks[key]); scheduleSave(); renderEdit(); };
      r.appendChild(l); r.appendChild(inp); r.appendChild(rm);
      card.appendChild(r);
    });
    const add = el('button', 'btn'); add.textContent = '＋ Add goal';
    add.onclick = () => { cur.config.goals = cur.config.goals || []; cur.config.goals.push({ key: 'g' + uid(), label: 'New goal', entries: 5 }); scheduleSave(); renderEdit(); };
    card.appendChild(add);
    return card;
  }

  function entrantsCard(loadingRoster) {
    const card = el('div', 'card');
    const h = el('h3', null, 'Entrants');
    const count = el('span'); count.id = 'rf-count'; count.style.cssText = 'font-weight:600;color:#9ca3af;font-size:13px;margin-left:6px;';
    h.appendChild(count);
    card.appendChild(h);
    card.appendChild(el('p', 'desc', 'Roster is editable — add, remove, or mark who hit each goal.'));

    const wrap = el('div'); wrap.id = 'rf-entrants';
    card.appendChild(wrap);

    const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;';
    const addName = el('input'); addName.placeholder = 'Add a player…';
    addName.style.cssText = 'flex:1;min-width:160px;padding:10px 12px;border:1px solid #e2e0da;border-radius:9px;font-size:14px;';
    const addBtn = el('button', 'btn primary'); addBtn.textContent = 'Add';
    const doAdd = () => { const n = addName.value.trim(); if (!n) return; cur.state.entrants.push({ id: uid(), name: n, marks: {}, extra: 0 }); sortEntrants(); addName.value = ''; scheduleSave(); drawEntrants(); };
    addBtn.onclick = doAdd;
    addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    bar.appendChild(addName); bar.appendChild(addBtn);
    if (cur.config && cur.config.rosterPage) {
      const re = el('button', 'btn'); re.textContent = '↻ Re-pull roster';
      re.onclick = async () => { re.disabled = true; re.textContent = 'Pulling…'; try { const names = await pullRoster(cur.config.rosterPage); const have = new Set(cur.state.entrants.map((e) => e.name.toLowerCase())); names.forEach((n) => { if (!have.has(n.toLowerCase())) cur.state.entrants.push({ id: uid(), name: n, marks: {}, extra: 0 }); }); sortEntrants(); scheduleSave(); drawEntrants(); } catch (e) { toast('Roster pull failed', true); } re.disabled = false; re.textContent = '↻ Re-pull roster'; };
      bar.appendChild(re);
    }
    card.appendChild(bar);
    setTimeout(() => drawEntrants(loadingRoster), 0);
    return card;
  }

  function drawEntrants(loadingRoster) {
    const wrap = $('rf-entrants'); if (!wrap) return;
    wrap.innerHTML = '';
    const winners = new Set((cur.state.prizes || []).map((p) => p.winnerId).filter(Boolean));
    if (!cur.state.entrants.length) {
      wrap.appendChild(el('p', 'desc', loadingRoster ? 'Pulling roster from Golf Genius…' : 'No entrants yet — add players below.'));
    }
    cur.state.entrants.forEach((e) => {
      const row = el('div', 'slide-row'); row.style.padding = '9px 0';
      const nm = el('div', 'slide-name'); nm.style.fontSize = '14px'; nm.textContent = e.name;
      if (winners.has(e.id)) { const w = el('small'); w.textContent = '🏆 Winner'; w.style.color = '#2c7a45'; nm.appendChild(w); }
      const ctrls = el('div'); ctrls.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
      (cur.config.goals || []).forEach((g) => {
        const lab = el('label'); lab.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12.5px;color:#4b5563;font-weight:600;';
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!(e.marks && e.marks[g.key]);
        cb.onchange = () => { e.marks = e.marks || {}; e.marks[g.key] = cb.checked; scheduleSave(); refreshTotals(); tot.textContent = totalEntries(e) + ' 🎟'; };
        lab.appendChild(cb); lab.appendChild(document.createTextNode(g.label));
        ctrls.appendChild(lab);
      });
      const tot = el('div'); tot.style.cssText = 'font-size:13px;font-weight:700;color:#8e1b26;min-width:44px;text-align:right;'; tot.textContent = totalEntries(e) + ' 🎟';
      const rm = el('button'); rm.className = 'slide-eye'; rm.textContent = '✕'; rm.style.width = '34px';
      rm.onclick = () => { cur.state.entrants = cur.state.entrants.filter((x) => x.id !== e.id); (cur.state.prizes || []).forEach((p) => { if (p.winnerId === e.id) p.winnerId = null; }); scheduleSave(); drawEntrants(); };
      ctrls.appendChild(tot); ctrls.appendChild(rm);
      row.appendChild(nm); row.appendChild(ctrls);
      wrap.appendChild(row);
    });
    refreshTotals();
  }

  function refreshTotals() {
    const c = $('rf-count'); if (!c) return;
    const n = cur.state.entrants.length;
    const tickets = cur.state.entrants.reduce((s, e) => s + totalEntries(e), 0);
    c.textContent = `· ${n} player${n === 1 ? '' : 's'} · ${tickets} tickets`;
  }

  /* ── prizes & draw ──────────────────────────────────────────────────── */
  function drawCard() {
    const card = el('div', 'card');
    const h = el('h3', null, 'Prizes & Draw');
    card.appendChild(h);
    card.appendChild(el('p', 'desc', 'Add a prize, then draw a weighted winner. A player can only win once.'));
    const wrap = el('div'); wrap.id = 'rf-prizes';
    card.appendChild(wrap);

    const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;';
    const pin = el('input'); pin.placeholder = 'Prize name (e.g. $50 Pro Shop)';
    pin.style.cssText = 'flex:1;min-width:180px;padding:10px 12px;border:1px solid #e2e0da;border-radius:9px;font-size:14px;';
    const add = el('button', 'btn primary'); add.textContent = '＋ Add prize';
    const doAdd = () => { const n = pin.value.trim() || ('Prize ' + ((cur.state.prizes || []).length + 1)); cur.state.prizes = cur.state.prizes || []; cur.state.prizes.push({ id: uid(), name: n, winnerId: null }); pin.value = ''; scheduleSave(); drawPrizes(); };
    add.onclick = doAdd;
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    bar.appendChild(pin); bar.appendChild(add);
    card.appendChild(bar);
    setTimeout(drawPrizes, 0);
    return card;
  }

  function eligible() {
    const winners = new Set((cur.state.prizes || []).map((p) => p.winnerId).filter(Boolean));
    return cur.state.entrants.filter((e) => !winners.has(e.id) && totalEntries(e) > 0);
  }

  function drawWinner(prize) {
    const pool = eligible();
    if (!pool.length) { toast('No eligible entrants left', true); return; }
    let total = pool.reduce((s, e) => s + totalEntries(e), 0);
    let r = Math.floor(Math.random() * total);
    let pick = pool[0];
    for (const e of pool) { r -= totalEntries(e); if (r < 0) { pick = e; break; } }
    prize.winnerId = pick.id;
    scheduleSave();
    drawPrizes(); drawEntrants();
  }

  function drawPrizes() {
    const wrap = $('rf-prizes'); if (!wrap) return;
    wrap.innerHTML = '';
    const byId = {}; cur.state.entrants.forEach((e) => byId[e.id] = e);
    if (!(cur.state.prizes || []).length) { wrap.appendChild(el('p', 'desc', 'No prizes yet.')); return; }
    cur.state.prizes.forEach((pr) => {
      const row = el('div', 'slide-row');
      const nm = el('div', 'slide-name'); nm.textContent = pr.name;
      const win = byId[pr.winnerId];
      const sub = el('small'); sub.textContent = win ? '🏆 ' + win.name : 'Not drawn';
      if (win) sub.style.color = '#2c7a45';
      nm.appendChild(sub);
      const btns = el('div', 'slide-btns');
      const draw = el('button', 'btn primary'); draw.textContent = win ? 'Redraw' : 'Draw';
      draw.onclick = () => drawWinner(pr);
      const rm = el('button'); rm.className = 'slide-eye'; rm.textContent = '✕'; rm.style.width = '34px';
      rm.onclick = () => { cur.state.prizes = cur.state.prizes.filter((x) => x.id !== pr.id); scheduleSave(); drawPrizes(); drawEntrants(); };
      btns.appendChild(draw); btns.appendChild(rm);
      row.appendChild(nm); row.appendChild(btns);
      wrap.appendChild(row);
    });
  }

  window.RafflesTab = { load };
})();
