/* Calcuttas tab for the staff hub. Priority: the live auction + pool tracker.
 * Set up teams (pull the roster from Golf Genius, pair them, or add by hand),
 * then run the auction team-by-team recording the winning bid and owner while
 * the prize pool and payout breakdown update live. Saves to the Supabase
 * `calcuttas` table via palmer-admin so progress/history persist.
 *
 * Loaded after staff.js; reuses its globals: $, api, toast, SUPA_URL, SUPA_KEY,
 * EVENTS_FN. Defaults mirror the 2025 Member-Member Calcutta. */
(function () {
  const ROSTER_FN = SUPA_URL + '/functions/v1/gg-roster';
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const money = (n) => '$' + (Math.round(n) || 0).toLocaleString();

  // 2025 Member-Member defaults
  function defaultConfig() {
    return {
      buyIn: 500, startBid: 550, increment: 50,
      houseTake: 1000,
      deductions: [{ label: 'Keg', amount: 500 }, { label: 'Gratuity', amount: 500 }],
      splits: [
        { key: 'day1', label: 'Day 1', pct: 0.30 },
        { key: 'day2', label: 'Day 2', pct: 0.30 },
        { key: 'overall', label: 'Overall', pct: 0.40 },
      ],
      places: [0.31, 0.24, 0.18, 0.15, 0.12],   // top 5
      roundTo: 20, buyBackPct: 0.5, rosterPage: null,   // 2025 floors to nearest $20
      auctionSeconds: 120,   // 2-minute goal per team on the projected board
    };
  }

  let calcuttas = [];   // saved rows (list)
  let cur = null;       // calcutta being edited
  let roster = [];      // pulled player names (autocomplete)
  let tournaments = null;
  let saveTimer = null;
  const panel = () => $('panel-calcuttas');

  /* ── pool math ──────────────────────────────────────────────────────── */
  function collected() { return cur.state.teams.reduce((s, t) => s + (Number(t.price) || 0), 0); }
  function deductionsTotal() {
    const c = cur.config;
    return (Number(c.houseTake) || 0) + (c.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  }
  function pool() { return Math.max(0, collected() - deductionsTotal()); }
  // 2025 floors each place payout to the nearest $roundTo (leftover = remainder)
  function roundTo(n) { const r = Number(cur.config.roundTo) || 1; return Math.floor(n / r) * r; }
  // payout grid: rows = places, one column per split
  function payoutGrid() {
    const p = pool();
    return cur.config.splits.map((sp) => {
      const splitPool = p * (Number(sp.pct) || 0);
      const places = cur.config.places.map((pct) => roundTo(splitPool * pct));
      return { label: sp.label, pct: sp.pct, splitPool, places, paid: places.reduce((s, x) => s + x, 0) };
    });
  }

  /* ── persistence ────────────────────────────────────────────────────── */
  async function loadList() {
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/calcuttas?select=*&order=updated_at.desc`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
      calcuttas = await res.json();
      if (!Array.isArray(calcuttas)) calcuttas = [];
    } catch (e) { calcuttas = []; toast('Could not load calcuttas', true); }
  }
  function scheduleSave() {
    if ($('cc-saved')) $('cc-saved').textContent = 'Saving…';
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    if (!cur) return;
    try { await api({ action: 'save_calcutta', calcutta: cur }); if ($('cc-saved')) $('cc-saved').textContent = 'All changes saved'; }
    catch (e) { if ($('cc-saved')) $('cc-saved').textContent = 'Save failed'; toast(e.message, true); }
  }

  /* ── tournaments + roster ───────────────────────────────────────────── */
  async function loadTournaments() {
    if (tournaments) return tournaments;
    const now = new Date();
    const today = now.toLocaleDateString('en-CA');
    const since = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toLocaleDateString('en-CA');
    let cats = [];
    try { cats = ((await (await fetch(EVENTS_FN)).json()).categories) || []; } catch (e) { /* offline */ }
    const wantCat = { mens: "Men's", womens: "Women's", mixed: 'Mixed' };
    const out = [];
    cats.forEach((c) => {
      if (!wantCat[c.key]) return;
      (c.events || []).forEach((ev) => {
        const rosterPage = ev.teeSheet || ev.results;
        if (!rosterPage) return;
        const past = [ev.start, ev.next, ev.end].filter(Boolean).filter((d) => d <= today).sort();
        const date = past.length ? past[past.length - 1] : (ev.start || '');
        if (!date || date < since) return;
        out.push({ id: String(ev.id), name: ev.name, date, cat: wantCat[c.key], catKey: c.key, rosterPage });
      });
    });
    out.sort((a, b) => b.date.localeCompare(a.date));
    tournaments = out;
    return out;
  }
  async function pullRoster(pagePath) {
    if (!pagePath) return [];
    try {
      const j = await (await fetch(`${ROSTER_FN}?page=${encodeURIComponent(pagePath)}`)).json();
      return Array.isArray(j.players) ? j.players.map((p) => p.name).filter(Boolean) : [];
    } catch (e) { return []; }
  }

  /* ── views ──────────────────────────────────────────────────────────── */
  async function load() { panel().innerHTML = '<div class="card" style="text-align:center;color:#9ca3af">Loading…</div>'; await loadList(); renderList(); }

  function statCard(label, num, dotColor, sub) {
    const c = el('div', 'stat');
    const l = el('div', 'stat-lbl');
    if (dotColor) { const d = el('span', 'stat-dot'); d.style.background = dotColor; l.appendChild(d); }
    l.appendChild(document.createTextNode(label));
    c.appendChild(l);
    c.appendChild(el('div', 'stat-num', String(num)));
    if (sub) c.appendChild(el('div', 'stat-sub', sub));
    return c;
  }

  function renderList() {
    cur = null; roster = [];
    const p = panel(); p.innerHTML = '';

    // overview stat strip
    const inprog = calcuttas.filter((c) => c.status !== 'complete').length;
    const teamsOf = (c) => (c.state && c.state.teams) || [];
    const sold = calcuttas.reduce((s, c) => s + teamsOf(c).filter((t) => Number(t.price) > 0).length, 0);
    const raised = calcuttas.reduce((s, c) => s + teamsOf(c).reduce((a, t) => a + (Number(t.price) || 0), 0), 0);
    const strip = el('div', 'stat-strip');
    strip.appendChild(statCard('Calcuttas', calcuttas.length));
    strip.appendChild(statCard('In progress', inprog, '#2c7a45'));
    strip.appendChild(statCard('Teams sold', sold));
    strip.appendChild(statCard('Total raised', money(raised)));
    p.appendChild(strip);

    const list = el('div', 'card');
    const hd = el('div', 'card-hd');
    const lh = el('h3', null, 'Calcuttas');
    const cnt = el('span'); cnt.style.cssText = 'font-weight:600;color:var(--faint);font-size:13px;margin-left:6px';
    cnt.textContent = calcuttas.length ? `· ${calcuttas.length}` : '';
    lh.appendChild(cnt);
    const btn = el('button', 'btn primary'); btn.innerHTML = '＋ New Calcutta'; btn.onclick = chooseTournament;
    hd.appendChild(lh); hd.appendChild(btn);
    list.appendChild(hd);
    if (!calcuttas.length) list.appendChild(el('p', 'desc', 'None yet — tap “New Calcutta”.'));
    else calcuttas.forEach((r) => list.appendChild(rowFor(r)));
    p.appendChild(list);
  }
  function rowFor(r) {
    const row = el('div', 'slide-row');
    const nm = el('div', 'slide-name'); nm.textContent = r.name || 'Calcutta';
    const nT = (r.state && r.state.teams || []).length;
    nm.appendChild(el('small', null, [r.tournament_name, nT + ' teams', r.status === 'complete' ? 'Complete' : 'In progress', (r.updated_at || '').slice(0, 10)].filter(Boolean).join(' · ')));
    const btns = el('div', 'slide-btns');
    const open = el('button', 'btn'); open.textContent = 'Open'; open.onclick = () => openCalcutta(r);
    const del = el('button'); del.className = 'slide-eye'; del.textContent = 'Delete'; del.style.color = '#b4232f';
    del.onclick = async () => { if (!confirm('Delete this calcutta?')) return; try { await api({ action: 'delete_calcutta', calcutta_id: r.id }); toast('Deleted'); await loadList(); renderList(); } catch (e) { toast(e.message, true); } };
    btns.appendChild(open); btns.appendChild(del);
    row.appendChild(nm); row.appendChild(btns); return row;
  }

  async function chooseTournament() {
    const p = panel(); p.innerHTML = '';
    const back = el('button', 'btn'); back.textContent = '← Back'; back.style.marginBottom = '16px'; back.onclick = renderList; p.appendChild(back);
    const card = el('div', 'card');
    card.appendChild(el('h3', null, 'Select a tournament'));
    card.appendChild(el('p', 'desc', 'The calcutta ties to a tournament so teams can auto-pull from its roster.'));
    const startBtn = el('button', 'btn'); startBtn.textContent = 'Skip — set up teams manually'; startBtn.style.marginBottom = '14px';
    startBtn.onclick = () => startCalcutta(null);
    card.appendChild(startBtn);
    const body = el('div'); body.textContent = 'Loading tournaments…'; body.style.color = '#9ca3af'; card.appendChild(body); p.appendChild(card);
    const list = await loadTournaments();
    body.textContent = '';
    if (!list.length) body.appendChild(el('p', 'desc', 'No recent tournaments found (events feed may be offline).'));
    [['mens', "Men's"], ['womens', "Women's"], ['mixed', 'Mixed']].forEach(([key, label]) => {
      const group = list.filter((t) => t.catKey === key); if (!group.length) return;
      const hd = el('div', null, label); hd.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin:16px 0 4px;'; body.appendChild(hd);
      group.forEach((tour) => {
        const row = el('div', 'slide-row');
        const nm = el('div', 'slide-name'); nm.textContent = tour.name;
        nm.appendChild(el('small', null, fmtDate(tour.date)));
        const b = el('button', 'btn'); b.textContent = 'Use'; b.onclick = () => startCalcutta(tour);
        const bb = el('div', 'slide-btns'); bb.appendChild(b);
        row.appendChild(nm); row.appendChild(bb); body.appendChild(row);
      });
    });
  }
  function fmtDate(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } }

  function newCalcutta() {
    return { id: 'cc_' + Date.now().toString(36) + uid(), name: '', tournament_id: null, tournament_name: null,
      status: 'active', config: defaultConfig(), state: { teams: [] } };
  }
  async function startCalcutta(tour) {
    cur = newCalcutta();
    if (tour) { cur.tournament_id = tour.id; cur.tournament_name = tour.name; cur.config.rosterPage = tour.rosterPage; cur.name = 'Calcutta — ' + tour.name; }
    else cur.name = 'New Calcutta';
    renderEdit();
    if (cur.config.rosterPage) { roster = await pullRoster(cur.config.rosterPage); renderEdit(); }
    scheduleSave();
  }
  function openCalcutta(r) {
    cur = JSON.parse(JSON.stringify(r));
    cur.config = Object.assign(defaultConfig(), cur.config || {});
    cur.state = cur.state || {}; cur.state.teams = cur.state.teams || [];
    roster = [];
    renderEdit();
    if (cur.config.rosterPage) pullRoster(cur.config.rosterPage).then((r2) => { roster = r2; fillDatalist(); });
  }

  /* ── edit view ──────────────────────────────────────────────────────── */
  function renderEdit() {
    const p = panel(); p.innerHTML = '';
    // header
    const head = el('div', 'card'); head.style.cssText = 'display:flex;align-items:center;gap:14px';
    const back = el('button', 'btn'); back.textContent = '←'; back.onclick = async () => { await saveNow(); await loadList(); renderList(); };
    const nw = el('div'); nw.style.cssText = 'flex:1;min-width:0';
    const nameIn = el('input'); nameIn.value = cur.name || ''; nameIn.placeholder = 'Calcutta name';
    nameIn.style.cssText = 'width:100%;font-size:17px;font-weight:800;border:0;outline:none;background:none;color:inherit';
    nameIn.oninput = () => { cur.name = nameIn.value; scheduleSave(); };
    const meta = el('div'); meta.style.cssText = 'font-size:12.5px;color:#6b7280;margin-top:2px'; meta.textContent = cur.tournament_name || 'No tournament';
    nw.appendChild(nameIn); nw.appendChild(meta);
    const present = el('button', 'btn primary'); present.textContent = '▶ Present Auction';
    present.onclick = presentAuction;
    const saved = el('div'); saved.id = 'cc-saved'; saved.style.cssText = 'font-size:12px;color:#9ca3af'; saved.textContent = 'All changes saved';
    head.appendChild(back); head.appendChild(nw); head.appendChild(present); head.appendChild(saved); p.appendChild(head);

    p.appendChild(poolCard());
    p.appendChild(configCard());
    p.appendChild(teamsCard());

    // shared datalist for player-name autocomplete
    let dl = document.getElementById('cc-roster'); if (!dl) { dl = el('datalist'); dl.id = 'cc-roster'; p.appendChild(dl); }
    fillDatalist();
  }
  function fillDatalist() {
    const dl = document.getElementById('cc-roster'); if (!dl) return;
    dl.innerHTML = ''; roster.forEach((n) => { const o = el('option'); o.value = n; dl.appendChild(o); });
  }

  function poolCard() {
    const card = el('div', 'card'); card.id = 'cc-pool';
    renderPool(card); return card;
  }
  function renderPool(card) {
    card = card || $('cc-pool'); if (!card) return;
    card.innerHTML = '';
    const teams = cur.state.teams; const sold = teams.filter((t) => Number(t.price) > 0).length;
    card.appendChild(el('h3', null, 'Pool Tracker'));
    const stats = el('div'); stats.style.cssText = 'display:flex;flex-wrap:wrap;gap:22px;margin:6px 0 14px';
    const stat = (label, val, hi) => { const d = el('div'); d.innerHTML = `<div style="font-size:22px;font-weight:800;color:${hi || '#111827'}">${val}</div><div style="font-size:12px;color:#6b7280;font-weight:600">${label}</div>`; return d; };
    stats.appendChild(stat('Collected', money(collected()), '#2c7a45'));
    stats.appendChild(stat('House + fees', money(deductionsTotal())));
    stats.appendChild(stat('Prize pool', money(pool()), '#8e1b26'));
    stats.appendChild(stat('Teams sold', sold + ' / ' + teams.length));
    card.appendChild(stats);

    // payout breakdown grid
    const grid = payoutGrid();
    const tbl = el('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    const thead = el('tr');
    thead.appendChild(thc(''));
    grid.forEach((g) => thead.appendChild(thc(g.label + ' (' + Math.round(g.pct * 100) + '%)')));
    tbl.appendChild(thead);
    cur.config.places.forEach((pct, i) => {
      const tr = el('tr');
      tr.appendChild(tdc(ordinal(i + 1) + ' (' + Math.round(pct * 100) + '%)', true));
      grid.forEach((g) => tr.appendChild(tdc(money(g.places[i]))));
      tbl.appendChild(tr);
    });
    const totr = el('tr');
    totr.appendChild(tdc('Total', true));
    grid.forEach((g) => totr.appendChild(tdc(money(g.paid), true)));
    tbl.appendChild(totr);
    card.appendChild(tbl);
    card.appendChild(el('p', 'desc', 'Live — updates as bids are recorded. Places split evenly on ties (settled at payout).'));
  }
  const thc = (t) => { const th = el('th', null, t); th.style.cssText = 'text-align:right;padding:6px 8px;border-bottom:1px solid #e5e5e0;color:#6b7280;font-weight:700;font-size:12px'; if (!t) th.style.textAlign = 'left'; return th; };
  const tdc = (t, b) => { const td = el('td', null, t); td.style.cssText = 'text-align:right;padding:6px 8px;border-bottom:1px solid #f2f1ee;' + (b ? 'font-weight:700' : ''); return td; };
  function ordinal(n) { return ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][n] || (n + 'th'); }

  function configCard() {
    const card = el('div', 'card');
    const h = el('h3'); h.textContent = 'Pool Settings ';
    const tog = el('button', 'btn'); tog.textContent = 'Show'; tog.style.cssText = 'font-size:12px;padding:4px 10px;margin-left:8px';
    const body = el('div'); body.hidden = true;
    tog.onclick = () => { body.hidden = !body.hidden; tog.textContent = body.hidden ? 'Show' : 'Hide'; };
    h.appendChild(tog); card.appendChild(h);
    card.appendChild(el('p', 'desc', 'Buy-in, bidding, house take, deductions and the day/place split.'));

    const num = (label, get, set, suffix) => {
      const r = el('div'); r.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
      r.appendChild(Object.assign(el('div', null, label), { style: 'flex:1;font-size:13px;font-weight:600' }));
      const inp = el('input'); inp.type = 'number'; inp.value = get();
      inp.style.cssText = 'width:110px;padding:8px 10px;border:1px solid #e2e0da;border-radius:8px;text-align:right';
      inp.oninput = () => { set(parseFloat(inp.value) || 0); scheduleSave(); renderPool(); };
      r.appendChild(inp); if (suffix) r.appendChild(Object.assign(el('div', null, suffix), { style: 'font-size:12px;color:#9ca3af;width:40px' }));
      return r;
    };
    const c = cur.config;
    body.appendChild(num('Team buy-in', () => c.buyIn, (v) => c.buyIn = v, '$'));
    body.appendChild(num('Opening bid', () => c.startBid, (v) => c.startBid = v, '$'));
    body.appendChild(num('Bid increment', () => c.increment, (v) => c.increment = v, '$'));
    body.appendChild(num('House take', () => c.houseTake, (v) => c.houseTake = v, '$'));
    (c.deductions || []).forEach((d) => body.appendChild(num('Deduction — ' + d.label, () => d.amount, (v) => d.amount = v, '$')));
    body.appendChild(num('Round payouts down to', () => c.roundTo, (v) => c.roundTo = v || 1, '$'));
    body.appendChild(num('Buy-back share', () => Math.round(c.buyBackPct * 100), (v) => c.buyBackPct = v / 100, '%'));
    const splitNote = el('p', 'desc', 'Day split: ' + c.splits.map((s) => s.label + ' ' + Math.round(s.pct * 100) + '%').join(' · ') +
      ' — places: ' + c.places.map((p) => Math.round(p * 100) + '%').join(' / '));
    body.appendChild(splitNote);
    card.appendChild(body);
    return card;
  }

  function teamsCard() {
    const card = el('div', 'card');
    const h = el('h3', null, 'Teams & Auction ');
    const cnt = el('span'); cnt.id = 'cc-teamcount'; cnt.style.cssText = 'font-weight:600;color:#9ca3af;font-size:13px;margin-left:6px'; h.appendChild(cnt);
    card.appendChild(h);
    card.appendChild(el('p', 'desc', 'Add teams (auto-fill players from the roster), then record each winning bid and owner. Opening bid ' + money(cur.config.startBid) + ', ' + money(cur.config.increment) + ' increments.'));

    const wrap = el('div'); wrap.id = 'cc-teams'; card.appendChild(wrap);

    const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap';
    const add = el('button', 'btn primary'); add.textContent = '＋ Add team';
    add.onclick = () => { cur.state.teams.push({ id: uid(), n: cur.state.teams.length + 1, p1: '', p2: '', hi1: '', hi2: '', prepaid: true, price: '', buyer: '' }); scheduleSave(); drawTeams(); };
    bar.appendChild(add);
    if (cur.config.rosterPage) {
      const re = el('button', 'btn'); re.textContent = '↻ Refresh roster';
      re.onclick = async () => { re.disabled = true; re.textContent = 'Pulling…'; roster = await pullRoster(cur.config.rosterPage); fillDatalist(); re.disabled = false; re.textContent = '↻ Refresh roster'; toast(roster.length + ' players available'); };
      bar.appendChild(re);
    }
    card.appendChild(bar);
    setTimeout(drawTeams, 0);
    return card;
  }

  function drawTeams() {
    const wrap = $('cc-teams'); if (!wrap) return;
    wrap.innerHTML = '';
    if (!cur.state.teams.length) wrap.appendChild(el('p', 'desc', 'No teams yet — add one, or refresh the roster first for name auto-fill.'));
    cur.state.teams.forEach((t, i) => wrap.appendChild(teamRow(t, i)));
    const cnt = $('cc-teamcount'); if (cnt) { const sold = cur.state.teams.filter((x) => Number(x.price) > 0).length; cnt.textContent = `· ${cur.state.teams.length} teams · ${sold} sold`; }
  }
  function teamRow(t, i) {
    const row = el('div'); row.style.cssText = 'display:grid;grid-template-columns:34px 1fr 150px;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid #f2f1ee';
    const num = el('input'); num.value = t.n; num.style.cssText = 'width:34px;padding:7px 4px;border:1px solid #e2e0da;border-radius:8px;text-align:center;font-weight:700';
    num.oninput = () => { t.n = num.value; scheduleSave(); };

    const mid = el('div');
    const players = el('div'); players.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const pIn = (val, on, ph) => { const i2 = el('input'); i2.value = val || ''; i2.placeholder = ph; i2.setAttribute('list', 'cc-roster'); i2.style.cssText = 'flex:1;min-width:130px;padding:8px 10px;border:1px solid #e2e0da;border-radius:8px;font-size:14px'; i2.oninput = () => { on(i2.value); scheduleSave(); }; return i2; };
    const hi = (val, on) => { const i2 = el('input'); i2.value = val || ''; i2.placeholder = 'HI'; i2.style.cssText = 'width:56px;padding:8px 6px;border:1px solid #e2e0da;border-radius:8px;font-size:13px;text-align:center'; i2.oninput = () => { on(i2.value); scheduleSave(); }; return i2; };
    const r1 = el('div'); r1.style.cssText = 'display:flex;gap:6px;margin-bottom:6px'; r1.appendChild(pIn(t.p1, (v) => t.p1 = v, 'Player 1')); r1.appendChild(hi(t.hi1, (v) => t.hi1 = v));
    const r2 = el('div'); r2.style.cssText = 'display:flex;gap:6px'; r2.appendChild(pIn(t.p2, (v) => t.p2 = v, 'Player 2')); r2.appendChild(hi(t.hi2, (v) => t.hi2 = v));
    players.appendChild(r1); players.appendChild(r2); mid.appendChild(players);
    const opts = el('label'); opts.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#4b5563;margin-top:6px';
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = t.prepaid !== false; cb.onchange = () => { t.prepaid = cb.checked; scheduleSave(); };
    opts.appendChild(cb); opts.appendChild(document.createTextNode('Pre-paid buy-in (keeps 50% buy-back rights)')); mid.appendChild(opts);

    const auc = el('div'); auc.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const priceWrap = el('div'); priceWrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    const price = el('input'); price.type = 'number'; price.value = t.price || ''; price.placeholder = money(cur.config.startBid).replace('$', '$ ');
    price.style.cssText = 'width:96px;padding:8px 10px;border:1px solid #e2e0da;border-radius:8px;text-align:right;font-weight:700';
    price.oninput = () => { t.price = price.value === '' ? '' : (parseFloat(price.value) || 0); scheduleSave(); renderPool(); const c = $('cc-teamcount'); if (c) { const sold = cur.state.teams.filter((x) => Number(x.price) > 0).length; c.textContent = `· ${cur.state.teams.length} teams · ${sold} sold`; } };
    const plus = el('button', 'btn'); plus.textContent = '+' + cur.config.increment; plus.style.cssText = 'padding:8px 8px;font-size:12px';
    plus.onclick = () => { const base = Number(t.price) || (Number(cur.config.startBid) - Number(cur.config.increment)); t.price = base + Number(cur.config.increment); price.value = t.price; scheduleSave(); renderPool(); };
    priceWrap.appendChild(el('span', null, '$')); priceWrap.appendChild(price); priceWrap.appendChild(plus);
    const buyer = el('input'); buyer.value = t.buyer || ''; buyer.placeholder = 'Owner / buyer'; buyer.setAttribute('list', 'cc-roster');
    buyer.style.cssText = 'padding:8px 10px;border:1px solid #e2e0da;border-radius:8px;font-size:13px';
    buyer.oninput = () => { t.buyer = buyer.value; scheduleSave(); };
    const rm = el('button'); rm.className = 'slide-eye'; rm.textContent = 'Remove'; rm.style.cssText = 'font-size:11px;color:#b4232f';
    rm.onclick = () => { cur.state.teams = cur.state.teams.filter((x) => x.id !== t.id); scheduleSave(); drawTeams(); renderPool(); };
    auc.appendChild(priceWrap); auc.appendChild(buyer); auc.appendChild(rm);

    row.appendChild(num); row.appendChild(mid); row.appendChild(auc);
    return row;
  }

  /* ── projected auction board (modernized "2-minute" PowerPoint) ───────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function parseHI(s) { if (s == null || s === '') return null; s = String(s).trim(); const neg = s.startsWith('+'); const n = parseFloat(s.replace('+', '')); return isNaN(n) ? null : (neg ? -n : n); }
  function teamHI(t) { const a = parseHI(t.hi1), b = parseHI(t.hi2); if (a == null && b == null) return null; const v = Math.round(((a || 0) + (b || 0)) * 10) / 10; return v; }
  const fmtT = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  const shortName = (s) => { const p = String(s || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : (p[0] || ''); };
  const pairShort = (t) => [t.p1, t.p2].filter(Boolean).map(shortName).join(' / ') || '—';

  function presentAuction() {
    const teams = cur.state.teams.slice();
    if (!teams.length) { toast('Add teams first', true); return; }
    const slides = [{ type: 'title' }, ...teams.map((t) => ({ type: 'team', t })), { type: 'closing' }];
    const secs = Number(cur.config.auctionSeconds) || 120;
    let idx = 0, remaining = secs, timer = null, playing = false, poll = null;
    const eventTitle = (cur.tournament_name || cur.name || 'Member-Member').replace(/^Calcutta — /, '') + ' · Team Calcutta';

    const ov = el('div', 'cc-present'); ov.id = 'cc-present';
    ov.innerHTML =
      '<button class="ccp-exit" title="Exit (Esc)">✕</button>' +
      '<div class="ccp-main">' +
        '<div class="ccp-stage">' +
          '<img class="ccp-crest" src="assets/logo.png" alt="">' +
          '<div class="ccp-event"></div>' +
          '<div class="ccp-body"></div>' +
          '<div class="ccp-bid"></div>' +
        '</div>' +
        '<div class="ccp-footer">' +
          '<div class="ccp-bar"><div class="ccp-fill"></div></div>' +
          '<div class="ccp-ctrls">' +
            '<button data-a="prev">‹ Prev</button>' +
            '<button data-a="play" class="ccp-play">▶ Start</button>' +
            '<button data-a="next">Next ›</button>' +
            '<span class="ccp-count"></span>' +
            '<span class="ccp-time">' + fmtT(secs) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<aside class="ccp-rail">' +
        '<div class="ccp-rail-hd">Teams &amp; Bids</div>' +
        '<div class="ccp-rail-list"></div>' +
        '<div class="ccp-rail-foot"></div>' +
      '</aside>';
    document.body.appendChild(ov);
    const q = (s) => ov.querySelector(s);

    function renderBody() {
      const s = slides[idx];
      q('.ccp-event').textContent = eventTitle;
      const body = q('.ccp-body'); const bid = q('.ccp-bid');
      if (s.type === 'title') {
        body.innerHTML = '<div class="ccp-big">Team Calcutta</div><div class="ccp-lead">Live Auction</div>';
        bid.textContent = 'Opening bid ' + money(cur.config.startBid) + ' · ' + money(cur.config.increment) + ' minimum increments';
      } else if (s.type === 'closing') {
        body.innerHTML = '<div class="ccp-big">Good Luck!</div><div class="ccp-lead">Have a great event</div>';
        bid.textContent = '';
      } else {
        const t = s.t; const hi = teamHI(t); const sold = Number(t.price) > 0;
        body.innerHTML =
          '<div class="ccp-teamno">Team ' + esc(t.n) + '</div>' +
          '<div class="ccp-players">' +
            '<div class="ccp-p"><span class="nm">' + esc(t.p1 || '—') + '</span>' + (t.hi1 ? '<span class="hi">' + esc(t.hi1) + '</span>' : '') + '</div>' +
            '<div class="ccp-amp">&amp;</div>' +
            '<div class="ccp-p"><span class="nm">' + esc(t.p2 || '—') + '</span>' + (t.hi2 ? '<span class="hi">' + esc(t.hi2) + '</span>' : '') + '</div>' +
          '</div>' +
          (hi != null ? '<div class="ccp-teamhi">Team Handicap ' + hi + '</div>' : '') +
          (sold ? '<div class="ccp-sold">SOLD ' + money(t.price) + (t.buyer ? ' · ' + esc(t.buyer) : '') + '</div>' : '');
        bid.textContent = 'Opening bid ' + money(cur.config.startBid) + ' · ' + money(cur.config.increment) + ' increments';
      }
      const teamNo = slides.slice(0, idx + 1).filter((x) => x.type === 'team').length;
      q('.ccp-count').textContent = s.type === 'team' ? ('Team ' + teamNo + ' of ' + teams.length) : '';
    }

    function renderRail() {
      const list = q('.ccp-rail-list'); if (!list) return;
      const cs = slides[idx]; const curTeam = cs.type === 'team' ? cs.t : null;
      list.innerHTML = '';
      let total = 0, sold = 0;
      teams.forEach((t) => {
        const price = Number(t.price) || 0; if (price > 0) { total += price; sold++; }
        const row = el('div', 'ccp-row' + (t === curTeam ? ' cur' : '') + (price > 0 ? ' sold' : ''));
        row.innerHTML = '<span class="tn">' + esc(t.n) + '</span><span class="tp">' + esc(pairShort(t)) +
          (t.buyer ? '<small>' + esc(t.buyer) + '</small>' : '') + '</span><span class="ta">' + (price > 0 ? money(price) : '—') + '</span>';
        row.onclick = () => { const si = slides.findIndex((x) => x.type === 'team' && x.t === t); if (si >= 0) { idx = si; render(); } };
        list.appendChild(row);
      });
      q('.ccp-rail-foot').innerHTML = 'Pool collected <b>' + money(total) + '</b> · ' + sold + '/' + teams.length + ' sold';
      const c = list.querySelector('.ccp-row.cur'); if (c) c.scrollIntoView({ block: 'nearest' });
    }

    function render() { renderBody(); renderRail(); remaining = secs; paint(); }
    function paint() { q('.ccp-fill').style.width = (100 * (1 - remaining / secs)) + '%'; q('.ccp-time').textContent = fmtT(remaining); }
    function tick() {
      remaining--;
      if (remaining <= 0) { remaining = 0; paint(); if (slides[idx].type !== 'closing') next(); else pause(); return; }
      paint();
    }
    function play() { if (playing) return; playing = true; timer = setInterval(tick, 1000); q('.ccp-play').textContent = '⏸ Pause'; }
    function pause() { playing = false; clearInterval(timer); q('.ccp-play').textContent = '▶ Start'; }
    function toggle() { playing ? pause() : play(); }
    function next() { if (idx < slides.length - 1) { idx++; render(); } }
    function prev() { if (idx > 0) { idx--; render(); } }

    // live-sync bids/owners from the saved calcutta (banker may record on
    // another device); refreshes the rail + SOLD badge without touching the timer
    async function refresh() {
      try {
        const res = await fetch(`${SUPA_URL}/rest/v1/calcuttas?id=eq.${encodeURIComponent(cur.id)}&select=state`, {
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
        const rows = await res.json(); const st = rows && rows[0] && rows[0].state;
        if (!st || !Array.isArray(st.teams)) return;
        const byId = {}; st.teams.forEach((t) => { byId[t.id] = t; });
        teams.forEach((t) => { const u = byId[t.id]; if (u) { t.price = u.price; t.buyer = u.buyer; t.n = u.n; t.p1 = u.p1; t.p2 = u.p2; t.hi1 = u.hi1; t.hi2 = u.hi2; } });
        renderRail(); if (slides[idx].type === 'team') renderBody();
      } catch (e) { /* ignore */ }
    }

    function exit() { pause(); clearInterval(poll); document.removeEventListener('keydown', key); ov.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
    function key(e) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') exit();
      else if (e.key.toLowerCase() === 'p') toggle();
    }
    q('.ccp-exit').onclick = exit;
    q('[data-a=prev]').onclick = prev;
    q('[data-a=next]').onclick = next;
    q('[data-a=play]').onclick = toggle;
    document.addEventListener('keydown', key);
    poll = setInterval(refresh, 4000);
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    render();
  }

  window.CalcuttasTab = { load };
})();
