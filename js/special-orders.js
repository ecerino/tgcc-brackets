/* Special Orders tab for the staff hub. Track member special orders — what was
 * ordered, for whom, its status, notes, and an attached document (PDF, image,
 * spreadsheet…). Everything persists to the Supabase `special_orders` table via
 * palmer-admin; uploaded files live in a private storage bucket and are opened
 * through short-lived signed URLs.
 *
 * Loaded after staff.js; reuses its globals: $, api, toast, SUPA_URL, SUPA_KEY. */
(function () {
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const uid = () => Math.random().toString(36).slice(2, 9);

  const STATUS = [
    { key: 'pending', label: 'Pending', color: '#b7791f', bg: '#fdf6e6' },
    { key: 'ordered', label: 'Ordered', color: '#2563eb', bg: '#eef3ff' },
    { key: 'arrived', label: 'Arrived', color: '#0d9488', bg: '#e6f6f4' },
    { key: 'completed', label: 'Completed', color: '#2c7a45', bg: '#eaf3ec' },
    { key: 'cancelled', label: 'Cancelled', color: '#b4232f', bg: '#fbebec' },
  ];
  const stMeta = (k) => STATUS.find((s) => s.key === k) || STATUS[0];

  let orders = [];
  let editing = null;   // order being added/edited, or null for list view

  const panel = () => $('panel-specialorders');

  const readFileB64 = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res({ name: f.name, type: f.type, data: s.slice(s.indexOf(',') + 1) }); };
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  async function loadList() {
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/special_orders?select=*&order=updated_at.desc`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
      orders = await res.json();
      if (!Array.isArray(orders)) orders = [];
    } catch (e) { orders = []; toast('Could not load special orders', true); }
  }

  async function load() {
    panel().innerHTML = '<div class="card" style="text-align:center;color:#9ca3af">Loading…</div>';
    await loadList();
    editing = null;
    render();
  }

  function render() {
    if (editing) return renderEdit();
    renderList();
  }

  /* ── list ───────────────────────────────────────────────────────────── */
  function renderList() {
    const p = panel(); p.innerHTML = '';
    const head = el('div', 'card');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px';
    const h = el('div');
    h.appendChild(el('h3', null, 'Special Orders'));
    h.appendChild(el('p', 'desc', 'Track member special orders and attach the order document. Progress is saved.'));
    const add = el('button', 'btn primary'); add.innerHTML = '＋ New Special Order';
    add.onclick = () => { editing = newOrder(); render(); };
    head.appendChild(h); head.appendChild(add);
    p.appendChild(head);

    // status filter chips + count
    const list = el('div', 'card');
    const lh = el('h3', null, 'Orders');
    const cnt = el('span'); cnt.style.cssText = 'font-weight:600;color:#9ca3af;font-size:13px;margin-left:6px';
    cnt.textContent = orders.length ? `· ${orders.length}` : '';
    lh.appendChild(cnt);
    list.appendChild(lh);

    if (!orders.length) {
      list.appendChild(el('p', 'desc', 'No special orders yet — tap “New Special Order”.'));
    } else {
      orders.forEach((o) => list.appendChild(rowFor(o)));
    }
    p.appendChild(list);
  }

  function rowFor(o) {
    const row = el('div', 'slide-row');
    const nm = el('div', 'slide-name');
    nm.textContent = o.title || '(untitled order)';
    const sub = el('small');
    const when = (o.updated_at || '').slice(0, 10);
    sub.textContent = [o.customer, o.file_name ? '📎 ' + o.file_name : null, when].filter(Boolean).join(' · ');
    nm.appendChild(sub);

    const right = el('div'); right.style.cssText = 'display:flex;align-items:center;gap:10px;flex:0 0 auto';
    const m = stMeta(o.status);
    const badge = el('span'); badge.textContent = m.label;
    badge.style.cssText = `font-size:11px;font-weight:700;letter-spacing:.3px;padding:5px 11px;border-radius:999px;color:${m.color};background:${m.bg};`;
    right.appendChild(badge);

    const btns = el('div', 'slide-btns');
    if (o.file_path) {
      const dl = el('button', 'btn'); dl.textContent = 'File';
      dl.onclick = async () => {
        dl.disabled = true; const old = dl.textContent; dl.textContent = 'Opening…';
        try { const r = await api({ action: 'order_file_url', order_id: o.id }); if (r.url) window.open(r.url, '_blank'); }
        catch (e) { toast(e.message, true); }
        dl.disabled = false; dl.textContent = old;
      };
      btns.appendChild(dl);
    }
    const edit = el('button', 'btn'); edit.textContent = 'Edit';
    edit.onclick = () => { editing = JSON.parse(JSON.stringify(o)); render(); };
    const del = el('button'); del.className = 'slide-eye'; del.textContent = 'Delete'; del.style.color = '#b4232f';
    del.onclick = async () => {
      if (!confirm('Delete this special order' + (o.file_path ? ' and its file' : '') + '?')) return;
      try { await api({ action: 'delete_order', order_id: o.id }); toast('Order deleted'); await loadList(); render(); }
      catch (e) { toast(e.message, true); }
    };
    btns.appendChild(edit); btns.appendChild(del);
    right.appendChild(btns);

    row.appendChild(nm); row.appendChild(right);
    return row;
  }

  /* ── add / edit ─────────────────────────────────────────────────────── */
  function newOrder() {
    return { id: 'so_' + Date.now().toString(36) + uid(), title: '', customer: '', status: 'pending', notes: '', file_path: null, file_name: null, _new: true };
  }

  function field(label, node) {
    const w = el('div'); w.style.marginBottom = '14px';
    const l = el('div', null, label); l.style.cssText = 'font-size:13px;font-weight:700;margin-bottom:6px;color:#374151';
    w.appendChild(l); w.appendChild(node);
    return w;
  }
  const INP = 'width:100%;padding:10px 12px;border:1px solid #e2e0da;border-radius:9px;font:inherit;font-size:14px;box-sizing:border-box';

  function renderEdit() {
    const o = editing;
    const p = panel(); p.innerHTML = '';
    const back = el('button', 'btn'); back.textContent = '← Back'; back.style.marginBottom = '16px';
    back.onclick = () => { editing = null; render(); };
    p.appendChild(back);

    const card = el('div', 'card');
    card.appendChild(el('h3', null, o._new ? 'New Special Order' : 'Edit Special Order'));

    const title = el('input'); title.value = o.title || ''; title.placeholder = 'What was ordered (e.g. FootJoy Pro/SL, size 10.5)'; title.style.cssText = INP;
    title.oninput = () => { o.title = title.value; };
    card.appendChild(field('Order', title));

    const cust = el('input'); cust.value = o.customer || ''; cust.placeholder = 'Member / customer name'; cust.style.cssText = INP;
    cust.oninput = () => { o.customer = cust.value; };
    card.appendChild(field('Member', cust));

    const sel = el('select'); sel.style.cssText = INP + ';appearance:auto';
    STATUS.forEach((s) => { const op = el('option', null, s.label); op.value = s.key; if (o.status === s.key) op.selected = true; sel.appendChild(op); });
    sel.onchange = () => { o.status = sel.value; };
    card.appendChild(field('Status', sel));

    const notes = el('textarea'); notes.value = o.notes || ''; notes.placeholder = 'Notes — supplier, order date, expected arrival, price…'; notes.rows = 4; notes.style.cssText = INP + ';resize:vertical';
    notes.oninput = () => { o.notes = notes.value; };
    card.appendChild(field('Notes', notes));

    // document
    const docWrap = el('div');
    if (o.file_name) {
      const cur = el('div'); cur.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13.5px;color:#374151';
      cur.appendChild(el('span', null, '📎 ' + o.file_name));
      const rm = el('button', 'btn'); rm.textContent = 'Remove'; rm.style.color = '#b4232f';
      rm.onclick = () => { o._removeFile = true; o.file_name = null; o.file_path = null; o._file = null; renderEdit(); };
      cur.appendChild(rm);
      docWrap.appendChild(cur);
    }
    const fileIn = el('input'); fileIn.type = 'file';
    fileIn.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';
    fileIn.style.cssText = 'font-size:13.5px';
    fileIn.onchange = () => {
      const f = fileIn.files && fileIn.files[0];
      o._pendingFile = f || null; o._removeFile = false;
      pick.textContent = f ? 'Selected: ' + f.name : '';
    };
    const pick = el('div'); pick.style.cssText = 'font-size:12.5px;color:#6b7280;margin-top:6px';
    docWrap.appendChild(fileIn); docWrap.appendChild(pick);
    card.appendChild(field(o.file_name ? 'Replace document' : 'Attach document (optional)', docWrap));

    const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;margin-top:6px';
    const save = el('button', 'btn primary'); save.textContent = 'Save Order';
    save.onclick = () => doSave(save);
    const cancel = el('button', 'btn'); cancel.textContent = 'Cancel'; cancel.onclick = () => { editing = null; render(); };
    bar.appendChild(save); bar.appendChild(cancel);
    card.appendChild(bar);
    p.appendChild(card);
  }

  async function doSave(btn) {
    const o = editing;
    if (!o.title.trim() && !o.customer.trim()) { toast('Add an order or a member name first', true); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const body = { action: 'save_order', order: { id: o.id, title: o.title, customer: o.customer, status: o.status, notes: o.notes } };
      if (o._pendingFile) body.file = await readFileB64(o._pendingFile);
      else if (o._removeFile) body.file = null;
      await api(body);
      toast('Order saved');
      await loadList();
      editing = null;
      render();
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Save Order'; }
  }

  window.SpecialOrdersTab = { load };
})();
