/* Budget app. All data lives on this phone in localStorage. */
(function () {
  const P = window.Parser;
  const KEY = 'budget.v1';
  const PALETTE = ['#2f8f6b', '#d08a2e', '#3f7cc7', '#a35bc4', '#c8553d', '#4aa3a1', '#8a7a3c', '#d16d9e', '#6b7f99', '#7aa33a', '#b0624a', '#5a6ad1'];
  const EXCLUDED = ['Transfers', 'Investing', 'Income'];
  const UNCAT = 'Uncategorized';

  const DEFAULT_CATS = [
    ['Groceries', 300], ['Dining', 250], ['Gas', 150], ['Transport', 60], ['Shopping', 150],
    ['Subscriptions', 40], ['Bills', 200], ['Fun', 150], ['Other', 100],
    ['Transfers', 0], ['Investing', 0], ['Income', 0],
  ].map(([name, budget], i) => ({ name, budget, color: PALETTE[i % PALETTE.length] }));

  let S = load();
  const ui = { tab: 'overview', month: monthOf(new Date()), filter: null, q: '' };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.txns && s.cats) return Object.assign({ rules: {}, seen: {}, lastSync: null }, s);
    } catch (e) { }
    return { cats: DEFAULT_CATS, txns: [], rules: {}, seen: {}, lastSync: null };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save: storage full?'); } }

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, cents = true) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  function monthOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  function shiftMonth(m, k) { const [y, mo] = m.split('-').map(Number); return monthOf(new Date(y, mo - 1 + k, 1)); }
  function daysIn(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
  function dayLabel(ds) {
    const today = P.ymd(new Date()), y = P.ymd(new Date(Date.now() - 864e5));
    if (ds === today) return 'Today'; if (ds === y) return 'Yesterday';
    const [Y, M, D] = ds.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const catByName = n => S.cats.find(c => c.name === n);
  const colorOf = n => (catByName(n) || {}).color || '#9a9c95';
  const isExcluded = n => EXCLUDED.includes(n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  // ---------- import ----------
  function addTxn(p, src) {
    const t = {
      id: uid(), date: P.ymd(p.date || new Date()), amount: p.amount, kind: p.kind,
      merchant: p.merchant, cat: P.categorize(p, S.rules), note: '', src, acct: p.acct || null,
    };
    S.txns.push(t);
    return t;
  }

  function nearDuplicate(p) {
    const d = P.ymd(p.date || new Date());
    const t0 = new Date(d).getTime();
    return S.txns.some(t => t.kind === p.kind && Math.abs(t.amount - p.amount) < 0.005 && Math.abs(new Date(t.date).getTime() - t0) <= 3 * 864e5);
  }

  function importText(text) {
    text = String(text || '');
    if (/^\s*\{/.test(text) && /"txns"/.test(text)) return restore(text);
    let added = 0, skipped = 0;
    if (P.isChaseCSV(text)) {
      for (const p of P.parseChaseCSV(text)) {
        const h = 'c' + P.hash(p.raw);
        if (S.seen[h]) { skipped++; continue; }
        S.seen[h] = 1;
        if (nearDuplicate(p)) { skipped++; continue; }
        addTxn(p, 'csv'); added++;
      }
    } else {
      for (const e of P.splitLog(text)) {
        const h = 'a' + P.hash(e.raw.replace(/\s+/g, ' '));
        if (S.seen[h]) continue;
        S.seen[h] = 1;
        const p = P.parseAlert(e.body, e.when);
        if (!p) { skipped++; continue; }
        addTxn(p, 'alert'); added++;
      }
    }
    S.lastSync = new Date().toISOString();
    save();
    render();
    toast(added ? `Added ${added} transaction${added === 1 ? '' : 's'}` : 'Already up to date');
    return added;
  }

  function restore(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('That backup file is not valid'); return 0; }
    if (!data.txns || !data.cats) { toast('That backup file is not valid'); return 0; }
    if (!confirm(`Replace everything with this backup (${data.txns.length} transactions)?`)) return 0;
    S = Object.assign({ rules: {}, seen: {}, lastSync: null }, data);
    save(); render(); toast('Backup restored');
    return data.txns.length;
  }

  function pickFile() { const f = $('#file'); f.value = ''; f.click(); }
  $('#file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => importText(r.result);
    r.onerror = () => toast('Could not read that file');
    r.readAsText(file);
  });

  async function exportBackup() {
    const json = JSON.stringify(S);
    const name = `budget-backup-${P.ymd(new Date())}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- math ----------
  function monthData(m) {
    const txns = S.txns.filter(t => t.date.startsWith(m));
    const spent = {}; let total = 0, income = 0, invested = 0, uncat = 0;
    for (const t of txns) {
      if (t.cat === 'Income') { income += t.kind === 'income' ? t.amount : -t.amount; continue; }
      if (t.cat === 'Investing') { invested += t.kind === 'expense' ? t.amount : -t.amount; continue; }
      if (isExcluded(t.cat)) continue;
      const v = t.kind === 'expense' ? t.amount : -t.amount;
      spent[t.cat] = (spent[t.cat] || 0) + v; total += v;
      if (t.cat === UNCAT) uncat++;
    }
    const budget = S.cats.filter(c => !isExcluded(c.name)).reduce((a, c) => a + (+c.budget || 0), 0);
    return { txns, spent, total, income, invested, budget, uncat };
  }

  // ---------- views ----------
  function header() {
    const isNow = ui.month === monthOf(new Date());
    return `<header>
      <div class="month">
        <button class="icon-btn" data-act="prev" aria-label="Previous month"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>
        <h1>${esc(monthLabel(ui.month).replace(/ \d{4}$/, m => isNow || ui.month.startsWith(new Date().getFullYear()) ? '' : m))}</h1>
        <button class="icon-btn" data-act="next" aria-label="Next month" ${isNow ? 'style="visibility:hidden"' : ''}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <button class="sync-btn" data-act="sync"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 2v4.7h-4.7M6 22v-4.7h4.7"/></svg>Sync</button>
    </header>`;
  }

  function barClass(spent, budget, frac) {
    if (budget <= 0) return spent > 0 ? 'over' : '';
    if (spent > budget) return 'over';
    if (frac != null && spent / budget > frac + 0.1) return 'warn';
    return '';
  }

  function overview() {
    const d = monthData(ui.month);
    const isNow = ui.month === monthOf(new Date());
    const dim = daysIn(ui.month);
    const today = new Date().getDate();
    const frac = isNow ? today / dim : null;
    const left = d.budget - d.total;
    const daysLeft = isNow ? dim - today + 1 : 0;

    if (!S.txns.length) {
      return header() + `<div class="empty"><b>No transactions yet</b>Once the Chase text Shortcut is set up, tap <b style="display:inline;font-size:inherit">Sync</b> and pick <code>budget-log.txt</code>. Setup steps are under Budgets.</div>`;
    }

    let sub;
    if (isNow) sub = left >= 0 ? `About <b class="num">${money(left / daysLeft, false)}</b> a day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `<b class="num">${money(-left, false)}</b> over with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
    else sub = left >= 0 ? `Finished <b class="num">${money(left, false)}</b> under budget` : `Finished <b class="num">${money(-left, false)}</b> over budget`;

    const pct = d.budget > 0 ? Math.min(100, d.total / d.budget * 100) : 0;
    let html = header() + `
      <section class="hero">
        <div class="label">${isNow ? 'Left to spend' : (left >= 0 ? 'Left over' : 'Over budget')}</div>
        <div class="big num ${left < 0 ? 'over' : ''}">${money(Math.abs(left), false)}</div>
        <div class="sub">${sub}</div>
        <div class="bar"><i class="${barClass(d.total, d.budget, frac)}" style="width:${pct}%"></i>${isNow ? `<span class="pace" style="left:${frac * 100}%"></span>` : ''}</div>
        <div class="bar-legend"><span class="num">${money(d.total, false)} spent</span><span class="num">${money(d.budget, false)} budget</span></div>
      </section>
      <div class="stats">
        <div class="stat"><div class="k">Income</div><div class="v num">${money(d.income, false)}</div></div>
        <div class="stat"><div class="k">Invested</div><div class="v num">${money(d.invested, false)}</div></div>
        <div class="stat"><div class="k">Net</div><div class="v num" style="color:${d.income - d.total >= 0 ? 'var(--good)' : 'var(--bad)'}">${money(d.income - d.total, false)}</div></div>
      </div>`;

    if (d.uncat) html += `<button class="banner" data-act="filter" data-cat="${UNCAT}"><span><b>${d.uncat}</b> transaction${d.uncat === 1 ? '' : 's'} need${d.uncat === 1 ? 's' : ''} a category</span><span class="link">Fix</span></button>`;

    const rows = S.cats.filter(c => !isExcluded(c.name) && (c.budget > 0 || d.spent[c.name]))
      .map(c => ({ name: c.name, color: c.color, budget: +c.budget || 0, spent: d.spent[c.name] || 0 }));
    if (d.spent[UNCAT]) rows.push({ name: UNCAT, color: '#9a9c95', budget: 0, spent: d.spent[UNCAT] });

    html += `<h2>Categories</h2><div class="card">` + rows.map(r => {
      const rem = r.budget - r.spent;
      const w = r.budget > 0 ? Math.min(100, Math.max(0, r.spent / r.budget * 100)) : (r.spent > 0 ? 100 : 0);
      const cls = r.name === UNCAT ? 'warn' : barClass(r.spent, r.budget, frac);
      return `<button class="row cat-row" data-act="filter" data-cat="${esc(r.name)}">
        <span class="dot" style="background:${r.color}"></span>
        <div class="main">
          <div class="top"><span class="title">${esc(r.name)}</span><span class="num ${rem < 0 && r.budget ? 'over' : ''}">${r.budget ? (rem < 0 ? money(-rem, false) + ' over' : money(rem, false) + ' left') : money(r.spent, false)}</span></div>
          <div class="mini"><i class="${cls}" style="width:${w}%"></i></div>
          <div class="sub num">${r.budget ? `${money(r.spent, false)} of ${money(r.budget, false)}` : 'Tap to sort these'}</div>
        </div>
      </button>`;
    }).join('') + `</div>`;
    return html;
  }

  function txnRow(t) {
    const ex = isExcluded(t.cat) && t.cat !== 'Income';
    const sign = t.kind === 'income' ? '+' : '';
    const meta = [t.cat === UNCAT ? `<span class="chip need" style="margin-left:0">Needs category</span>` : esc(t.cat), t.acct ? esc(t.acct) : '', t.note ? esc(t.note) : ''].filter(Boolean).join(' · ');
    return `<button class="row" data-act="edit" data-id="${t.id}">
      <span class="dot" style="background:${t.cat === UNCAT ? 'var(--bad)' : colorOf(t.cat)}"></span>
      <div class="main"><div class="title">${esc(t.merchant)}</div><div class="meta">${meta}</div></div>
      <div class="amt num ${t.kind === 'income' ? 'in' : ''} ${ex ? 'muted' : ''}">${sign}${money(t.amount)}</div>
    </button>`;
  }

  function activity() {
    const q = ui.q.trim().toLowerCase();
    let list = S.txns.filter(t => t.date.startsWith(ui.month));
    if (ui.filter) list = list.filter(t => t.cat === ui.filter);
    if (q) list = list.filter(t => (t.merchant + ' ' + t.note + ' ' + t.cat + ' ' + t.amount).toLowerCase().includes(q));
    list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    let html = header() + `<div class="search"><input id="q" type="search" placeholder="Search" value="${esc(ui.q)}" autocomplete="off"></div>`;
    if (ui.filter) html += `<button class="filter-pill" data-act="clearfilter"><span class="dot" style="background:${ui.filter === UNCAT ? 'var(--bad)' : colorOf(ui.filter)}"></span>${esc(ui.filter)} <span style="color:var(--muted)">✕</span></button>`;
    if (!list.length) return html + `<div class="empty"><b>Nothing here</b>${S.txns.length ? 'No transactions match for this month.' : 'Tap Sync to pull in your Chase alerts.'}</div>`;

    const groups = {};
    for (const t of list) (groups[t.date] = groups[t.date] || []).push(t);
    for (const [day, ts] of Object.entries(groups)) {
      const tot = ts.reduce((a, t) => a + (isExcluded(t.cat) ? 0 : (t.kind === 'expense' ? t.amount : -t.amount)), 0);
      html += `<div class="day"><span>${dayLabel(day)}</span><span class="num">${tot ? money(tot) : ''}</span></div><div class="card">${ts.map(txnRow).join('')}</div>`;
    }
    return html;
  }

  function settings() {
    const spend = S.cats.filter(c => !isExcluded(c.name));
    const total = spend.reduce((a, c) => a + (+c.budget || 0), 0);
    const rulesN = Object.keys(S.rules).length;
    return `<header><h1 style="font-size:28px;margin:0;font-weight:700;letter-spacing:-.02em">Budgets</h1></header>
      <h2>Monthly budget</h2>
      <div class="card">
        ${spend.map(c => `<div class="budget-row">
          <button class="name" data-act="editcat" data-name="${esc(c.name)}"><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span></button>
          <span class="x">$</span><input class="num" inputmode="decimal" data-budget="${esc(c.name)}" value="${c.budget || ''}" placeholder="0">
        </div>`).join('')}
        <div class="total-row"><span>Total</span><span class="num" id="btotal">${money(total, false)}</span></div>
      </div>
      <button class="secondary" data-act="addcat">Add category</button>
      <p class="help">Transfers, Investing and Income are tracked but never count as spending. Fixing a transaction's category teaches the app${rulesN ? ` (${rulesN} merchant${rulesN === 1 ? '' : 's'} learned so far)` : ''}.</p>

      <h2>Import</h2>
      <div class="card">
        <button class="row" data-act="sync"><div class="main"><div class="title">Sync Chase texts</div><div class="meta">Pick budget-log.txt in iCloud Drive › Shortcuts</div></div></button>
        <button class="row" data-act="paste"><div class="main"><div class="title">Paste alert text</div><div class="meta">For one-off texts the Shortcut missed</div></div></button>
        <button class="row" data-act="sync"><div class="main"><div class="title">Import Chase CSV</div><div class="meta">Backfill history from chase.com › Download activity</div></div></button>
      </div>
      <p class="help">${S.lastSync ? 'Last sync ' + new Date(S.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '. ' : ''}Syncing the same file again is safe; entries already imported are skipped.</p>

      <h2>Backup</h2>
      <div class="card">
        <button class="row" data-act="export"><div class="main"><div class="title">Export backup</div><div class="meta">Save a .json copy to Files</div></div></button>
        <button class="row" data-act="sync"><div class="main"><div class="title">Restore backup</div><div class="meta">Pick a budget-backup .json file</div></div></button>
        <button class="row" data-act="wipe"><div class="main"><div class="title danger">Erase all data</div></div></button>
      </div>
      <p class="help">Everything stays on this phone. Deleting the home screen icon deletes the data, so export a backup now and then.</p>`;
  }

  function render() {
    const app = $('#app');
    app.innerHTML = ui.tab === 'overview' ? overview() : ui.tab === 'activity' ? activity() : settings();
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    $('#fab').classList.toggle('hidden', ui.tab === 'settings');
    const q = $('#q');
    if (q) q.addEventListener('input', e => { ui.q = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
    document.querySelectorAll('[data-budget]').forEach(inp => inp.addEventListener('input', e => {
      const c = catByName(e.target.dataset.budget); c.budget = Math.max(0, parseFloat(e.target.value) || 0); save();
      const tot = S.cats.filter(x => !isExcluded(x.name)).reduce((a, x) => a + (+x.budget || 0), 0);
      $('#btotal').textContent = money(tot, false);
    }));
  }

  // ---------- sheets ----------
  function openSheet(html) { $('#sheet').innerHTML = `<div class="grab"></div>` + html; $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
  $('#scrim').addEventListener('click', closeSheet);

  function editTxn(id) {
    const t = id ? S.txns.find(x => x.id === id) : { date: P.ymd(new Date()), amount: '', kind: 'expense', merchant: '', cat: UNCAT, note: '' };
    if (!t) return;
    let kind = t.kind, cat = t.cat;
    const cats = S.cats.map(c => c.name);
    openSheet(`
      <div class="sheet-head"><button class="link" data-x="cancel" style="font-weight:500">Cancel</button><h3>${id ? 'Transaction' : 'Add cash / manual'}</h3><button class="link" data-x="save">Save</button></div>
      <div class="seg" id="kind"><button data-k="expense">Spent</button><button data-k="income">Received</button></div>
      <div class="field"><input class="amount-input num" id="f-amt" inputmode="decimal" placeholder="$0.00" value="${t.amount !== '' ? t.amount.toFixed(2) : ''}"></div>
      <div class="field"><label>Merchant</label><input id="f-m" value="${esc(t.merchant)}" placeholder="Where"></div>
      <div class="field"><label>Category</label><div class="cats" id="f-cats">${cats.map(n => `<button data-c="${esc(n)}"><span class="dot" style="background:${colorOf(n)}"></span>${esc(n)}</button>`).join('')}</div></div>
      <label class="check" id="rule-wrap"><input type="checkbox" id="f-rule" checked><span id="rule-label"></span></label>
      <div class="field"><label>Date</label><input type="date" id="f-d" value="${t.date}"></div>
      <div class="field"><label>Note</label><input id="f-n" value="${esc(t.note)}" placeholder="Optional"></div>
      ${id ? `<div class="row-actions"><span class="meta" style="color:var(--muted);font-size:13px">From ${t.src === 'alert' ? 'Chase text' : t.src === 'csv' ? 'Chase CSV' : 'manual entry'}</span><button class="danger" data-x="delete">Delete</button></div>` : ''}
    `);
    const sh = $('#sheet');
    const paint = () => {
      sh.querySelectorAll('#kind button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
      sh.querySelectorAll('#f-cats button').forEach(b => b.classList.toggle('on', b.dataset.c === cat));
      const m = $('#f-m').value.trim();
      const show = m && cat !== UNCAT && P.merchantKey(m);
      $('#rule-wrap').classList.toggle('hidden', !show);
      if (show) $('#rule-label').textContent = `Always put “${P.merchantKey(m)}” in ${cat}`;
    };
    paint();
    $('#f-m').addEventListener('input', paint);
    sh.onclick = e => {
      const k = e.target.closest('[data-k]'); if (k) { kind = k.dataset.k; if (kind === 'income' && cat === UNCAT) cat = 'Income'; paint(); return; }
      const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; paint(); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'cancel') return closeSheet();
      if (x.dataset.x === 'delete') {
        if (!confirm('Delete this transaction?')) return;
        S.txns = S.txns.filter(y => y.id !== id); save(); closeSheet(); render(); return;
      }
      const amt = Math.round(parseFloat(String($('#f-amt').value).replace(/[$,]/g, '')) * 100) / 100;
      if (!(amt > 0)) { toast('Enter an amount'); return; }
      const merchant = $('#f-m').value.trim() || (kind === 'income' ? 'Income' : 'Cash');
      const rec = id ? t : { id: uid(), src: 'manual', acct: null };
      Object.assign(rec, { amount: amt, kind, merchant, cat, date: $('#f-d').value || P.ymd(new Date()), note: $('#f-n').value.trim() });
      if (!id) S.txns.push(rec);
      if ($('#f-rule').checked && !$('#rule-wrap').classList.contains('hidden')) {
        const key = P.merchantKey(merchant);
        S.rules[key] = cat;
        let n = 0;
        for (const y of S.txns) if (y !== rec && P.merchantKey(y.merchant) === key && y.cat !== cat) { y.cat = cat; n++; }
        if (n) toast(`Also moved ${n} other ${key} transaction${n === 1 ? '' : 's'}`);
      }
      save(); closeSheet(); render();
    };
  }

  function editCat(name) {
    const c = name ? catByName(name) : { name: '', budget: 0, color: PALETTE[S.cats.length % PALETTE.length] };
    openSheet(`
      <div class="sheet-head"><button class="link" data-x="cancel" style="font-weight:500">Cancel</button><h3>${name ? 'Category' : 'New category'}</h3><button class="link" data-x="save">Save</button></div>
      <div class="field"><label>Name</label><input id="c-name" value="${esc(c.name)}" placeholder="e.g. Haircuts"></div>
      <div class="field"><label>Monthly budget</label><input id="c-budget" class="num" inputmode="decimal" value="${c.budget || ''}" placeholder="0"></div>
      ${name ? `<div class="row-actions"><span></span><button class="danger" data-x="delete">Delete category</button></div>` : ''}`);
    $('#sheet').onclick = e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'cancel') return closeSheet();
      if (x.dataset.x === 'delete') {
        if (!confirm(`Delete ${name}? Its transactions become Uncategorized.`)) return;
        S.cats = S.cats.filter(y => y.name !== name);
        S.txns.forEach(t => { if (t.cat === name) t.cat = UNCAT; });
        for (const k in S.rules) if (S.rules[k] === name) delete S.rules[k];
        save(); closeSheet(); render(); return;
      }
      const nn = $('#c-name').value.trim();
      if (!nn) return toast('Give it a name');
      if (nn !== name && (catByName(nn) || nn === UNCAT)) return toast('That category already exists');
      const budget = Math.max(0, parseFloat($('#c-budget').value) || 0);
      if (name) {
        if (nn !== name) {
          S.txns.forEach(t => { if (t.cat === name) t.cat = nn; });
          for (const k in S.rules) if (S.rules[k] === name) S.rules[k] = nn;
        }
        c.name = nn; c.budget = budget;
      } else {
        const firstExcluded = S.cats.findIndex(y => isExcluded(y.name));
        S.cats.splice(firstExcluded < 0 ? S.cats.length : firstExcluded, 0, { name: nn, budget, color: c.color });
      }
      save(); closeSheet(); render();
    };
  }

  function pasteSheet() {
    openSheet(`
      <div class="sheet-head"><button class="link" data-x="cancel" style="font-weight:500">Cancel</button><h3>Paste alerts</h3><button class="link" data-x="add">Add</button></div>
      <div class="field"><textarea id="p-text" placeholder="Paste one or more Chase alert texts"></textarea></div>
      <p class="help">Long-press a Chase text in Messages, tap Copy, then paste here. Separate several with a blank line.</p>`);
    $('#sheet').onclick = e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'cancel') return closeSheet();
      const v = $('#p-text').value; closeSheet(); if (v.trim()) importText(v);
    };
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const nb = e.target.closest('nav button');
    if (nb) { ui.tab = nb.dataset.tab; if (ui.tab !== 'activity') ui.filter = null; render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest('#app [data-act]');
    if (!a) return;
    switch (a.dataset.act) {
      case 'prev': ui.month = shiftMonth(ui.month, -1); render(); break;
      case 'next': ui.month = shiftMonth(ui.month, 1); render(); break;
      case 'sync': pickFile(); break;
      case 'paste': pasteSheet(); break;
      case 'filter': ui.filter = a.dataset.cat; ui.tab = 'activity'; render(); window.scrollTo(0, 0); break;
      case 'clearfilter': ui.filter = null; render(); break;
      case 'edit': editTxn(a.dataset.id); break;
      case 'editcat': editCat(a.dataset.name); break;
      case 'addcat': editCat(null); break;
      case 'export': exportBackup(); break;
      case 'wipe':
        if (confirm('Erase every transaction, budget and rule on this phone?') && confirm('This cannot be undone. Erase?')) {
          localStorage.removeItem(KEY); S = load(); render(); toast('Erased');
        }
        break;
    }
  });
  $('#fab').addEventListener('click', () => editTxn(null));

  render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
})();
