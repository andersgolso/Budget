// Pure parsing + categorizing logic. No DOM. Works in browser (window.Parser) and Node (module.exports).
(function (root) {
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // Accepts ISO ("2026-10-25T11:15:00-05:00"), "Oct 25, 2026 at 11:15 AM", "10/25/2026".
  function parseDateLoose(s) {
    if (!s) return null;
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
    m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo == null) return null;
      let h = +(m[4] || 12);
      const ap = (m[6] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return new Date(+m[3], mo, +m[2], h, +(m[5] || 0));
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2], 12); }
    return null;
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Texts that mention money but are not a transaction.
  const SKIP = /declined|reply\s+(yes|no|y|n)\b|did you (make|use|attempt|try)|suspicious|unusual activity|verification|security code|one[- ]time|code is|balance (is|of|was)|available (balance|credit)|is due|due date|minimum payment|statement (is|balance)|scheduled|will be (sent|made|deducted)|pending approval|limit/i;

  function cleanMerchant(s) {
    return (s || '')
      .replace(/\s+/g, ' ')
      .replace(/^(the\s+)/i, '')
      .replace(/[.,;:\s]+$/, '')
      .trim();
  }

  // Parse one Chase alert. Returns {amount, kind, merchant, date?, acct?, hint?} or null.
  function parseAlert(text, fallbackDate) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || SKIP.test(t)) return null;
    const am = t.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
    if (!am) return null;
    const amount = Math.round(parseFloat(am[1].replace(/,/g, '')) * 100) / 100;
    if (!(amount > 0)) return null;

    let kind = 'expense', hint = null, merchant = '';
    const STOP = '(?=\\s+on\\s+(?:[A-Z][a-z]{2}|\\d|your|chase|card|account)|\\s+using\\s|\\s+at\\s+\\d|\\s+with\\s+your|\\s+from\\s+your|\\s+(?:was|were|is|has|have|exceeded|approved|posted|with\\s+zelle)\\b|\\s*\\(|\\.\\s|\\.$|,\\s|$)';

    if (/direct deposit|deposit of|deposited|you received|received \$|was added to/i.test(t)) {
      kind = 'income'; hint = 'Income';
      const m = t.match(new RegExp('(?:from)\\s+(.+?)' + STOP, 'i'));
      merchant = m ? m[1] : 'Deposit';
    } else if (/refund|return|reversal|credit of|credited|was credited/i.test(t)) {
      kind = 'income'; hint = 'refund';
      const m = t.match(new RegExp('(?:from|with|by)\\s+(.+?)' + STOP, 'i'));
      merchant = m ? m[1] : 'Refund';
    } else if (/you sent|zelle|sent \$/i.test(t)) {
      hint = 'Transfers';
      const m = t.match(new RegExp('\\bto\\s+(.+?)' + STOP, 'i'));
      merchant = 'Zelle: ' + (m ? cleanMerchant(m[1]) : 'payment');
    } else if (/payment (of|to)|autopay|thank you for your payment|transfer/i.test(t)) {
      hint = 'Transfers';
      const m = t.match(new RegExp('\\bto\\s+(.+?)' + STOP, 'i'));
      merchant = m ? m[1] : 'Payment / transfer';
    } else {
      let m = t.match(new RegExp('transaction(?: of \\$[\\d,.]+)?\\s+(?:with|at)\\s+(.+?)' + STOP, 'i'))
        || t.match(new RegExp('\\$[\\d,.]+\\s+(?:transaction|purchase|charge|debit card transaction)?\\s*(?:with|at|to)\\s+(.+?)' + STOP, 'i'))
        || t.match(new RegExp('\\b(?:with|at)\\s+(.+?)' + STOP, 'i'));
      merchant = m ? m[1] : 'Chase purchase';
    }

    let date = null;
    const dm = t.match(/\bon\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}\s*[AP]M)?)/)
      || t.match(/\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dm) date = parseDateLoose(dm[1]);
    if (!date) date = fallbackDate || null;

    let acct = null;
    const ac = t.match(/(?:card|account)\s+ending\s+(?:in\s+)?(\d{4})/i);
    if (ac) acct = '…' + ac[1];
    else {
      const pre = t.match(/^(Chase [A-Za-z ]{2,30}?):/);
      if (pre) acct = pre[1];
    }

    return { amount, kind, merchant: cleanMerchant(merchant) || 'Chase', date, acct, hint };
  }

  // The Shortcut appends entries like "@@2026-10-25T11:15:00-05:00|<message text>".
  // Messages can span lines, so "@@" marks the start of each entry.
  function splitLog(text) {
    const s = String(text || '').replace(/\r\n?/g, '\n');
    let parts;
    if (s.includes('@@')) parts = s.split('@@');
    else parts = s.split(/\n\s*\n|\n(?=Chase|You |Your )/);
    return parts.map(p => p.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('|');
      let when = null, body = p;
      if (i > 0 && i < 60) {
        const d = parseDateLoose(p.slice(0, i));
        if (d) { when = d; body = p.slice(i + 1).trim(); }
      }
      return { raw: p, when, body };
    });
  }

  // ---- Chase CSV exports ----
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }

  function isChaseCSV(text) {
    const head = String(text || '').replace(/^﻿/, '').slice(0, 200).toLowerCase();
    return head.startsWith('transaction date,') || head.startsWith('details,posting date') || head.startsWith('posting date,');
  }

  function parseChaseCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const h = rows[0].map(x => x.trim().toLowerCase());
    const col = name => h.indexOf(name);
    const iDate = col('transaction date') >= 0 ? col('transaction date') : col('posting date');
    const iDesc = col('description'), iAmt = col('amount'), iType = col('type');
    const out = [];
    for (const r of rows.slice(1)) {
      const d = parseDateLoose(r[iDate]); const amt = parseFloat(String(r[iAmt] || '').replace(/[$,]/g, ''));
      if (!d || !isFinite(amt) || amt === 0) continue;
      const desc = cleanMerchant(r[iDesc]);
      const type = (r[iType] || '').toLowerCase();
      let kind = amt < 0 ? 'expense' : 'income', hint = null;
      if (/payment|acct_xfer|transfer|loan_pmt/.test(type) || /payment thank you|autopay|online transfer|zelle|chase credit crd/i.test(desc)) hint = 'Transfers';
      else if (kind === 'income') hint = /payroll|direct dep|dir dep|salary/i.test(desc) ? 'Income' : 'refund';
      out.push({ amount: Math.abs(Math.round(amt * 100) / 100), kind, merchant: desc, date: d, acct: null, hint, raw: r.join('|') });
    }
    return out;
  }

  // ---- Categorizing ----
  function merchantKey(m) {
    return String(m || '').toUpperCase()
      .replace(/^(SQ|TST|SP|PY|DD|PP)\s?\*\s?/, '')
      .replace(/[#*]/g, ' ')
      .replace(/\b\d[\d-]*\b/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').slice(0, 3).join(' ');
  }

  // Ordered: specific before generic (AMAZON PRIME before AMAZON, UBER EATS before UBER).
  const DEFAULT_RULES = [
    ['Subscriptions', /NETFLIX|SPOTIFY|HULU|DISNEY ?PLUS|DISNEY\+|YOUTUBE|APPLE\.COM\/BILL|APPLE COM BILL|ICLOUD|AMAZON PRIME|PRIME VIDEO|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|PEACOCK|PARAMOUNT|MAX\.COM|AUDIBLE|PATREON/],
    ['Dining', /UBER ?\*? ?EATS|DOORDASH|GRUBHUB|WAITR|STARBUCKS|MCDONALD|CHICK-?FIL-?A|CANE'?S|TACO BELL|CHIPOTLE|WENDY|SONIC|POPEYES|DOMINO|PIZZA|CAFE|COFFEE|WAFFLE|SUBWAY|JIMMY JOHN|BURGER|GRILL|KITCHEN|TAQUERIA|SUSHI|DUNKIN|CRAWFISH|PO-?BOY|RESTAURANT|BAKERY|CHILI'?S|APPLEBEE|WINGSTOP|ZAXBY|WHATABURGER|SMOOTHIE|JUICE|TST\b/],
    ['Gas', /SHELL|EXXON|MOBIL|CHEVRON|VALERO|RACETRAC|RACEWAY|MURPHY|CIRCLE K|BUC-?EE|MARATHON|TEXACO|CITGO|SPEEDWAY|WAWA|QUIKTRIP|\bQT\b|SUNOCO|CONOCO|PHILLIPS 66|\bBP\b|FUEL|GAS STATION/],
    ['Groceries', /WALMART|WAL-MART|WM SUPERCENTER|KROGER|ROUSES|WHOLE ?FOODS|WHOLEFDS|TRADER JOE|ALDI|PUBLIX|H-?E-?B|ALBERTSONS|COSTCO|SAM'?S ?CLUB|WINN-?DIXIE|SPROUTS|MARKET|GROCERY|INSTACART/],
    ['Transport', /\bUBER\b|LYFT|PARKING|PARKMOBILE|PARK ?WHIZ|TOLL|GEAUXPASS|DELTA AIR|UNITED AIR|SOUTHWEST|AMERICAN AIR|SPIRIT AIR|FRONTIER|JETBLUE|AMTRAK|CAR WASH|AUTOZONE|O'?REILLY|JIFFY|TIRE/],
    ['Bills', /ENTERGY|DEMCO|CLECO|COX COMM|AT&T|ATT\b|VERIZON|T-MOBILE|TMOBILE|XFINITY|COMCAST|GEICO|STATE FARM|PROGRESSIVE|ALLSTATE|INSURANCE|RENT|APARTMENT|PROPERTY|WATER|ELECTRIC|UTILITY|TUITION|LSU BURSAR/],
    ['Investing', /FIDELITY|COINBASE|ROBINHOOD|SCHWAB|VANGUARD|STRIKE|RIVER FINANCIAL|CASH APP.*BITCOIN|SWAN BITCOIN/],
    ['Transfers', /ZELLE|VENMO|CASH ?APP|PAYPAL TRANSFER|PAYMENT THANK YOU|AUTOPAY|ONLINE TRANSFER|CHASE CREDIT CRD|EPAY/],
    ['Fun', /TICKETMASTER|SEATGEEK|STUBHUB|EVENTBRITE|AMC|CINEMA|THEATRE|THEATER|BOWL|GOLF|STEAM|PLAYSTATION|XBOX|NINTENDO|BAR\b|PUB\b|TAVERN|LOUNGE|BREWING|LIQUOR|SPIRITS/],
    ['Shopping', /AMAZON|AMZN|TARGET|BEST ?BUY|APPLE STORE|APPLE\.COM|HOME DEPOT|LOWE'?S|ACADEMY|NIKE|ETSY|EBAY|WALGREENS|CVS|ULTA|TJ ?MAXX|MARSHALLS|ROSS|OLD NAVY|GAP|H&M|ZARA|SHEIN|TEMU|BARNES|DOLLAR/],
  ];

  function categorize(p, rules) {
    if (p.hint === 'Transfers') return 'Transfers';
    if (p.hint === 'Income') return 'Income';
    const key = merchantKey(p.merchant);
    if (rules && rules[key]) return rules[key];
    const up = String(p.merchant || '').toUpperCase();
    for (const [cat, re] of DEFAULT_RULES) if (re.test(up)) return cat;
    if (p.kind === 'income' && p.hint !== 'refund') return 'Income';
    return 'Uncategorized';
  }

  const api = { parseAlert, splitLog, parseChaseCSV, isChaseCSV, parseCSV, parseDateLoose, categorize, merchantKey, hash, ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(this);
