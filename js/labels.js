/* Locker Room tab — Locker Tags generator. Enter each guest's name and the
 * member they're a guest of (or pull the guest list straight from a tournament
 * roster), preview a classier version of the club's tag, and print a sheet
 * (two per page) that can be saved as PDF. Loaded after staff.js; reuses its
 * globals ($, api, toast, SUPA_URL, EVENTS_FN). */
(function () {
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const CREST = new URL('assets/logo.png', location.href).href;
  const FONTS = new URL('css/fonts.css', location.href).href;
  const ROSTER_FN = SUPA_URL + '/functions/v1/gg-roster';
  const panel = () => document.getElementById('panel-lockerroom');

  let rows = [{ player: '', host: '' }];
  let hostAll = '';
  let tournaments = null;

  // one shared tag design, used for the in-app preview and the print sheet
  const TAG_CSS = `
    .lt-tag { box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center; color: #2b2b28; background: #fff;
      font-family: 'Libre Baskerville', Georgia, serif; }
    .lt-tag .crest { height: 88px; margin-bottom: 12px; }
    .lt-tag .club { font-family: 'Cormorant Garamond', 'Libre Baskerville', serif; font-style: italic;
      font-weight: 600; font-size: 30px; color: #34433a; letter-spacing: .3px; line-height: 1.05; }
    .lt-tag .rule { width: 210px; height: 2px; margin: 13px 0 20px;
      background: linear-gradient(90deg, transparent, #c29a3b 20%, #c29a3b 80%, transparent); }
    .lt-tag .name { font-family: 'Cormorant Garamond', 'Libre Baskerville', serif; font-weight: 700;
      font-style: italic; font-size: 60px; line-height: 1; color: #2b2b28; }
    .lt-tag .guest { font-family: 'Cinzel', 'Libre Baskerville', serif; text-transform: uppercase;
      letter-spacing: 3.4px; font-size: 15px; font-weight: 600; color: #8e1b26; margin-top: 20px; }
    .lt-tag .guest span { color: #6d675c; }
    .lt-tag .thanks { font-style: italic; font-size: 16px; color: #5a554c; margin-top: 18px; line-height: 1.45; }`;

  function tagHTML(player, host) {
    return '<div class="lt-tag">' +
      '<img class="crest" src="' + CREST + '" alt="">' +
      '<div class="club">Treesdale Golf &amp; Country Club</div>' +
      '<div class="rule"></div>' +
      '<div class="name">' + (esc(player) || 'Guest Name') + '</div>' +
      (host || hostAll ? '<div class="guest"><span>Guest of</span> ' + esc(host || hostAll) + '</div>' : '') +
      '<div class="thanks">Thank you for joining us.<br>Enjoy your day at Treesdale!</div>' +
      '</div>';
  }

  function load() {
    const p = panel(); p.innerHTML = '';
    // scoped preview styles
    const st = el('style'); st.textContent = TAG_CSS + `
      #lt-preview .lt-tag { border: 1px solid #ece9e1; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
        padding: 34px 28px; width: 420px; max-width: 100%; }
      #lt-preview .lt-tag .name { font-size: 46px; } #lt-preview .lt-tag .crest { height: 72px; }`;
    p.appendChild(st);

    const head = el('div', 'card');
    head.appendChild(el('h3', null, 'Locker Tags'));
    head.appendChild(el('p', 'desc', "Enter each guest's name and the member they're the guest of — or pull the guest list from a tournament roster — then print a sheet (two tags per page)."));
    // host-for-all
    const hostRow = el('div'); hostRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px';
    hostRow.appendChild(Object.assign(el('div', null, 'Guest of (applies to blank rows)'), { style: 'font-size:13px;font-weight:600;flex:1' }));
    const hi = el('input'); hi.value = hostAll; hi.placeholder = 'Member name'; hi.style.cssText = 'flex:1;padding:9px 12px;border:1px solid #e2e0da;border-radius:9px';
    hi.oninput = () => { hostAll = hi.value; drawRows(); preview(); };
    hostRow.appendChild(hi);
    head.appendChild(hostRow);
    p.appendChild(head);

    const card = el('div', 'card');
    card.appendChild(el('h3', null, 'Guests'));
    const wrap = el('div'); wrap.id = 'lt-rows'; card.appendChild(wrap);
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;margin-top:12px;flex-wrap:wrap';
    const add = el('button', 'btn primary'); add.textContent = '＋ Add guest'; add.onclick = () => { rows.push({ player: '', host: '' }); drawRows(); };
    const pull = el('button', 'btn'); pull.innerHTML = '⛳ Pull from tournament'; pull.onclick = openTournamentPicker;
    const paste = el('button', 'btn'); paste.textContent = 'Paste a list'; paste.onclick = pasteList;
    const clr = el('button', 'btn'); clr.textContent = 'Clear'; clr.onclick = () => { rows = [{ player: '', host: '' }]; drawRows(); preview(); };
    bar.appendChild(add); bar.appendChild(pull); bar.appendChild(paste); bar.appendChild(clr);
    card.appendChild(bar);
    const picker = el('div'); picker.id = 'lt-picker'; picker.style.marginTop = '12px';
    card.appendChild(picker);
    p.appendChild(card);

    const pv = el('div', 'card');
    const ph = el('div'); ph.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
    ph.appendChild(el('h3', null, 'Preview'));
    const printBtn = el('button', 'btn primary'); printBtn.innerHTML = '🖨 Print / Save PDF'; printBtn.onclick = printSheet;
    ph.appendChild(printBtn); pv.appendChild(ph);
    const box = el('div'); box.id = 'lt-preview'; box.style.cssText = 'display:flex;justify-content:center;padding:16px 0';
    pv.appendChild(box);
    p.appendChild(pv);

    drawRows(); preview();
  }

  function drawRows() {
    const wrap = document.getElementById('lt-rows'); if (!wrap) return;
    wrap.innerHTML = '';
    rows.forEach((r, i) => {
      const row = el('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
      row.appendChild(Object.assign(el('div', null, (i + 1) + '.'), { style: 'width:22px;text-align:right;color:#9ca3af;font-weight:700;font-size:13px' }));
      const pn = el('input'); pn.value = r.player; pn.placeholder = 'Guest name'; pn.style.cssText = 'flex:2;min-width:150px;padding:9px 12px;border:1px solid #e2e0da;border-radius:9px';
      pn.oninput = () => { r.player = pn.value; preview(); };
      const hn = el('input'); hn.value = r.host; hn.placeholder = hostAll ? ('Guest of ' + hostAll + ' (override)') : 'Guest of… (member)'; hn.style.cssText = 'flex:2;min-width:150px;padding:9px 12px;border:1px solid #e2e0da;border-radius:9px';
      hn.oninput = () => { r.host = hn.value; preview(); };
      const rm = el('button'); rm.className = 'slide-eye'; rm.textContent = '✕'; rm.style.width = '34px';
      rm.onclick = () => { rows.splice(i, 1); if (!rows.length) rows.push({ player: '', host: '' }); drawRows(); preview(); };
      row.appendChild(pn); row.appendChild(hn); row.appendChild(rm);
      wrap.appendChild(row);
    });
  }

  /* ── pull guest names from a tournament roster ──────────────────────── */
  async function loadTournaments() {
    if (tournaments) return tournaments;
    const now = new Date();
    const today = now.toLocaleDateString('en-CA');
    const since = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()).toLocaleDateString('en-CA');
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
        const date = past.length ? past[past.length - 1] : '';
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
    const res = await fetch(`${ROSTER_FN}?page=${encodeURIComponent(pagePath)}`);
    const j = await res.json();
    return Array.isArray(j.players) ? j.players.map((p) => p.name).filter(Boolean) : [];
  }

  function fmtDate(d) {
    try { return new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return d; }
  }

  async function openTournamentPicker() {
    const box = document.getElementById('lt-picker'); if (!box) return;
    if (box.dataset.open === '1') { box.dataset.open = '0'; box.innerHTML = ''; return; }
    box.dataset.open = '1';
    box.innerHTML = '';
    const inner = el('div'); inner.style.cssText = 'border:1px solid #ece9e1;border-radius:12px;padding:14px 16px;background:#faf9f6';
    inner.appendChild(Object.assign(el('div', null, 'Loading tournaments…'), { style: 'color:#9ca3af;font-size:13px' }));
    box.appendChild(inner);

    const list = await loadTournaments();
    inner.innerHTML = '';
    const hd = el('div'); hd.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
    hd.appendChild(Object.assign(el('div', null, 'Pull guests from a tournament roster'), { style: 'font-weight:700;font-size:14px' }));
    const close = el('button'); close.className = 'slide-eye'; close.textContent = '✕'; close.style.width = '34px';
    close.onclick = () => { box.dataset.open = '0'; box.innerHTML = ''; };
    hd.appendChild(close); inner.appendChild(hd);

    if (!list.length) {
      inner.appendChild(Object.assign(el('div', null, 'No tournaments in the last two months (the events feed may be offline).'), { style: 'color:#9ca3af;font-size:13px' }));
      return;
    }
    [['mens', "Men's"], ['womens', "Women's"], ['mixed', 'Mixed']].forEach(([key, label]) => {
      const group = list.filter((t) => t.catKey === key);
      if (!group.length) return;
      const sec = el('div', null, label);
      sec.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin:12px 0 4px;';
      inner.appendChild(sec);
      group.forEach((tour) => {
        const row = el('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #efece4';
        const nm = el('div'); nm.style.cssText = 'flex:1;min-width:0;font-size:14px;font-weight:600';
        nm.textContent = tour.name;
        nm.appendChild(Object.assign(el('div', null, fmtDate(tour.date)), { style: 'font-size:12px;color:#9ca3af;font-weight:500' }));
        const b = el('button', 'btn'); b.textContent = 'Pull';
        b.onclick = async () => {
          b.disabled = true; b.textContent = 'Pulling…';
          try {
            const names = await pullRoster(tour.rosterPage);
            if (!names.length) { toast('No names found on that roster', true); }
            else {
              const parsed = names.map((n) => ({ player: n, host: '' }));
              rows = (rows.length === 1 && !rows[0].player) ? parsed : rows.concat(parsed);
              drawRows(); preview();
              toast(`Added ${names.length} guest${names.length === 1 ? '' : 's'} from ${tour.name}`);
              box.dataset.open = '0'; box.innerHTML = '';
            }
          } catch (e) { toast('Roster pull failed', true); }
          b.disabled = false; b.textContent = 'Pull';
        };
        row.appendChild(nm); row.appendChild(b);
        inner.appendChild(row);
      });
    });
  }

  function pasteList() {
    const txt = prompt('Paste guest names — one per line.\nOptionally "Guest Name, Member Name" to set the host per line.');
    if (!txt) return;
    const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const parsed = lines.map((l) => { const parts = l.split(/\s*[,|\t]\s*/); return { player: parts[0] || '', host: parts[1] || '' }; });
    rows = (rows.length === 1 && !rows[0].player) ? parsed : rows.concat(parsed);
    drawRows(); preview();
  }

  function preview() {
    const box = document.getElementById('lt-preview'); if (!box) return;
    const first = rows.find((r) => r.player.trim()) || rows[0];
    box.innerHTML = tagHTML(first.player, first.host);
  }

  function entries() { return rows.filter((r) => r.player.trim()); }

  function printSheet() {
    const list = entries();
    if (!list.length) { alert('Add at least one guest name.'); return; }
    const tags = list.map((r) => tagHTML(r.player, r.host)).join('');
    const doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Locker Tags</title>' +
      '<link rel="stylesheet" href="' + FONTS + '">' +
      '<style>' + TAG_CSS +
      '@page { size: letter; margin: 0.5in; }' +
      'html,body { margin: 0; }' +
      '.lt-tag { height: 4.75in; padding: 0.25in 0.6in; page-break-inside: avoid; }' +
      '.lt-tag:nth-of-type(2n) { page-break-after: always; }' +
      '</style></head><body>' + tags +
      '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);};<\/script>' +
      '</body></html>';
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print the tags.'); return; }
    w.document.open(); w.document.write(doc); w.document.close();
  }

  window.LabelsTab = { load };
})();
