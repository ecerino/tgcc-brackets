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
  const IN_KEY = 'tgcc_raffle_in';   // localStorage: id -> included?

  let data = null;        // raw payload from gg-beatpro
  let entrants = [];       // per-player: {id, name, team, entries, ev, color}
  let included = {};       // id -> bool
  let drawn = [];          // winners, in order
  let spinning = false;
  let loaded = false;      // fetched at least once (lazy on first tab open)

  /* ── entry math ──────────────────────────────────────────────────────── */
  function outcome(score, proScore) {
    if (score == null || proScore == null) return null;   // format not played
    if (score < proScore) return 'beat';                  // lower = better
    if (score === proScore) return 'tie';
    return 'lose';
  }

  function evalTeam(team) {
    const pro = data.pro || {};
    const outs = data.formats.map((f) => ({
      key: f.key, label: f.label,
      score: team.scores[f.key], pro: pro[f.key],
      o: outcome(team.scores[f.key], pro[f.key]),
    }));
    const played = outs.filter((x) => x.o);
    const anyBeat = played.some((x) => x.o === 'beat');
    const anyTie = played.some((x) => x.o === 'tie');
    const sweep = played.length === data.formats.length && played.every((x) => x.o === 'beat');
    const entries = anyBeat ? 10 : anyTie ? 3 : 1;
    const tier = anyBeat ? 'beat' : anyTie ? 'tie' : 'lose';
    return { outs, entries, tier, sweep };
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
        (ev.sweep ? '<span class="sweep">Swept</span>' : '') +
        '<span class="entrybadge ' + ev.tier + '">' + ev.entries + ' each</span>';
      box.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chips';
      ev.outs.forEach((o) => {
        const cls = o.o || 'none';
        const val = o.score == null ? '—' : o.score;
        chips.innerHTML += '<span class="chip ' + cls + '"><span class="k">' + esc(o.label) +
          '</span>' + val + '</span>';
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

  /* pool = included entrants minus already-drawn (when "remove winner" is on) */
  function wheelPool() {
    const drawnIds = new Set(drawn.map((d) => d.id));
    const removeMode = $('r-remove-winner').checked;
    return inEntrants().filter((e) => !(removeMode && drawnIds.has(e.id)));
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
      ctx.fillText(drawn.length ? 'All drawn' : 'No players in', C, C);
      $('r-spin').disabled = true;
      return;
    }
    $('r-spin').disabled = spinning;

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

  function spin() {
    if (spinning) return;
    const pool = wheelPool();
    if (!pool.length) return;

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
    $('r-spin').disabled = true;
    $('r-winner').className = 'winner';
    $('r-winner').innerHTML = '<div class="meta">Spinning…</div>';

    const from = rot, dur = 5200, t0 = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      rot = from + (target - from) * e;
      drawWheel();
      if (p < 1) requestAnimationFrame(frame);
      else finishSpin(winner);
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(winner) {
    spinning = false;
    $('r-spin').disabled = false;
    drawn.push({ id: winner.id, name: winner.name, team: winner.team, entries: winner.entries });
    const w = $('r-winner');
    w.className = 'winner flash';
    w.innerHTML = '<div class="big">' + esc(winner.name) + '</div>' +
      '<div class="meta">' + esc(winner.team) + ' · ' + winner.entries + ' entries</div>';
    renderDrawn();
    drawWheel();   // reflect removal if enabled
    $('r-spin').textContent = 'Spin again';
  }

  function renderDrawn() {
    const box = $('r-drawn'), ol = $('r-drawn-list');
    if (!drawn.length) { box.hidden = true; return; }
    box.hidden = false;
    ol.innerHTML = '';
    drawn.forEach((d) => {
      const li = document.createElement('li');
      li.innerHTML = esc(d.name) + '<span class="tm">' + esc(d.team) + '</span>';
      ol.appendChild(li);
    });
  }

  /* ── wire up (elements live in admin.html's raffle tab) ───────────────── */
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('r-spin', 'click', spin);
  on('r-refresh', 'click', () => loadData());
  on('r-search', 'input', renderRoster);
  on('r-all-on', 'click', () => { entrants.forEach((e) => included[e.id] = true); saveIncluded(); renderRoster(); drawWheel(); });
  on('r-all-off', 'click', () => { entrants.forEach((e) => included[e.id] = false); saveIncluded(); renderRoster(); drawWheel(); });
  on('r-remove-winner', 'change', drawWheel);

  // the admin tab bar calls this the first time the Raffle tab is opened
  window.RaffleTab = {
    load() { if (!loaded) { loaded = true; loadData(); } },
    reload: loadData,
  };
})();
