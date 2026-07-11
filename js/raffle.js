/* Beat the Pro raffle — a tab inside the brackets admin. Pulls the Treesdale
 * Cup leaderboard, turns each team's result against the pro into raffle
 * entries, and spins a weighted wheel.
 *
 * Entry rule (best outcome across the three formats; a sweep is still 10):
 *   beat the pro in ANY format → 10 entries
 *   else tie the pro in ANY    →  3 entries
 *   else (lost / participation) →  1 entry
 * Golf: a LOWER score beats the pro. Formats a team didn't play are ignored.
 * The score is the team's, but each player is their own entrant in the draw.
 *
 * Runs after admin.js, reusing its global `$` and `toast`. Everything else is
 * kept private in this IIFE so the two scripts never collide. */
(function () {
  const BEATPRO_FN = SUPA_URL + '/functions/v1/gg-beatpro';
  const IN_KEY = 'tgcc_raffle_in';         // localStorage: id -> included?
  const PRIZE_KEY = 'tgcc_raffle_prizes';  // localStorage: prize list + winners

  let data = null;        // raw payload from gg-beatpro
  let entrants = [];       // per-player: {id, name, team, entries, ev, color}
  let included = {};       // id -> bool
  let prizes = [];         // [{id, name, winner: {id,name,team,entries} | null}]
  let spinning = false;
  let loaded = false;      // fetched at least once (lazy on first tab open)
  let nextPrizeId = 1;

  /* ── entry math ──────────────────────────────────────────────────────── */
  function outcome(score, proScore) {
    if (score == null || proScore == null) return null;   // format not played
    if (score < proScore) return 'beat';                  // lower = better
    if (score === proScore) return 'tie';
    return 'lose';
  }

  // per-format entries — each format scores on its own, then a sweep bonus
  const PTS = { beat: 10, tie: 3, lose: 1 };   // (a format not played scores 0)
  const SWEEP_BONUS = 10;

  function evalTeam(team) {
    const pro = data.pro || {};
    const outs = data.formats.map((f) => {
      const o = outcome(team.scores[f.key], pro[f.key]);
      return {
        key: f.key, label: f.label,
        score: team.scores[f.key], pro: pro[f.key],
        o, pts: o ? PTS[o] : 0,
      };
    });
    const played = outs.filter((x) => x.o);
    const base = outs.reduce((s, x) => s + x.pts, 0);
    const sweep = played.length === data.formats.length && played.every((x) => x.o === 'beat');
    const bonus = sweep ? SWEEP_BONUS : 0;
    const entries = base + bonus;
    return { outs, entries, base, bonus, sweep };
  }

  /* ── build the entrant list from the payload ─────────────────────────── */
  function buildEntrants() {
    try { included = JSON.parse(localStorage.getItem(IN_KEY)) || {}; } catch { included = {}; }
    entrants = [];
    (data.teams || []).forEach((team, ti) => {
      const ev = evalTeam(team);
      (team.players || []).forEach((name) => {
        const id = team.team + '::' + name;
        if (!(id in included)) included[id] = true;   // default: everyone in
        entrants.push({ id, name, team: team.team, pos: team.pos, entries: ev.entries, ev, ti });
      });
    });
  }

  function saveIncluded() { localStorage.setItem(IN_KEY, JSON.stringify(included)); }

  /* stable per-entrant color for the wheel + roster swatch */
  const PALETTE = ['#8e1b26', '#2c3e33', '#c29a3b', '#3f6f8f', '#7d5ba6',
                   '#b5642e', '#4a8b6f', '#a13a66', '#5f6caf', '#807d1e'];
  const colorFor = (i) => PALETTE[i % PALETTE.length];

  /* ── data load ───────────────────────────────────────────────────────── */
  async function loadData() {
    $('r-roster').innerHTML = '<div class="loading">Loading leaderboard…</div>';
    try {
      const res = await fetch(BEATPRO_FN, {
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      if (data.error) throw new Error(data.error);
      buildEntrants();
      renderEvent();
      renderRoster();
      drawWheel();
      renderPrizes();   // spin buttons enable now that the pool has players
    } catch (e) {
      $('r-roster').innerHTML = '<div class="loading">Could not load the leaderboard (' +
        e.message + '). Try Refresh scores.</div>';
    }
  }

  /* ── event / pro header ──────────────────────────────────────────────── */
  function renderEvent() {
    $('r-event-title').textContent = (data.event || 'Beat the Pro') + ' — Raffle';
    const when = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) : '';
    $('r-event-sub').textContent = (data.teams || []).length + ' teams · ' +
      entrants.length + ' players' + (when ? ' · scores as of ' + when : '');
    const pills = $('r-pro-pills');
    pills.innerHTML = '';
    data.formats.forEach((f) => {
      const v = data.pro ? data.pro[f.key] : null;
      const p = document.createElement('span');
      p.className = 'fmtpill';
      p.innerHTML = '<small>' + esc(f.label) + '</small> <b>' + (v == null ? '—' : v) + '</b>';
      pills.appendChild(p);
    });
  }

  /* ── roster ──────────────────────────────────────────────────────────── */
  function renderRoster() {
    const q = ($('r-search').value || '').trim().toLowerCase();
    const root = $('r-roster');
    root.innerHTML = '';
    let colorIx = 0;

    (data.teams || []).forEach((team, ti) => {
      const ev = evalTeam(team);
      const mine = entrants.filter((e) => e.ti === ti);
      const hay = (team.team + ' ' + mine.map((m) => m.name).join(' ')).toLowerCase();
      if (q && !hay.includes(q)) { colorIx += mine.length; return; }

      const anyIn = mine.some((m) => included[m.id]);
      const box = document.createElement('div');
      box.className = 'team' + (anyIn ? '' : ' out');

      const head = document.createElement('div');
      head.className = 'team-head';
      head.innerHTML =
        '<span class="team-name">' + esc(team.team) + '</span>' +
        (team.pos ? '<span class="team-pos">' + esc(team.pos) + '</span>' : '') +
        (ev.sweep ? '<span class="sweep">Swept +' + ev.bonus + '</span>' : '') +
        '<span class="entrybadge' + (ev.sweep ? ' sweep' : '') + '">' + ev.entries + ' each</span>';
      box.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chips';
      ev.outs.forEach((o) => {
        const cls = o.o || 'none';
        const val = o.score == null ? '—' : o.score;
        const pts = o.o ? '<span class="pts">+' + o.pts + '</span>' : '';
        chips.innerHTML += '<span class="chip ' + cls + '"><span class="k">' + esc(o.label) +
          '</span>' + val + pts + '</span>';
      });
      box.appendChild(chips);

      const pl = document.createElement('div');
      pl.className = 'players';
      mine.forEach((m) => {
        m.color = colorFor(colorIx++);
        const row = document.createElement('label');
        row.className = 'pl' + (included[m.id] ? '' : ' off');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!included[m.id];
        cb.onchange = () => {
          included[m.id] = cb.checked;
          saveIncluded();
          renderRoster();
          drawWheel();
          renderPrizes();
        };
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = m.color;
        const nm = document.createElement('span');
        nm.textContent = m.name;
        row.appendChild(cb); row.appendChild(sw); row.appendChild(nm);
        pl.appendChild(row);
      });
      box.appendChild(pl);
      root.appendChild(box);
    });

    updateStats();
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function inEntrants() { return entrants.filter((e) => included[e.id]); }

  function updateStats() {
    const list = inEntrants();
    $('r-stat-players').textContent = list.length;
    $('r-stat-entries').textContent = list.reduce((a, e) => a + e.entries, 0);
  }

  /* ── wheel ───────────────────────────────────────────────────────────── */
  const TWO_PI = Math.PI * 2;
  let rot = -Math.PI / 2;   // current wheel rotation (radians)

  /* the wheel pool is everyone included, minus anyone already won a prize —
     a person can only win once across the night */
  function wonIds() { return new Set(prizes.filter((p) => p.winner).map((p) => p.winner.id)); }
  function wheelPool() {
    const won = wonIds();
    return inEntrants().filter((e) => !won.has(e.id));
  }

  function drawWheel() {
    const cv = $('r-wheel');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const S = cv.width, C = S / 2, R = C - 6;
    ctx.clearRect(0, 0, S, S);

    const pool = wheelPool();
    const total = pool.reduce((a, e) => a + e.entries, 0);

    if (!pool.length || total <= 0) {
      ctx.fillStyle = '#f1f1ef';
      ctx.beginPath(); ctx.arc(C, C, R, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#b8b8b3';
      ctx.font = '600 26px Inter, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(wonIds().size ? 'All drawn' : 'No players in', C, C);
      return;
    }

    let a = rot;
    pool.forEach((e, i) => {
      const arc = (e.entries / total) * TWO_PI;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.arc(C, C, R, a, a + arc);
      ctx.closePath();
      ctx.fillStyle = e.color || colorFor(i);
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.stroke();

      if (arc > 0.12) {   // label larger slices with the player's last name
        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(a + arc / 2);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        const size = Math.max(12, Math.min(22, arc * 90));
        ctx.font = '700 ' + size + 'px Inter, sans-serif';
        const last = e.name.split(' ').slice(-1)[0];
        ctx.fillText(last, R - 14, 0);
        ctx.restore();
      }
      a += arc;
    });

    // rim
    ctx.beginPath(); ctx.arc(C, C, R, 0, TWO_PI);
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(C, C, R + 2, 0, TWO_PI);
    ctx.lineWidth = 2; ctx.strokeStyle = '#e0ded8'; ctx.stroke();
  }

  /* weighted random pick, proportional to entries */
  function weightedPick(pool) {
    const total = pool.reduce((a, e) => a + e.entries, 0);
    let r = Math.random() * total;
    for (const e of pool) { r -= e.entries; if (r < 0) return e; }
    return pool[pool.length - 1];
  }

  function mod(x, m) { return ((x % m) + m) % m; }

  /* spin the wheel and assign the landed winner to `prize` */
  function spinForPrize(prize) {
    if (spinning) return;
    const pool = wheelPool();
    if (!pool.length) { toast('No players left in the pool', true); return; }

    const winner = weightedPick(pool);          // fair draw ∝ entries
    const total = pool.reduce((a, e) => a + e.entries, 0);

    // cumulative start angle of the winner's slice (before rotation)
    let start = 0;
    for (const e of pool) { if (e === winner) break; start += (e.entries / total) * TWO_PI; }
    const arc = (winner.entries / total) * TWO_PI;
    const centerLocal = start + arc / 2 + (Math.random() - 0.5) * arc * 0.6;

    // land the winner's slice center under the top pointer (screen angle -π/2)
    const desired = -Math.PI / 2 - centerLocal;
    const turns = 6;
    const base = rot + turns * TWO_PI;
    let target = base - mod(base + Math.PI / 2, TWO_PI) + mod(desired + Math.PI / 2, TWO_PI);
    while (target < rot + 4 * TWO_PI) target += TWO_PI;

    spinning = true;
    renderPrizes();   // disable spin buttons while spinning
    $('r-winner').className = 'winner';
    $('r-winner').innerHTML = '<div class="meta">Spinning for ' + esc(prize.name) + '…</div>';

    const from = rot, dur = 5200, t0 = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      rot = from + (target - from) * e;
      drawWheel();
      if (p < 1) requestAnimationFrame(frame);
      else finishSpin(winner, prize);
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(winner, prize) {
    spinning = false;
    prize.winner = { id: winner.id, name: winner.name, team: winner.team, entries: winner.entries };
    savePrizes();
    const w = $('r-winner');
    w.className = 'winner flash';
    w.innerHTML = '<div class="big">' + esc(winner.name) + '</div>' +
      '<div class="meta">wins <b>' + esc(prize.name) + '</b> · ' + esc(winner.team) + '</div>';
    renderPrizes();
    drawWheel();   // winner is now out of the pool
  }

  /* ── prizes ──────────────────────────────────────────────────────────── */
  function loadPrizes() {
    try { prizes = JSON.parse(localStorage.getItem(PRIZE_KEY)) || []; } catch { prizes = []; }
    prizes.forEach((p) => { if (typeof p.id === 'number' && p.id >= nextPrizeId) nextPrizeId = p.id + 1; });
  }
  function savePrizes() { localStorage.setItem(PRIZE_KEY, JSON.stringify(prizes)); }

  function addPrize() {
    const inp = $('r-prize-name');
    const name = inp.value.trim();
    if (!name) return;
    prizes.push({ id: nextPrizeId++, name, winner: null });
    inp.value = '';
    savePrizes();
    renderPrizes();
    inp.focus();
  }

  let editingId = null;   // prize id currently being renamed inline

  function movePrize(prize, dir) {
    const i = prizes.indexOf(prize);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prizes.length) return;
    prizes.splice(i, 1);
    prizes.splice(j, 0, prize);
    savePrizes();
    renderPrizes();
  }

  function commitEdit(prize, value) {
    const name = value.trim();
    editingId = null;
    if (name && name !== prize.name) { prize.name = name; savePrizes(); }
    renderPrizes();
  }

  function renderPrizes() {
    const ol = $('r-prizes');
    ol.innerHTML = '';
    const poolEmpty = wheelPool().length === 0;
    const mini = (glyph, title, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'pz-mini'; b.title = title; b.textContent = glyph;
      b.disabled = !!disabled; b.onclick = fn;
      return b;
    };

    prizes.forEach((prize, ix) => {
      const li = document.createElement('li');
      li.className = 'pz' + (prize.winner ? ' done' : '');

      // reorder chevrons
      const move = document.createElement('div');
      move.className = 'pz-move';
      move.appendChild(mini('▲', 'Move up', () => movePrize(prize, -1), spinning || ix === 0));
      move.appendChild(mini('▼', 'Move down', () => movePrize(prize, 1), spinning || ix === prizes.length - 1));
      li.appendChild(move);

      const main = document.createElement('div');
      main.className = 'pz-main';
      if (editingId === prize.id) {
        const inp = document.createElement('input');
        inp.className = 'pz-edit'; inp.value = prize.name;
        inp.onkeydown = (e) => {
          if (e.key === 'Enter') commitEdit(prize, inp.value);
          else if (e.key === 'Escape') { editingId = null; renderPrizes(); }
        };
        inp.onblur = () => commitEdit(prize, inp.value);
        main.appendChild(inp);
        li.appendChild(main);
        ol.appendChild(li);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        return;
      }
      const nm = document.createElement('span');
      nm.className = 'pz-name'; nm.textContent = prize.name;
      nm.title = 'Click to rename';
      nm.onclick = () => { if (!spinning) { editingId = prize.id; renderPrizes(); } };
      main.appendChild(nm);
      if (prize.winner) {
        const win = document.createElement('span');
        win.className = 'pz-win';
        win.innerHTML = '🏆 ' + esc(prize.winner.name) + ' <span class="tm">· ' + esc(prize.winner.team) + '</span>';
        main.appendChild(win);
      }
      li.appendChild(main);

      li.appendChild(mini('✎', 'Rename prize', () => { editingId = prize.id; renderPrizes(); }, spinning));

      if (prize.winner) {
        li.appendChild(mini('↻', 'Redraw this prize', () => {
          prize.winner = null; savePrizes(); renderPrizes(); drawWheel();
        }, spinning));
      } else {
        const spinBtn = document.createElement('button');
        spinBtn.className = 'pz-spin'; spinBtn.textContent = 'Spin';
        spinBtn.disabled = spinning || poolEmpty;
        spinBtn.onclick = () => spinForPrize(prize);
        li.appendChild(spinBtn);
      }

      li.appendChild(mini('×', 'Remove prize', () => {
        prizes = prizes.filter((p) => p !== prize);
        savePrizes(); renderPrizes(); drawWheel();
      }, spinning));

      ol.appendChild(li);
    });
    $('r-print').hidden = !prizes.some((p) => p.winner);
  }

  /* open a clean, printable winners sheet (browser "Save as PDF") */
  function printWinners() {
    const won = prizes.filter((p) => p.winner);
    if (!won.length) { toast('No winners drawn yet', true); return; }
    const logo = new URL('assets/logo.png', location.href).href;
    const when = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const rows = won.map((p, i) =>
      '<tr><td class="n">' + (i + 1) + '</td><td class="pz">' + esc(p.name) + '</td>' +
      '<td>' + esc(p.winner.name) + '<div class="tm">' + esc(p.winner.team) + '</div></td></tr>').join('');
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(data && data.event ? data.event : 'Raffle') + ' — Winners</title><style>' +
      'body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:760px;margin:40px auto;padding:0 24px}' +
      'header{display:flex;align-items:center;gap:14px;margin-bottom:22px;border-bottom:2px solid #8e1b26;padding-bottom:16px}' +
      'header img{height:50px}h1{font-size:22px;margin:0;letter-spacing:-.3px}.sub{color:#6b7280;font-size:13px;margin-top:3px}' +
      'table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #e7e5e0;vertical-align:top}' +
      'th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af}td.n{width:34px;color:#9ca3af;font-weight:700}' +
      'td.pz{font-weight:700}.tm{color:#9ca3af;font-size:12px;margin-top:2px}' +
      '@media print{body{margin:0}}</style></head><body>' +
      '<header><img src="' + logo + '" alt=""><div><h1>' +
      esc(data && data.event ? data.event : 'Beat the Pro Raffle') + ' — Raffle Winners</h1>' +
      '<div class="sub">' + when + '</div></div></header>' +
      '<table><thead><tr><th>#</th><th>Prize</th><th>Winner</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},300)}</scr' + 'ipt>' +
      '</body></html>';
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to print the winners list', true); return; }
    win.document.write(html);
    win.document.close();
  }

  /* ── wire up (elements live in admin.html's raffle tab) ───────────────── */
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('r-refresh', 'click', () => loadData());
  on('r-search', 'input', renderRoster);
  on('r-all-on', 'click', () => { entrants.forEach((e) => included[e.id] = true); saveIncluded(); renderRoster(); drawWheel(); renderPrizes(); });
  on('r-all-off', 'click', () => { entrants.forEach((e) => included[e.id] = false); saveIncluded(); renderRoster(); drawWheel(); renderPrizes(); });
  on('r-add-prize', 'click', addPrize);
  on('r-prize-name', 'keydown', (e) => { if (e.key === 'Enter') addPrize(); });
  on('r-print', 'click', printWinners);
  loadPrizes();
  renderPrizes();

  // the admin tab bar calls this the first time the Raffle tab is opened
  window.RaffleTab = {
    load() { if (!loaded) { loaded = true; loadData(); } },
    reload: loadData,
  };
})();
