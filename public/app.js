/* Money Book – offline-first finance tracker that syncs to Google Sheets. */
'use strict';

// ======================================================================
// Constants & defaults
// ======================================================================
const STORE_KEY = 'moneybook.v1';
const TABLES = ['Accounts', 'Ledger', 'Dues', 'Purchases', 'Namaz', 'Profile', 'Books'];
const PROFILE_ID = 'profile';
const DEFAULT_ACCOUNTS = ['Cash', 'EBL', 'NRB', 'Bkash', 'Nagad', 'DBBL'];

const TYPES = {
  expense:  { icon: '−', sign: -1, hint: 'Money spent' },
  income:   { icon: '+', sign: +1, hint: 'Money earned' },
  transfer: { icon: '⇄', sign: 0,  hint: 'Between your accounts' },
  lend:     { icon: '↗', sign: -1, hint: 'Receivable out – you gave a loan' },
  collect:  { icon: '↙', sign: +1, hint: 'Receivable in – loan paid back to you' },
  borrow:   { icon: '↘', sign: +1, hint: 'Payable in – you took a loan' },
  repay:    { icon: '↖', sign: -1, hint: 'Payable out – you paid a loan back' },
};

const DEFAULT_EXPENSE = [
  'Meal', 'Grocery', 'Utility', 'Home', 'Living Cost', 'Guest', 'Gift', 'Day Out', 'Travel', 'Personal',
  'Transport', 'Medicine', 'Education', 'Investment', 'Courses', 'Appliance', 'Tools', 'Assets', 'Apparel',
  'Mobile & PC', 'Business Cost', 'Gadget', 'Payable', 'Savings', 'Gardening', 'Seasonal', 'Subscriptions',
  'Service Charge', 'Purchase', 'General',
];
const DEFAULT_INCOME = ['Freelancing', 'Salary', 'Tuition', 'Business', 'Gift', 'Electrical', 'Other'];

const PRAYERS = {
  fard: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
  extra: ['Tahajjud', 'Chasht', 'Qiyam', 'Hajat', 'Istighfar', 'Istikhara', 'Fatima', 'KunFayaKun', 'Qaza'],
};
const ALL_PRAYERS = [...PRAYERS.fard, ...PRAYERS.extra];

// Every user-facing name that can be renamed in Profile → Field names.
const DEFAULT_LABELS = {
  'app.title': 'Money Book',
  'tab.home': 'Home', 'tab.overview': 'Overview', 'tab.ledger': 'Ledger', 'tab.dues': 'Dues', 'tab.more': 'More',
  'type.expense': 'Expense', 'type.income': 'Income', 'type.transfer': 'Transfer', 'type.lend': 'Lend',
  'type.collect': 'Collect', 'type.borrow': 'Borrow', 'type.repay': 'Repay',
  'field.amount': 'Amount', 'field.account': 'Account', 'field.toAccount': 'To account', 'field.category': 'Category',
  'field.source': 'Income source', 'field.charge': 'Charge', 'cat.charge': 'Service Charge', 'field.person': 'Person', 'field.date': 'Date', 'field.note': 'Note',
  'due.receivable': 'Receivable', 'due.payable': 'Payable', 'due.name': 'Name', 'due.dueDate': 'Due by', 'due.doneDate': 'Settled on',
  'sec.purchases': 'Purchase log', 'pur.item': 'Item', 'pur.price': 'Price', 'pur.shop': 'Shop / source',
  'sec.namaz': 'Namaz tracker', 'nz.fard': 'Fard', 'nz.extra': 'Sunnah & dhikr',
  ...Object.fromEntries(ALL_PRAYERS.map(p => ['prayer.' + p, p])),
};
const LABEL_GROUPS = [
  ['App & tabs', ['app.title', 'tab.home', 'tab.ledger', 'tab.dues', 'tab.more']],
  ['Transaction types', Object.keys(TYPES).map(k => 'type.' + k)],
  ['Transaction fields', ['field.amount', 'field.account', 'field.toAccount', 'field.charge', 'cat.charge', 'field.category', 'field.source', 'field.person', 'field.date', 'field.note']],
  ['Dues', ['due.receivable', 'due.payable', 'due.name', 'due.dueDate', 'due.doneDate']],
  ['Purchases', ['sec.purchases', 'pur.item', 'pur.price', 'pur.shop']],
  ['Namaz', ['sec.namaz', 'nz.fard', 'nz.extra', ...ALL_PRAYERS.map(p => 'prayer.' + p)]],
];

// ======================================================================
// Storage
// ======================================================================
function emptyDb() {
  const db = { lastSync: '', settings: { url: '', token: '' }, dirty: {} };
  TABLES.forEach(t => { db[t] = {}; db.dirty[t] = {}; });
  return db;
}

let db = load();
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) {
      const base = emptyDb();
      TABLES.forEach(t => { base[t] = saved[t] || {}; base.dirty[t] = (saved.dirty || {})[t] || {}; });
      base.lastSync = saved.lastSync || '';
      base.fbUid = saved.fbUid || ''; base.fbSince = saved.fbSince || 0;
      base.settings = Object.assign(base.settings, saved.settings);
      return base;
    }
  } catch (e) { console.warn('Could not read local data', e); }
  const fresh = emptyDb();
  const old = '1970-01-01T00:00:00.000Z'; // placeholder defaults never overwrite real data from the sheet
  DEFAULT_ACCOUNTS.forEach(name => {
    const id = 'acc-' + name.toLowerCase();
    fresh.Accounts[id] = { id, name, opening: 0, updatedAt: old };
    fresh.dirty.Accounts[id] = true;
  });
  return fresh;
}
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { console.warn('Could not save', e); } }

const stamp = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const rows = table => Object.values(db[table]).filter(r => !r.deleted);
const pendingCount = () => TABLES.reduce((n, t) => n + Object.keys(db.dirty[t]).length, 0);

// Derived data is cached until anything changes.
let dataVer = 0;
const memoStore = {};
function memo(key, fn) {
  if (!memoStore[key] || memoStore[key].v !== dataVer) memoStore[key] = { v: dataVer, val: fn() };
  return memoStore[key].val;
}
function changed() { dataVer++; }

function upsert(table, rec, opts = {}) {
  rec.id = rec.id || uid();
  rec.updatedAt = stamp();
  db[table][rec.id] = rec;
  db.dirty[table][rec.id] = true;
  changed();
  if (!opts.batch) { persist(); render(); scheduleSync(); }
  return rec;
}
function softDelete(table, id) {
  const rec = db[table][id];
  if (rec) upsert(table, Object.assign({}, rec, { deleted: true }));
}

// ======================================================================
// Profile (custom names, categories, currency, books start date)
// ======================================================================
function profile() {
  return memo('profile', () => {
    const p = db.Profile[PROFILE_ID] && !db.Profile[PROFILE_ID].deleted ? db.Profile[PROFILE_ID] : {};
    return {
      name: p.name || '', currency: p.currency || '৳', startDate: p.startDate || '',
      labels: p.labels || {},
      incomeCats: p.incomeCats && p.incomeCats.length ? p.incomeCats : DEFAULT_INCOME,
      expenseCats: p.expenseCats && p.expenseCats.length ? p.expenseCats : DEFAULT_EXPENSE,
      budgets: p.budgets || {},
      theme: p.theme || localStorage.getItem('moneybook.theme') || 'purple',
      font: p.font || localStorage.getItem('moneybook.font') || 'inter',
      namazJamat: p.namazJamat || {
        Fajr: '05:15',
        Dhuhr: '13:15',
        Asr: '16:30',
        Maghrib: '17:45',
        Isha: '20:00'
      },
      namazAlarm: p.namazAlarm || {
        enabled: true,
        before: {
          Fajr: 15,
          Dhuhr: 15,
          Asr: 15,
          Maghrib: 10,
          Isha: 15
        }
      }
    };
  });
}
function saveProfile(patch, opts) {
  const cur = db.Profile[PROFILE_ID] || { id: PROFILE_ID };
  return upsert('Profile', Object.assign({}, cur, patch, { id: PROFILE_ID, deleted: false }), opts);
}
const L = k => profile().labels[k] || DEFAULT_LABELS[k] || k;
const typeLabel = k => L('type.' + k);

// ======================================================================
// Formatting & dates
// ======================================================================
const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const curSym = () => { const c = profile().currency; return /[A-Za-z.]$/.test(c) ? c + ' ' : c; };
const money = n => (n < 0 ? '-' : '') + curSym() + fmt.format(Math.abs(Math.round((Number(n) || 0) * 100) / 100));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const monthOf = s => String(s || '').slice(0, 7);
const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const monthShort = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); };
const dayLabel = s => new Date(s + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const weekday = s => new Date(s + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' });
const weekOfMonth = s => 'Week ' + Math.ceil(Number(String(s).slice(8, 10)) / 7);
const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? (a - b) / Math.abs(b) * 100 : (a ? Infinity : 0));
const sumBy = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

// ======================================================================
// Accounting
// ======================================================================
const accountNames = () => rows('Accounts').map(a => a.name);

/** Purchases count as expenses unless already in the ledger (same date + amount) or marked so. */
function purchaseInfo() {
  return memo('purchaseInfo', () => {
    const pool = {};
    rows('Ledger').filter(t => t.type === 'expense').forEach(t => {
      const k = t.date + '|' + Number(t.amount).toFixed(2); (pool[k] = pool[k] || []).push(t.id);
    });
    const out = {};
    rows('Purchases').sort((a, b) => String(a.date).localeCompare(b.date) || String(a.id).localeCompare(b.id)).forEach(p => {
      if (p.inLedger) { out[p.id] = { status: 'linked' }; return; }
      const list = pool[p.date + '|' + Number(p.price).toFixed(2)];
      out[p.id] = list && list.length ? { status: 'matched', ledgerId: list.shift() } : { status: 'counted' };
    });
    return out;
  });
}
const PURCHASE_STATUS = { counted: 'Counted as expense', matched: 'Already in ledger (auto-matched)', linked: 'Already in ledger' };

/** Ledger + purchases that are not yet in the ledger (as virtual expenses). */
function allTx() {
  return memo('allTx', () => {
    const info = purchaseInfo();
    const virt = rows('Purchases').filter(p => info[p.id]?.status === 'counted').map(p => ({
      id: 'pv-' + p.id, purchaseId: p.id, virtual: true, type: 'expense', date: p.date, amount: Number(p.price) || 0,
      category: p.category || 'Purchase', account: p.account || '', toAccount: '', note: p.name, updatedAt: p.updatedAt,
    }));
    // Charges/fees on any entry: an expense taken from the entry's main account.
    const charges = rows('Ledger').filter(t => Number(t.charge) > 0).map(t => ({
      id: 'ch-' + t.id, chargeOf: t.id, virtual: true, type: 'expense', date: t.date, amount: Number(t.charge),
      category: L('cat.charge'), account: t.account, toAccount: '',
      note: t.type === 'transfer' ? `${t.account} → ${t.toAccount}` : typeLabel(t.type) + (t.category ? ' · ' + t.category : ''), updatedAt: t.updatedAt,
    }));
    const pCharges = rows('Purchases').filter(p => info[p.id]?.status === 'counted' && Number(p.charge) > 0).map(p => ({
      id: 'pch-' + p.id, purchaseId: p.id, virtual: true, type: 'expense', date: p.date, amount: Number(p.charge),
      category: L('cat.charge'), account: p.account || '', toAccount: '', note: p.name, updatedAt: p.updatedAt,
    }));
    return rows('Ledger').concat(virt, charges, pCharges);
  });
}
const inBooks = t => !profile().startDate || String(t.date) >= profile().startDate;
function effects(t) {
  const a = Number(t.amount) || 0;
  if (t.type === 'transfer') return [[t.account, -a], [t.toAccount, a]];
  return t.account ? [[t.account, (TYPES[t.type]?.sign || 0) * a]] : [];
}

/** Balance per account counting entries dated before `endExclusive` (or all). */
function balancesAt(endExclusive) {
  const bal = {};
  rows('Accounts').forEach(a => { bal[a.name] = Number(a.opening) || 0; });
  allTx().forEach(t => {
    if (!inBooks(t) || (endExclusive && String(t.date) >= endExclusive)) return;
    effects(t).forEach(([a, d]) => { if (a) bal[a] = (bal[a] || 0) + d; });
  });
  return bal;
}

function accountStatement(ym) {
  const start = ym + '-01', end = shiftMonth(ym, 1) + '-01';
  const open = balancesAt(start), close = balancesAt(end);
  const flow = {};
  allTx().filter(t => monthOf(t.date) === ym && inBooks(t)).forEach(t => effects(t).forEach(([a, d]) => {
    if (!a) return; flow[a] = flow[a] || { in: 0, out: 0 };
    if (d > 0) flow[a].in += d; else flow[a].out -= d;
  }));
  const names = [...new Set([...Object.keys(open), ...Object.keys(close)])];
  return names.map(n => ({ name: n, opening: open[n] || 0, inflow: flow[n]?.in || 0, outflow: flow[n]?.out || 0, closing: close[n] || 0 }));
}

function monthStats(ym) {
  return memo('stats-' + ym, () => {
    const tx = allTx().filter(t => monthOf(t.date) === ym);
    const sum = type => sumBy(tx.filter(t => t.type === type), t => t.amount);
    const byCat = type => {
      const m = {};
      tx.filter(t => t.type === type).forEach(t => { const c = t.category || 'General'; m[c] = (m[c] || 0) + Number(t.amount || 0); });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const income = sum('income'), expense = sum('expense');
    const isCurrent = ym === monthOf(today());
    const elapsed = isCurrent ? new Date().getDate() : daysInMonth(ym);
    const daily = expense / elapsed;
    return {
      income, expense, net: income - expense, transfer: sum('transfer'),
      lent: sum('lend'), collected: sum('collect'), borrowed: sum('borrow'), repaid: sum('repay'),
      purchases: sumBy(tx.filter(t => t.virtual), t => t.amount),
      daily, forecast: daily * daysInMonth(ym),
      expenseByCat: byCat('expense'), incomeByCat: byCat('income'), count: tx.length,
    };
  });
}

// ---------- Receivable / payable model, linked to the ledger ----------
// A due can be started by a Lend/Borrow ledger entry (originTxId) and is paid down by any ledger
// entry that points to it with dueId (Collect/Income for receivables, Repay/Expense for payables).
const SETTLE_KIND = { income: 'receivable', collect: 'receivable', expense: 'payable', repay: 'payable' };
const LOAN_KIND = { lend: 'receivable', borrow: 'payable' };
const STATUS_LABEL = { due: 'Due', partial: 'Partial', done: 'Done', overdue: 'Overdue' };

function dueInfo() {
  return memo('dueInfo', () => {
    const pays = {};
    rows('Ledger').forEach(t => {
      const d = t.dueId && db.Dues[t.dueId];
      if (d && !d.deleted && t.id !== d.originTxId) (pays[t.dueId] = pays[t.dueId] || []).push(t);
    });
    const out = {};
    rows('Dues').forEach(d => {
      const list = (pays[d.id] || []).sort((a, b) => String(a.date).localeCompare(b.date));
      const amount = Number(d.amount) || 0, paid = sumBy(list, t => t.amount);
      const done = !!d.doneDate || (amount > 0 && paid >= amount - 0.005);
      const status = done ? 'done' : paid > 0 ? 'partial' : 'due';
      const overdue = !done && !!d.dueDate && d.dueDate < today();
      out[d.id] = {
        status, overdue, show: overdue ? 'overdue' : status, paid, payments: list.length,
        settled: done ? amount : paid, remaining: done ? 0 : Math.max(0, amount - paid),
        settledOn: d.doneDate || (done && list.length ? list[list.length - 1].date : ''),
      };
    });
    return out;
  });
}

function dueTotals(kind) {
  const list = rows('Dues').filter(d => d.kind === kind), info = dueInfo();
  return {
    total: sumBy(list, d => d.amount), done: sumBy(list, d => info[d.id].settled), due: sumBy(list, d => info[d.id].remaining),
    open: list.filter(d => info[d.id].status !== 'done').length, overdue: list.filter(d => info[d.id].overdue).length,
  };
}

function commit() { persist(); render(); scheduleSync(); }

/** Plan for bringing older, unlinked loan entries into Dues (Lend/Borrow → new due; Collect/Repay → matched by person). */
function planLoanSync() {
  return memo('loanPlan', () => {
    const norm = s => String(s || '').trim().toLowerCase();
    const same = (a, b) => a && b && (a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))));
    const info = dueInfo();
    const pool = rows('Dues').map(d => ({ id: d.id, kind: d.kind, name: norm(d.name), date: d.date || '', left: info[d.id].remaining }));
    const free = rows('Ledger').filter(t => !t.dueId).sort((a, b) => String(a.date).localeCompare(b.date));
    const create = free.filter(t => LOAN_KIND[t.type]);
    create.forEach(t => pool.push({ id: 'due-' + t.id, kind: LOAN_KIND[t.type], name: norm(t.category || t.note), date: t.date, left: Number(t.amount) || 0 }));
    const link = [];
    free.filter(t => t.type === 'collect' || t.type === 'repay').forEach(t => {
      const who = norm(t.category || t.note); if (!who) return;
      const kind = SETTLE_KIND[t.type];
      const c = pool.filter(d => d.kind === kind && same(d.name, who) && d.left > 0.005).sort((a, b) => String(a.date).localeCompare(b.date));
      if (!c.length) return;
      const amt = Number(t.amount) || 0, pick = c.find(d => d.left >= amt - 0.005) || c[0]; // oldest one it fits into
      pick.left -= amt;
      link.push([t.id, pick.id]);
    });
    return { create, link, total: create.length + link.length };
  });
}
function applyLoanSync() {
  const plan = planLoanSync();
  plan.create.forEach(t => {
    const id = 'due-' + t.id, name = (t.category || t.note || 'Unnamed').trim();
    upsert('Dues', { id, kind: LOAN_KIND[t.type], name, amount: Number(t.amount) || 0, date: t.date, dueDate: '', doneDate: '', note: t.note || '', origin: 'loan', originTxId: t.id, deleted: false }, { batch: true });
    upsert('Ledger', Object.assign({}, t, { dueId: id }), { batch: true });
  });
  plan.link.forEach(([txId, dueId]) => upsert('Ledger', Object.assign({}, db.Ledger[txId], { dueId }), { batch: true }));
  commit();
  toast(`Created ${plan.create.length} dues · linked ${plan.link.length} payments`);
}
function loanSyncBanner() {
  const plan = planLoanSync();
  if (!plan.total) return '';
  return `<div class="card banner"><b>🔗 ${plan.total} ${esc(L('tab.ledger'))} entries are not linked to ${esc(L('tab.dues'))} yet</b>
    <p class="small muted">${plan.create.length} ${esc(typeLabel('lend'))}/${esc(typeLabel('borrow'))} entries will become ${esc(L('due.receivable').toLowerCase())}s/${esc(L('due.payable').toLowerCase())}s, and ${plan.link.length} ${esc(typeLabel('collect'))}/${esc(typeLabel('repay'))} entries will be matched to them by person name.</p>
    <div class="actions"><button type="button" class="btn" data-action="loan-sync">Link them now</button></div></div>`;
}

/** When a Lend/Borrow entry stops being the start of a due: keep the due if it has payments, else remove it. */
function detachOrigin(due) {
  if (dueInfo()[due.id]?.paid > 0) upsert('Dues', Object.assign({}, due, { originTxId: '' }), { batch: true });
  else upsert('Dues', Object.assign({}, due, { deleted: true }), { batch: true });
}
function deleteTx(tx) {
  const d = tx.dueId && db.Dues[tx.dueId];
  upsert('Ledger', Object.assign({}, tx, { deleted: true }), { batch: true });
  if (d && !d.deleted && d.originTxId === tx.id) detachOrigin(d);
  if (tx.purchaseId && db.Purchases[tx.purchaseId]) upsert('Purchases', Object.assign({}, db.Purchases[tx.purchaseId], { deleted: true }), { batch: true });
  commit();
}
function deleteDue(d) {
  // Ledger entries are real money movements, so they stay – they are only unlinked.
  rows('Ledger').filter(t => t.dueId === d.id).forEach(t => upsert('Ledger', Object.assign({}, t, { dueId: '' }), { batch: true }));
  upsert('Dues', Object.assign({}, d, { deleted: true }), { batch: true });
  commit();
}

// ======================================================================
// Sync with Google Sheets (Apps Script web app)
// ======================================================================
let syncing = false, syncTimer = null, lastError = '';
function scheduleSync(delay = 1500) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, delay); updateSyncPill(); }

function normalize(table, r) {
  let o = Object.assign({}, r);
  if (table === 'Profile') {
    let extra = {};
    try { extra = typeof o.data === 'string' && o.data ? JSON.parse(o.data) : (o.data || {}); } catch { extra = {}; }
    o = Object.assign(extra, { id: o.id, updatedAt: o.updatedAt, deleted: o.deleted });
  }
  o.deleted = o.deleted === true || String(o.deleted).toLowerCase() === 'true';
  ['amount', 'opening', 'price', 'charge'].forEach(k => { if (k in o && o[k] !== '') o[k] = Number(o[k]); });
  if (table === 'Namaz') ALL_PRAYERS.forEach(p => { o[p] = o[p] === true || String(o[p]).toLowerCase() === 'true'; });
  if (table === 'Purchases') o.inLedger = o.inLedger === true || String(o.inLedger).toLowerCase() === 'true';
  ['note', 'category', 'toAccount', 'dueDate', 'doneDate', 'source', 'account', 'dueId', 'origin', 'originTxId'].forEach(k => { if (k in o && o[k] == null) o[k] = ''; });
  delete o.syncedAt; delete o.data;
  return o;
}
function toWire(table, r) {
  if (table !== 'Profile') return r;
  const { id, updatedAt, deleted, ...rest } = r;
  return { id, updatedAt, deleted: !!deleted, data: JSON.stringify(rest) };
}

// ---------- Google Workspace & Google Sheets Sync Integration ----------
let googleSyncState = {
  isSignedIn: false,
  user: null,
  spreadsheet: null,
  lastSync: null,
  hasToken: false,
};

function initGoogleSheetsIntegration() {
  if (window.GoogleSync?.init) {
    window.GoogleSync.init(st => {
      googleSyncState = st;
      updateSyncPill();
      if (ui.tab === 'more' && (ui.sub === 'settings' || !ui.sub)) render();
    });
  } else {
    setTimeout(initGoogleSheetsIntegration, 200);
  }
}
window.addEventListener('DOMContentLoaded', initGoogleSheetsIntegration);
setTimeout(initGoogleSheetsIntegration, 300);

async function syncGoogleSheet(showConfirm = false) {
  if (!window.GoogleSync) {
    toast('Google Sheets sync is loading, please wait...');
    return;
  }
  if (!googleSyncState.isSignedIn || !googleSyncState.hasToken) {
    location.hash = 'more/settings';
    return;
  }

  const doSync = async () => {
    syncing = true;
    lastError = '';
    updateSyncPill();
    try {
      const res = await window.GoogleSync.sync(db);
      TABLES.forEach(t => {
        db.dirty[t] = {};
      });
      db.lastSync = res.syncedAt;
      persist();
      toast('✓ Synced with Google Sheet!');
      render();
    } catch (e) {
      lastError = e?.message || String(e);
      toast('Sync failed: ' + lastError);
      console.warn('Google Sheets sync error:', e);
    } finally {
      syncing = false;
      updateSyncPill();
    }
  };

  if (showConfirm) {
    const sheetName = googleSyncState.spreadsheet?.name || 'Personal Money Book & Ledger';
    askConfirm(`Sync all transactions and records to your Google Sheet "${sheetName}"?`, doSync, 'Sync Now');
  } else {
    await doSync();
  }
}

async function sync() {
  if (window.GoogleSync && googleSyncState.isSignedIn && googleSyncState.hasToken) {
    return syncGoogleSheet(false);
  }
  const { url, token } = db.settings;
  if (syncing || !url || !navigator.onLine) { updateSyncPill(); return; }
  syncing = true; lastError = ''; updateSyncPill();
  const changes = {}, sent = {};
  TABLES.forEach(t => {
    const list = Object.keys(db.dirty[t]).map(id => db[t][id]).filter(Boolean);
    changes[t] = list.map(r => toWire(t, r));
    sent[t] = Object.fromEntries(list.map(r => [r.id, r.updatedAt]));
  });
  try {
    // text/plain body avoids a CORS preflight, which Apps Script cannot answer.
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, since: db.lastSync, changes }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Sync failed');
    TABLES.forEach(t => {
      Object.entries(sent[t]).forEach(([id, ver]) => { if (db[t][id]?.updatedAt === ver) delete db.dirty[t][id]; });
      (data.rows?.[t] || []).forEach(raw => {
        const r = normalize(t, raw), local = db[t][r.id];
        if (!local || String(r.updatedAt) >= String(local.updatedAt)) { db[t][r.id] = r; delete db.dirty[t][r.id]; }
      });
    });
    db.lastSync = data.serverTime;
    changed(); persist(); render();
  } catch (e) {
    lastError = e.message || String(e);
    console.warn('Sync error', e);
  } finally {
    syncing = false; updateSyncPill();
  }
}

function updateSyncPill() {
  const pill = $('#syncPill'), text = $('#syncText'), pending = pendingCount();
  if (!pill || !text) return;
  pill.className = 'pill';
  if (syncing) { pill.classList.add('busy'); text.textContent = 'Syncing…'; return; }
  if (!navigator.onLine) { pill.classList.add('pending'); text.textContent = `Offline · ${pending}`; return; }

  if (window.GoogleSync) {
    if (!googleSyncState.isSignedIn) {
      pill.classList.add('pending');
      text.textContent = 'Login with Google';
      return;
    }
    if (!googleSyncState.hasToken) {
      pill.classList.add('pending');
      text.textContent = 'Connect Sheet';
      return;
    }
  } else if (!db.settings.url) {
    text.textContent = 'Local only';
    return;
  }

  if (lastError) { pill.classList.add('err'); text.textContent = 'Sync error'; return; }
  if (pending) { pill.classList.add('pending'); text.textContent = `${pending} pending`; return; }
  pill.classList.add('ok'); text.textContent = 'Synced (Sheet)';
}
window.addEventListener('online', () => { toast('Back online – syncing'); sync(); });
window.addEventListener('offline', updateSyncPill);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden) sync(); }, 60000);

// ======================================================================
// UI helpers
// ======================================================================
const $ = s => document.querySelector(s);
const view = $('#view');
const ui = {
  tab: 'home', sub: '', month: monthOf(today()), filter: 'all', account: '', q: '', dueKind: 'receivable',
  namazDate: today(), pAll: false, day: '', cat: '', calOpen: false, mode: {}, pivot: {}, importPreview: null, importLog: '',
};

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}
function monthBar(extra = '') {
  return `<div class="monthbar"><button type="button" data-month="-1" aria-label="Previous month">‹</button>
    <strong>${monthLabel(ui.month)}${extra}</strong><button type="button" data-month="1" aria-label="Next month">›</button></div>`;
}
function modeSwitch(sec, labels = ['List', 'Statement', 'Pivot']) {
  const cur = ui.mode[sec] || 'list';
  return `<div class="seg modes" role="group" aria-label="View">${['list', 'statement', 'pivot'].map((m, i) =>
    `<button type="button" data-mode="${sec}:${m}" aria-pressed="${cur === m}">${labels[i]}</button>`).join('')}</div>`;
}
function bars(entries) {
  if (!entries.length) return '<div class="empty small">Nothing recorded</div>';
  const max = entries[0][1] || 1, total = entries.reduce((s, e) => s + e[1], 0) || 1;
  return entries.map(([k, v]) => `<div class="bar" data-tip="${esc(k)}: ${esc(money(v))}" tabindex="0"><div class="label"><span>${esc(k)}</span>
    <span>${money(v)} <span class="muted small">${Math.round(v / total * 100)}%</span></span></div>
    <div class="track"><div class="fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div></div>`).join('');
}
function table(head, body, foot, cls = '') {
  return `<div class="tablewrap"><table class="tbl ${cls}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${body.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="muted">Nothing recorded</td></tr>`}</tbody>
    ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
}
function delta(cur, prev, goodWhenUp = true) {
  if (!cur && !prev) return '<span class="muted small">no change</span>';
  const p = pct(cur, prev);
  if (!isFinite(p)) return '<span class="muted small">new this month</span>';
  const up = cur > prev, good = up === goodWhenUp;
  if (Math.abs(p) < 0.5) return '<span class="muted small">≈ same</span>';
  return `<span class="small ${good ? 'in' : 'out'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% (${up ? '+' : '−'}${money(Math.abs(cur - prev))})</span>`;
}

function txLine(t) {
  const ty = TYPES[t.type] || TYPES.expense;
  const title = t.type === 'transfer' ? `${t.account} → ${t.toAccount}` : (t.category || typeLabel(t.type));
  const due = t.dueId && db.Dues[t.dueId] && !db.Dues[t.dueId].deleted ? db.Dues[t.dueId] : null;
  const sub = [
    t.chargeOf ? L('field.charge') + ' · ' + (t.account || '') : t.virtual ? L('sec.purchases') + (t.account ? ' · ' + t.account : '') : t.type === 'transfer' ? typeLabel('transfer') : `${typeLabel(t.type)}${t.account ? ' · ' + t.account : ''}`,
    !t.virtual && Number(t.charge) > 0 ? `+ ${L('field.charge').toLowerCase()} ${money(t.charge)}` : '',
    due ? '🔗 ' + due.name : '', t.note,
  ].filter(Boolean).join(' · ');
  const cls = ty.sign > 0 ? 'in' : ty.sign < 0 ? 'out' : '';
  const sign = ty.sign > 0 ? '+' : ty.sign < 0 ? '−' : '';
  const attr = t.chargeOf ? `data-edit="${esc(t.chargeOf)}"` : t.virtual ? `data-purchase-edit="${esc(t.purchaseId)}"` : `data-edit="${esc(t.id)}"`;
  return `<li ${attr}>${iconTile(t)}
    <div class="main"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>
    <div class="amt ${cls}">${sign}${money(Number(t.amount))}</div></li>`;
}

// Category icons and stable colours (top 7 expense categories by all-time spend keep their colour everywhere).
const CAT_ICON = {
  Meal: '🍽️', Grocery: '🛒', Utility: '💡', Home: '🏠', 'Living Cost': '🧺', Guest: '👥', Gift: '🎁', 'Day Out': '🎬', Travel: '✈️',
  Personal: '💇', Transport: '🚌', Medicine: '💊', Education: '🎓', Investment: '📈', Courses: '📚', Appliance: '🔌', Tools: '🔧',
  Assets: '🛋️', Apparel: '👕', 'Mobile & PC': '💻', 'Business Cost': '💼', Gadget: '🎧', Payable: '📄', Savings: '🏦', Gardening: '🌱',
  Seasonal: '🎉', Subscriptions: '🔁', Purchase: '🛍️', General: '🧾', Freelancing: '💻', Salary: '💼', Tuition: '📖', Business: '🏪',
  Electrical: '⚡', Other: '✨',
};
const TYPE_ICON = { expense: '💸', income: '💰', transfer: '⇄', lend: '↗', collect: '↙', borrow: '↘', repay: '↖' };
function catColorMap() {
  return memo('catColors', () => {
    const tot = {};
    allTx().filter(t => t.type === 'expense').forEach(t => { const c = t.category || 'General'; tot[c] = (tot[c] || 0) + (Number(t.amount) || 0); });
    return Object.fromEntries(Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([c], i) => [c, i + 1]));
  });
}
function iconTile(t) {
  const isCharge = t.chargeOf || (t.virtual && t.category === L('cat.charge'));
  const slot = t.type === 'expense' ? catColorMap()[t.category || 'General'] : null;
  const glyph = isCharge ? '%' : t.virtual && t.purchaseId ? '🛍️' : (t.type === 'expense' || t.type === 'income') ? (CAT_ICON[t.category] || TYPE_ICON[t.type]) : TYPE_ICON[t.type];
  const cls = slot ? 'c' + slot : ['income', 'collect', 'borrow'].includes(t.type) ? 't-in' : t.type === 'transfer' ? 't-tr' : t.type === 'expense' ? 'c-other' : 't-loan';
  return `<div class="ico ${cls}" aria-hidden="true">${glyph}</div>`;
}
/** Donut + legend for expense categories (top-7 colours, rest folded into "Other"). */
function donut(entries) {
  if (!entries.length) return '<div class="empty small">Nothing spent this month</div>';
  const map = catColorMap(), segs = [];
  let other = 0;
  entries.forEach(([k, v]) => { if (map[k]) segs.push([k, v, 'var(--c' + map[k] + ')']); else other += v; });
  if (other) segs.push(['Other', other, 'var(--c-other)']);
  const total = segs.reduce((s, x) => s + x[1], 0) || 1, R = 46, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = segs.map(([k, v, col]) => {
    const len = v / total * C, gap = segs.length > 1 ? Math.min(2, len / 3) : 0;
    const el = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${col}" stroke-width="20" stroke-dasharray="${(len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" tabindex="0" data-tip="${esc(k)}: ${esc(money(v))} (${Math.round(v / total * 100)}%)"></circle>`;
    off += len; return el;
  }).join('');
  return `<div class="donut-wrap">
    <ul class="legend-list">${segs.map(([k, v, col]) => `<li><i style="background:${col}"></i><span class="lk">${esc(k)}</span><span class="lv">${money(v)}</span><span class="lp">${Math.round(v / total * 100)}%</span></li>`).join('')}</ul>
    <div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="Spending by category"><g transform="rotate(-90 60 60)">${arcs}</g></svg>
      <div class="donut-c"><b>${money(total)}</b><small>spent</small></div></div></div>`;
}
const relDay = d => d === today() ? 'Today' : d === isoDate(new Date(Date.now() - 864e5)) ? 'Yesterday' : dayLabel(d);

// ======================================================================
// Pivot tables (one engine, configured per section)
// ======================================================================
const AGGS = {
  sum: { label: 'Sum', fn: v => v.reduce((a, b) => a + b, 0) },
  count: { label: 'Count', fn: v => v.length },
  avg: { label: 'Average', fn: v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 },
  min: { label: 'Min', fn: v => v.length ? Math.min(...v) : 0 },
  max: { label: 'Max', fn: v => v.length ? Math.max(...v) : 0 },
};
function namazRows(scope) {
  const out = [];
  const push = (date, rec) => ALL_PRAYERS.forEach(p => out.push({ date, prayer: p, group: PRAYERS.fard.includes(p) ? L('nz.fard') : L('nz.extra'), done: rec && !rec.deleted && rec[p] ? 1 : 0 }));
  if (scope === 'month') {
    const last = ui.month === monthOf(today()) ? new Date().getDate() : ui.month > monthOf(today()) ? 0 : daysInMonth(ui.month);
    for (let d = 1; d <= last; d++) { const date = `${ui.month}-${pad(d)}`; push(date, db.Namaz['nz-' + date]); }
  } else rows('Namaz').forEach(r => push(r.date, r));
  return out;
}
const PIVOTS = {
  ledger: {
    data: scope => allTx().filter(t => scope === 'all' || monthOf(t.date) === ui.month),
    dims: () => ({
      [L('field.category')]: t => t.category || (t.type === 'transfer' ? '(transfer)' : '—'),
      'Type': t => typeLabel(t.type), [L('field.account')]: t => t.account || '—', [L('field.toAccount')]: t => t.toAccount || '—',
      'Month': t => monthOf(t.date), [L('field.date')]: t => t.date, 'Week': t => weekOfMonth(t.date), 'Weekday': t => weekday(t.date),
      'Entry from': t => t.chargeOf ? typeLabel('transfer') + ' ' + L('field.charge').toLowerCase() : t.virtual ? L('sec.purchases') : L('tab.ledger'),
    }),
    measures: () => ({ [L('field.amount')]: t => Number(t.amount) || 0 }),
    defaults: () => ({ rows: L('field.category'), cols: 'Type', agg: 'sum' }),
  },
  dues: {
    data: () => rows('Dues'),
    dims: () => ({
      [L('due.name')]: d => d.name, 'Kind': d => L('due.' + d.kind), 'Status': d => STATUS_LABEL[dueInfo()[d.id].show],
      'Started month': d => d.date ? monthOf(d.date) : '—', 'Settled month': d => dueInfo()[d.id].settledOn ? monthOf(dueInfo()[d.id].settledOn) : '—',
      'Due month': d => d.dueDate ? monthOf(d.dueDate) : '—', 'Linked to ledger': d => d.originTxId || dueInfo()[d.id].payments ? 'Yes' : 'No',
    }),
    measures: () => ({ [L('field.amount')]: d => Number(d.amount) || 0, 'Paid': d => dueInfo()[d.id].settled, 'Remaining': d => dueInfo()[d.id].remaining }),
    defaults: () => ({ rows: L('due.name'), cols: 'Status', agg: 'sum' }),
    noScope: true,
  },
  purchases: {
    data: scope => rows('Purchases').filter(p => scope === 'all' || monthOf(p.date) === ui.month),
    dims: () => ({
      [L('field.category')]: p => p.category || 'Purchase', [L('pur.shop')]: p => p.source || '—', [L('field.account')]: p => p.account || '—',
      'Month': p => monthOf(p.date), 'Year': p => String(p.date).slice(0, 4), 'Expense status': p => PURCHASE_STATUS[purchaseInfo()[p.id]?.status] || '—',
      [L('pur.item')]: p => p.name,
    }),
    measures: () => ({ [L('pur.price')]: p => Number(p.price) || 0 }),
    defaults: () => ({ rows: L('field.category'), cols: 'Month', agg: 'sum' }),
  },
  namaz: {
    data: scope => namazRows(scope),
    dims: () => ({ 'Prayer': r => L('prayer.' + r.prayer), 'Group': r => r.group, 'Week': r => weekOfMonth(r.date), 'Weekday': r => weekday(r.date), [L('field.date')]: r => r.date, 'Month': r => monthOf(r.date) }),
    measures: () => ({ 'Prayed': r => r.done }),
    defaults: () => ({ rows: 'Prayer', cols: 'Week', agg: 'sum' }),
    pctAvg: true,
  },
};
const ORDERED_DIMS = ['Month', 'Year', 'Week', 'Weekday', 'Settled month', 'Due month', 'Started month'];
const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function pivotData(sec) {
  const cfg = PIVOTS[sec], dims = cfg.dims(), measures = cfg.measures();
  const st = ui.pivot[sec] = Object.assign({ scope: 'month' }, cfg.defaults(), ui.pivot[sec] || {});
  if (!dims[st.rows]) st.rows = Object.keys(dims)[0];
  if (st.cols !== '' && !dims[st.cols]) st.cols = '';
  if (!measures[st.measure]) st.measure = Object.keys(measures)[0];
  const mKey = st.measure;
  const data = cfg.data(cfg.noScope ? 'all' : st.scope);
  const rf = dims[st.rows], cf = st.cols ? dims[st.cols] : () => 'Total', mf = measures[mKey];
  const cells = {}, rowVals = {}, colVals = {}, all = [];
  data.forEach(x => {
    const r = String(rf(x)), c = String(cf(x)), v = mf(x);
    ((cells[r] = cells[r] || {})[c] = cells[r][c] || []).push(v);
    (rowVals[r] = rowVals[r] || []).push(v); (colVals[c] = colVals[c] || []).push(v); all.push(v);
  });
  const agg = AGGS[st.agg].fn;
  const order = (dim, keys, vals) => {
    if (dim === 'Weekday') return keys.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    if (dim === 'Prayer') return keys.sort((a, b) => ALL_PRAYERS.findIndex(p => L('prayer.' + p) === a) - ALL_PRAYERS.findIndex(p => L('prayer.' + p) === b));
    if (ORDERED_DIMS.includes(dim) || dim === L('field.date')) return keys.sort();
    return keys.sort((a, b) => agg(vals[b]) - agg(vals[a]));
  };
  const rKeys = order(st.rows, Object.keys(rowVals), rowVals), cKeys = order(st.cols, Object.keys(colVals), colVals);
  const show = v => sec === 'namaz' ? (st.agg === 'avg' ? Math.round(v * 100) + '%' : fmt.format(Math.round(v * 100) / 100))
    : st.agg === 'count' ? String(v) : money(v);
  return { st, dims, mKey, rKeys, cKeys, cells, rowVals, colVals, all, agg, show, cfg };
}

function renderPivot(sec) {
  const p = pivotData(sec), { st, dims, rKeys, cKeys, cells, rowVals, colVals, all, agg, show, cfg } = p;
  const opt = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const dimList = Object.keys(dims).map(d => [d, d]);
  const showCols = st.cols && cKeys.length;
  const head = [esc(st.rows) + (st.cols ? ' \\ ' + esc(st.cols) : ''), ...(showCols ? cKeys.map(esc) : []), 'Total'];
  const body = rKeys.map(r => [esc(r), ...(showCols ? cKeys.map(c => cells[r][c] ? show(agg(cells[r][c])) : '<span class="muted">·</span>') : []), `<b>${show(agg(rowVals[r]))}</b>`]);
  const foot = ['Total', ...(showCols ? cKeys.map(c => show(agg(colVals[c]))) : []), show(agg(all))];
  return `<div class="card pivot-controls">
    <div class="grid2">
      <div><label>Rows</label><select data-pivot="${sec}:rows">${opt(dimList, st.rows)}</select></div>
      <div><label>Columns</label><select data-pivot="${sec}:cols">${opt([['', '(none)'], ...dimList], st.cols)}</select></div>
      <div><label>Value</label><select data-pivot="${sec}:agg">${opt(Object.entries(AGGS).map(([k, v]) => [k, `${v.label} of ${p.mKey}${cfg.pctAvg && k === 'avg' ? ' (rate)' : ''}`]), st.agg)}</select></div>
      ${Object.keys(cfg.measures()).length > 1 ? `<div><label>Measure</label><select data-pivot="${sec}:measure">${opt(Object.keys(cfg.measures()).map(m => [m, m]), st.measure)}</select></div>` : ''}
      ${cfg.noScope ? '' : `<div><label>Period</label><select data-pivot="${sec}:scope">${opt([['month', monthLabel(ui.month)], ['all', 'All time']], st.scope)}</select></div>`}
    </div>
    <div class="actions"><button type="button" class="btn ghost" data-pivot-swap="${sec}" ${st.cols ? '' : 'disabled'}>⇅ Swap rows/columns</button>
      <button type="button" class="btn ghost" data-pivot-export="${sec}">Export pivot (Excel)</button></div></div>
  <div class="card">${rKeys.length ? table(head, body, foot, 'pivot') : '<div class="empty">No data for this period.</div>'}</div>`;
}

function pivotExportRows(sec) {
  const { st, rKeys, cKeys, cells, rowVals, colVals, all, agg } = pivotData(sec);
  const showCols = st.cols && cKeys.length;
  const round = v => Math.round(v * 100) / 100;
  return [
    [st.rows + (st.cols ? ' \\ ' + st.cols : ''), ...(showCols ? cKeys : []), 'Total'],
    ...rKeys.map(r => [r, ...(showCols ? cKeys.map(c => cells[r][c] ? round(agg(cells[r][c])) : '') : []), round(agg(rowVals[r]))]),
    ['Total', ...(showCols ? cKeys.map(c => round(agg(colVals[c]))) : []), round(agg(all))],
  ];
}

// ======================================================================
// Views
// ======================================================================
function renderHome() {
  const cur = ui.month, prev = shiftMonth(cur, -1);
  const a = monthStats(cur), b = monthStats(prev);
  const bal = balancesAt(), total = Object.values(bal).reduce((s, v) => s + v, 0);
  const rec = dueTotals('receivable'), pay = dueTotals('payable');
  const name = profile().name;
  const tile = (k, x, y, good, extra = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${money(x)}</div>
    ${delta(x, y, good)}<div class="small muted">${monthShort(prev)}: ${money(y)}</div>${extra}</div>`;

  // 6-month trend
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(cur, i - 5));
  const trend = months.map(m => ({ m, inc: monthStats(m).income, exp: monthStats(m).expense }));
  const tmax = Math.max(1, ...trend.flatMap(t => [t.inc, t.exp]));
  const trendChart = `<div class="legend"><span><i class="key s1"></i>${typeLabel('income')}</span><span><i class="key s2"></i>${typeLabel('expense')}</span></div>
    <div class="vchart" role="img" aria-label="${typeLabel('income')} and ${typeLabel('expense')} for the last 6 months">
    ${trend.map(t => `<div class="vgroup ${t.m === cur ? 'current' : ''}"><div class="vbars">
        <div class="vbar s1" style="height:${(t.inc / tmax * 100).toFixed(1)}%" tabindex="0" data-tip="${monthLabel(t.m)} · ${typeLabel('income')}: ${esc(money(t.inc))}"></div>
        <div class="vbar s2" style="height:${(t.exp / tmax * 100).toFixed(1)}%" tabindex="0" data-tip="${monthLabel(t.m)} · ${typeLabel('expense')}: ${esc(money(t.exp))}"></div>
      </div><div class="vlabel">${monthShort(t.m)}</div></div>`).join('')}</div>
    <details><summary class="small">Show as table</summary>${table(['Month', typeLabel('income'), typeLabel('expense'), 'Net'],
      trend.map(t => [monthLabel(t.m), money(t.inc), money(t.exp), money(t.inc - t.exp)]))}</details>`;

  // Expense categories: this month vs last month
  const catMap = {};
  a.expenseByCat.forEach(([k, v]) => { catMap[k] = { cur: v, prev: 0 }; });
  b.expenseByCat.forEach(([k, v]) => { catMap[k] = Object.assign(catMap[k] || { cur: 0 }, { prev: v }); });
  const cats = Object.entries(catMap).sort((x, y) => (y[1].cur + y[1].prev) - (x[1].cur + x[1].prev));
  const cmax = Math.max(1, ...cats.flatMap(([, v]) => [v.cur, v.prev]));
  const catRow = ([k, v]) => `<div class="pair">
      <div class="label"><span>${esc(k)}</span><span>${money(v.cur)} ${delta(v.cur, v.prev, false)}</span></div>
      <div class="htrack"><div class="hbar s1" style="width:${(v.cur / cmax * 100).toFixed(1)}%" tabindex="0" data-tip="${esc(k)} · ${monthShort(cur)}: ${esc(money(v.cur))}"></div></div>
      <div class="htrack"><div class="hbar s2" style="width:${(v.prev / cmax * 100).toFixed(1)}%" tabindex="0" data-tip="${esc(k)} · ${monthShort(prev)}: ${esc(money(v.prev))}"></div></div></div>`;
  const catChart = cats.length ? `<div class="legend"><span><i class="key s1"></i>${monthShort(cur)}</span><span><i class="key s2"></i>${monthShort(prev)}</span></div>
    ${cats.slice(0, 6).map(catRow).join('')}${cats.length > 6 ? `<details><summary class="small">All ${cats.length} categories</summary>${cats.slice(6).map(catRow).join('')}</details>` : ''}`
    : '<div class="empty small">No expenses in either month</div>';

  const srcMap = {};
  a.incomeByCat.forEach(([k, v]) => { srcMap[k] = { cur: v, prev: 0 }; });
  b.incomeByCat.forEach(([k, v]) => { srcMap[k] = Object.assign(srcMap[k] || { cur: 0 }, { prev: v }); });
  const srcRows = Object.entries(srcMap).sort((x, y) => y[1].cur - x[1].cur).map(([k, v]) => [esc(k), money(v.cur), money(v.prev), delta(v.cur, v.prev, true)]);
  const sa = accountStatement(cur), sb = Object.fromEntries(accountStatement(prev).map(r => [r.name, r]));
  const accRows = sa.map(r => [esc(r.name), `<b>${money(r.closing)}</b>`, money(r.inflow - r.outflow), money((sb[r.name]?.inflow || 0) - (sb[r.name]?.outflow || 0))]);
  const loanRows = [['lend', 'lent'], ['collect', 'collected'], ['borrow', 'borrowed'], ['repay', 'repaid']]
    .map(([t, k]) => [typeLabel(t), money(a[k]), money(b[k]), delta(a[k], b[k], t === 'collect' || t === 'repay')]);
  const recent = allTx().slice().sort((x, y) => (y.date + y.updatedAt).localeCompare(x.date + x.updatedAt)).slice(0, 6);
  const dueTile = (kind, t) => `<a class="stat" href="#dues" data-due="${kind}" style="text-decoration:none;color:inherit">
    <div class="k">${esc(L('due.' + kind))} left</div><div class="v warn">${money(t.due)}</div>
    <div class="small muted">${t.open} open${t.overdue ? ` · <span class="out">${t.overdue} overdue</span>` : ''}</div></a>`;

  const st = Object.fromEntries(accountStatement(cur).map(r => [r.name, r]));
  const cards = `<div class="cards-scroll" aria-label="Balances">
    <div class="bcard g0"><div class="bc-top"><span>Available balance</span><span class="bc-chip"></span></div>
      <div class="bc-amt">${money(total)}</div>
      <div class="bc-mid">Net ${monthShort(cur)} <b>${a.net >= 0 ? '+' : ''}${money(a.net)}</b></div>
      <div class="bc-foot"><div><small>${esc(L('field.account'))}s</small><b>${Object.keys(bal).length}</b></div><div><small>Holder</small><b>${esc(name || '—')}</b></div></div></div>
    ${Object.entries(bal).map(([k, v], i) => `<div class="bcard g${i % 5 + 1}"><div class="bc-top"><span>${esc(k)}</span><span class="bc-chip"></span></div>
      <div class="bc-amt">${money(v)}</div>
      <div class="bc-mid">In <b>${money(st[k]?.inflow || 0)}</b> · Out <b>${money(st[k]?.outflow || 0)}</b></div>
      <div class="bc-foot"><div><small>Opening ${monthShort(cur)}</small><b>${money(st[k]?.opening || 0)}</b></div></div></div>`).join('')}</div>`;
  const quick = `<div class="quick">
    <button type="button" data-quick="expense"><span>−</span>${esc(typeLabel('expense'))}</button>
    <button type="button" data-quick="income"><span>+</span>${esc(typeLabel('income'))}</button>
    <button type="button" data-quick="transfer"><span>⇄</span>${esc(typeLabel('transfer'))}</button>
    <button type="button" data-quick="lend"><span>↗</span>${esc(typeLabel('lend'))}</button>
    <a href="#more/profile"><span>▦</span>Categories</a><a href="#more/data"><span>⇅</span>Import</a></div>`;
  return `${cards}${quick}${monthBar(` <span class="muted small">vs ${monthShort(prev)}</span>`)}
  <div class="grid2">
    ${tile(typeLabel('income'), a.income, b.income, true)}
    ${tile(typeLabel('expense'), a.expense, b.expense, false, a.purchases ? `<div class="small muted">incl. ${money(a.purchases)} ${esc(L('sec.purchases'))}</div>` : '')}
    ${tile('Net savings', a.net, b.net, true)}
    ${tile('Daily expense', Math.round(a.daily), Math.round(b.daily), false)}
  </div>
  <div class="row small muted" style="margin:8px 2px 12px">Monthly forecast: <b style="color:var(--text)">${money(Math.round(a.forecast))}</b></div>
  <div class="card"><div class="row between"><h2>Spending breakdown</h2><a href="#ledger" class="viewall">View all ›</a></div>${donut(a.expenseByCat)}</div>
  <div class="grid2">${dueTile('receivable', rec)}${dueTile('payable', pay)}</div>
  <div class="card" style="margin-top:12px"><div class="row between"><h2>Recent transactions</h2><a href="#ledger" class="viewall">View all ›</a></div>
    ${recent.length ? `<ul class="list">${recent.slice(0, 5).map(txLine).join('')}</ul>` : '<div class="empty">No transactions yet. Tap + to add one.</div>'}</div>
  <div class="card"><h2>Last 6 months</h2>${trendChart}</div>
  <div class="card"><h2>${typeLabel('expense')} by ${esc(L('field.category').toLowerCase())}: ${monthShort(cur)} vs ${monthShort(prev)}</h2>${catChart}</div>
  <div class="card"><h2>${typeLabel('income')} by ${esc(L('field.source').toLowerCase())}</h2>${table([esc(L('field.source')), monthShort(cur), monthShort(prev), 'Change'], srcRows)}</div>
  <div class="card"><h2>Loans</h2>${table(['', monthShort(cur), monthShort(prev), 'Change'], loanRows)}</div>
  <div class="card"><h2>${esc(L('field.account'))} flow</h2>${table([esc(L('field.account')), 'Balance', 'Net ' + monthShort(cur), 'Net ' + monthShort(prev)], accRows)}</div>`;
}

// ======================================================================
// Budgets & Category Spending
// ======================================================================
function categorySpending(monthStr) {
  const txs = allTx().filter(t => monthOf(t.date) === monthStr && t.type === 'expense');
  const m = {};
  txs.forEach(t => {
    const c = t.category || 'General';
    m[c] = (m[c] || 0) + Number(t.amount || 0);
  });
  return m;
}

function renderLedgerBudgets(monthStr) {
  const p = profile();
  const budgets = p.budgets || {};
  const spentByCat = categorySpending(monthStr);
  const totalSpent = sumBy(Object.values(spentByCat), n => n);
  
  const budgetCatKeys = Object.keys(budgets).filter(k => k !== '_total' && Number(budgets[k]) > 0);
  const hasBudgets = budgetCatKeys.length > 0 || (Number(budgets._total) > 0);

  if (!hasBudgets) {
    return `<div class="budget-card">
      <div class="budget-head">
        <h2><span>🎯 Monthly Budgets</span></h2>
        <button type="button" class="btn ghost small" data-action="manage-budgets" style="padding:5px 12px;font-size:12px;border-radius:10px">⚙ Set Limits</button>
      </div>
      <p class="small muted" style="margin:0 0 10px">Set monthly spending limits per category to see live progress bars and prevent overspending.</p>
      <div class="actions" style="margin-top:6px;gap:8px">
        <button type="button" class="btn small" data-action="manage-budgets" style="padding:8px 14px;font-size:12px">Set Category Spending Limits</button>
        <button type="button" class="btn ghost small" data-action="auto-budgets" style="padding:8px 14px;font-size:12px">⚡ Auto-fill From Spending</button>
      </div>
    </div>`;
  }

  const overallLimit = Number(budgets._total) || sumBy(budgetCatKeys, k => Number(budgets[k]) || 0);
  const overallPct = overallLimit > 0 ? Math.round((totalSpent / overallLimit) * 100) : 0;
  const overallClass = overallPct >= 100 ? 'over' : overallPct >= 80 ? 'warn' : 'safe';
  const overallLeft = overallLimit - totalSpent;

  const allRelevantCats = [...new Set([...budgetCatKeys, ...Object.keys(spentByCat)])].filter(k => k !== '_total');
  allRelevantCats.sort((a, b) => {
    const limA = Number(budgets[a] || 0), limB = Number(budgets[b] || 0);
    const pctA = limA > 0 ? (spentByCat[a] || 0) / limA : (spentByCat[a] ? 0.99 : 0);
    const pctB = limB > 0 ? (spentByCat[b] || 0) / limB : (spentByCat[b] ? 0.99 : 0);
    return pctB - pctA;
  });

  const catRows = allRelevantCats.map(cat => {
    const limit = Number(budgets[cat] || 0);
    const spent = spentByCat[cat] || 0;
    if (limit === 0 && spent === 0) return '';
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const barWidth = limit > 0 ? Math.min(100, pct) : (spent > 0 ? 100 : 0);
    const statusClass = limit > 0 ? (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe') : 'warn';
    const remaining = limit - spent;
    const badgeText = limit === 0 
      ? 'No limit' 
      : (pct >= 100 ? `+${money(Math.abs(remaining))} OVER` : `${money(remaining)} left`);
    const badgeClass = limit === 0 ? '' : (pct >= 100 ? 'badge st-overdue' : pct >= 80 ? 'badge st-due' : 'badge st-done');

    return `<div class="budget-item" data-filter-cat="${esc(cat)}" style="cursor:pointer" title="Click to filter Ledger by ${esc(cat)}">
      <div class="budget-row">
        <div class="b-cat-info">
          <span class="b-cat-name">${esc(cat)}</span>
          ${limit > 0 ? `<span class="${badgeClass} b-cat-badge">${badgeText}</span>` : ''}
        </div>
        <div class="b-cat-numbers">
          <span class="b-cat-amt">${money(spent)} <span class="muted small">/ ${limit > 0 ? money(limit) : '—'}</span></span>
          ${limit > 0 ? `<b class="b-cat-pct ${statusClass === 'over' ? 'out' : statusClass === 'warn' ? 'warn' : 'in'}">${pct}%</b>` : ''}
        </div>
      </div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${statusClass}" style="width:${barWidth}%"></div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  return `<div class="budget-card">
    <div class="budget-head">
      <h2><span>🎯 Monthly Budgets</span> <span class="small muted">(${monthLabel(monthStr)})</span></h2>
      <button type="button" class="btn ghost small" data-action="manage-budgets" style="padding:4px 10px;font-size:12px;border-radius:10px">⚙ Set Limits</button>
    </div>
    ${overallLimit > 0 ? `
    <div class="budget-overall">
      <div class="budget-row">
        <span style="font-weight:700">Total Monthly Ceiling</span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums">${money(totalSpent)} <span class="muted small">/ ${money(overallLimit)}</span> <b class="${overallClass === 'over' ? 'out' : overallClass === 'warn' ? 'warn' : 'in'}">(${overallPct}%)</b></span>
      </div>
      <div class="budget-bar-track" style="height:10px">
        <div class="budget-bar-fill ${overallClass}" style="width:${Math.min(100, overallPct)}%"></div>
      </div>
      <div class="budget-row" style="margin-top:6px;font-size:12px;color:var(--muted)">
        <span>${overallLeft >= 0 ? `${money(overallLeft)} remaining this month` : `<span class="out font-bold">Over budget by ${money(Math.abs(overallLeft))}</span>`}</span>
        <span>${budgetCatKeys.length} categories tracked</span>
      </div>
    </div>` : ''}
    <div class="budget-cat-list">
      ${catRows}
    </div>
  </div>`;
}

function budgetForm() {
  const p = profile();
  const curBudgets = p.budgets || {};
  const cats = p.expenseCats || DEFAULT_EXPENSE;
  const spentByCat = categorySpending(ui.month);

  const inputs = cats.map(c => {
    const lim = curBudgets[c] !== undefined ? curBudgets[c] : '';
    const curSpent = spentByCat[c] || 0;
    return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1">
        <div style="font-weight:600">${esc(c)}</div>
        <div class="small muted">Spent this month: ${money(curSpent)}</div>
      </div>
      <div style="width:130px;flex:none">
        <input type="number" step="50" name="cat_${esc(c)}" value="${lim}" placeholder="No limit" style="text-align:right" inputmode="decimal">
      </div>
    </div>`;
  }).join('');

  openSheet(`<h3>🎯 Monthly Spending Limits</h3>
    <p class="small muted">Set monthly limits for categories (${esc(profile().currency)}). Progress bars will appear in the Ledger view.</p>
    <label for="bOverall">Overall Monthly Budget Ceiling (${esc(profile().currency)})</label>
    <input id="bOverall" name="_total" type="number" step="100" placeholder="e.g. 50000 (optional)" value="${curBudgets._total || ''}" inputmode="decimal">
    <h4 style="margin:16px 0 8px">Category Limits</h4>
    <div style="max-height:45vh;overflow-y:auto;padding-right:4px">
      ${inputs}
    </div>
    <div class="actions sticky">
      <button type="button" class="btn ghost" data-action="clear-budgets">Clear all</button>
      <button type="submit" class="btn">Save Budgets</button>
    </div>`,
  fd => {
    const newBudgets = {};
    const tot = evalAmount(fd.get('_total') || '0');
    if (tot > 0) newBudgets._total = tot;
    cats.forEach(c => {
      const v = evalAmount(fd.get('cat_' + c) || '0');
      if (v > 0) newBudgets[c] = v;
    });
    saveProfile({ budgets: newBudgets });
    toast('Monthly budgets updated');
    render();
  });
}

function autoBudgets() {
  const spentByCat = categorySpending(ui.month);
  const newBudgets = {};
  let total = 0;
  Object.entries(spentByCat).forEach(([cat, spent]) => {
    if (spent > 0) {
      let rounded = Math.ceil(spent * 1.2 / 100) * 100;
      if (rounded < 500) rounded = 500;
      newBudgets[cat] = rounded;
      total += rounded;
    }
  });
  if (total > 0) newBudgets._total = Math.ceil(total * 1.1 / 1000) * 1000;
  saveProfile({ budgets: newBudgets });
  toast('Budgets generated from your spending');
  render();
}

// ======================================================================
// Namaz Jamat Times & Alarm
// ======================================================================
function format12h(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return timeStr || '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

function getPrayerAlarmTime(jamatTime, beforeMinutes) {
  if (!jamatTime || !jamatTime.includes(':')) return '';
  const [h, m] = jamatTime.split(':').map(Number);
  let totalMin = h * 60 + m - (beforeMinutes || 0);
  if (totalMin < 0) totalMin += 24 * 60;
  const ah = Math.floor(totalMin / 60) % 24;
  const am = totalMin % 60;
  return `${pad(ah)}:${pad(am)}`;
}

function getNextJamat(times, alarm) {
  const now = new Date();
  const curMinutes = now.getHours() * 60 + now.getMinutes();
  const fard = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const beforeObj = alarm?.before || {};
  
  let candidates = fard.map(p => {
    const [h, m] = (times[p] || '12:00').split(':').map(Number);
    const targetMin = h * 60 + m;
    let diff = targetMin - curMinutes;
    if (diff < 0) diff += 24 * 60;
    const beforeMin = beforeObj[p] !== undefined ? Number(beforeObj[p]) : 15;
    const alarmTime = getPrayerAlarmTime(times[p], beforeMin);
    return { prayer: p, time: times[p], diffMinutes: diff, beforeMin, alarmTime };
  });

  candidates.sort((a, b) => a.diffMinutes - b.diffMinutes);
  const next = candidates[0];
  if (!next) return null;
  const h = Math.floor(next.diffMinutes / 60);
  const m = next.diffMinutes % 60;
  const diffText = h > 0 ? `in ${h}h ${m}m` : `in ${m} mins`;
  return { ...next, diffText };
}

function playPrayerChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const notes = [329.63, 392.00, 493.88, 659.25]; // E4, G4, B4, E5 chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.32);
      gain.gain.setValueAtTime(0, now + idx * 0.32);
      gain.gain.linearRampToValueAtTime(0.28, now + idx * 0.32 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.32 + 1.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.32);
      osc.stop(now + idx * 0.32 + 1.85);
    });
  } catch (err) {
    console.warn('AudioContext chime error:', err);
  }
}

function renderJamatCard() {
  const p = profile();
  const times = p.namazJamat || { Fajr: '05:15', Dhuhr: '13:15', Asr: '16:30', Maghrib: '17:45', Isha: '20:00' };
  const alarm = p.namazAlarm || { enabled: true, before: { Fajr: 15, Dhuhr: 15, Asr: 15, Maghrib: 10, Isha: 15 } };
  const nextInfo = getNextJamat(times, alarm);

  return `<div class="jamat-card">
    <div class="budget-head">
      <h2><span>🕌 Jamat Times & Wudu Alarms</span></h2>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn ghost small" data-action="toggle-namaz-alarm" title="Toggle prayer alarm" style="padding:4px 9px;font-size:12px;border-radius:10px">
          ${alarm.enabled ? '🔔 Alarm ON' : '🔕 Alarm OFF'}
        </button>
        <button type="button" class="btn ghost small" data-action="test-jamat-alarm" title="Test prayer chime" style="padding:4px 9px;font-size:12px;border-radius:10px">
          🔊 Test
        </button>
        <button type="button" class="btn small" data-action="set-jamat" style="padding:4px 10px;font-size:12px;border-radius:10px">
          ⚙ Edit Times
        </button>
      </div>
    </div>
    ${nextInfo ? `
    <div class="jamat-banner">
      <div>
        <div class="small muted" style="font-weight:600">UPCOMING JAMAT & WUDU ALARM</div>
        <div style="font-size:15px;font-weight:750">
          ${esc(L('prayer.' + nextInfo.prayer))} Jamat at <b>${format12h(nextInfo.time)}</b>
        </div>
        <div class="small" style="color:var(--brand);margin-top:2px;font-weight:600">
          🔔 Alarm at ${format12h(nextInfo.alarmTime)} (${nextInfo.beforeMin}m prior for wudu)
        </div>
      </div>
      <div style="text-align:right">
        <span class="badge ${nextInfo.diffMinutes <= 30 ? 'st-due' : 'st-done'}" style="font-size:12px;padding:4px 8px">
          Jamat ${nextInfo.diffText}
        </span>
      </div>
    </div>` : ''}
    <div class="jamat-grid">
      ${PRAYERS.fard.map(name => {
        const time = times[name] || '--:--';
        const beforeMin = alarm.before?.[name] !== undefined ? alarm.before[name] : 15;
        const alarmTime = getPrayerAlarmTime(time, beforeMin);
        const isNext = nextInfo?.prayer === name;
        return `<div class="jamat-tile ${isNext ? 'active' : ''}">
          <div class="p-name">${esc(L('prayer.' + name))}</div>
          <div class="p-time">${format12h(time)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">
            🔔 ${format12h(alarmTime)}
          </div>
          <span class="badge ${isNext ? 'st-due' : ''}" style="font-size:9px;padding:1px 4px;margin-top:3px;display:inline-block">
            -${beforeMin}m wudu
          </span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function jamatForm() {
  const p = profile();
  const times = p.namazJamat || { Fajr: '05:15', Dhuhr: '13:15', Asr: '16:30', Maghrib: '17:45', Isha: '20:00' };
  const alarm = p.namazAlarm || { enabled: true, before: { Fajr: 15, Dhuhr: 15, Asr: 15, Maghrib: 10, Isha: 15 } };
  const beforeObj = alarm.before || {};

  const prayerRows = PRAYERS.fard.map(name => {
    const curTime = times[name] || '12:00';
    const curBefore = beforeObj[name] !== undefined ? Number(beforeObj[name]) : 15;
    const calcAlarm = getPrayerAlarmTime(curTime, curBefore);
    return `<div style="background:var(--bg);padding:10px 12px;border-radius:14px;margin-bottom:8px;border:1px solid var(--line)">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span>${esc(L('prayer.' + name))}</span>
        <span class="small" style="color:var(--brand);font-weight:600">🔔 Alarm: ${format12h(calcAlarm)}</span>
      </div>
      <div class="grid2">
        <div>
          <label style="font-size:11px;margin-bottom:2px">Jamat Time</label>
          <input type="time" name="time_${name}" value="${curTime}" required>
        </div>
        <div>
          <label style="font-size:11px;margin-bottom:2px">Alarm Before (Wudu/Prep)</label>
          <select name="before_${name}">
            <option value="0" ${curBefore === 0 ? 'selected' : ''}>Exact Jamat time (0m)</option>
            <option value="5" ${curBefore === 5 ? 'selected' : ''}>5 mins before</option>
            <option value="10" ${curBefore === 10 ? 'selected' : ''}>10 mins before</option>
            <option value="15" ${curBefore === 15 ? 'selected' : ''}>15 mins before (Wudu)</option>
            <option value="20" ${curBefore === 20 ? 'selected' : ''}>20 mins before</option>
            <option value="30" ${curBefore === 30 ? 'selected' : ''}>30 mins before</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join('');

  openSheet(`<h3>🕌 Set Namaz Jamat Times & Wudu Alarms</h3>
    <p class="small muted">Set manual Jamat times for each prayer and choose how many minutes before to sound the alarm for Wudu and preparation.</p>
    <div style="max-height:50vh;overflow-y:auto;padding-right:2px">
      ${prayerRows}
    </div>
    <div style="margin-top:12px">
      <label class="check" style="font-weight:600">
        <input type="checkbox" name="alarmEnabled" ${alarm.enabled ? 'checked' : ''}>
        Enable Audio Chime Alarm & Notifications
      </label>
    </div>
    <div class="actions sticky">
      <button type="button" class="btn ghost" data-action="test-jamat-alarm">🔊 Test Chime</button>
      <button type="submit" class="btn">Save Jamat Times</button>
    </div>`,
  fd => {
    const updatedTimes = {};
    const updatedBefore = {};
    PRAYERS.fard.forEach(name => {
      updatedTimes[name] = fd.get('time_' + name) || '12:00';
      updatedBefore[name] = Number(fd.get('before_' + name) || 15);
    });
    const updatedAlarm = {
      enabled: fd.get('alarmEnabled') === 'on',
      before: updatedBefore
    };
    saveProfile({ namazJamat: updatedTimes, namazAlarm: updatedAlarm });
    if (updatedAlarm.enabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    toast('Jamat times & Wudu alarm preferences saved');
    render();
  });
}

let lastAlarmTriggered = '';
function checkPrayerAlarm() {
  const p = profile();
  const alarm = p.namazAlarm;
  if (!alarm || !alarm.enabled) return;
  const times = p.namazJamat || {};
  const beforeObj = alarm.before || {};
  const now = new Date();
  const curH = now.getHours(), curM = now.getMinutes();
  const curTotalMin = curH * 60 + curM;
  const todayStr = isoDate(now);

  PRAYERS.fard.forEach(prayer => {
    const t = times[prayer];
    if (!t) return;
    const [h, m] = t.split(':').map(Number);
    const beforeMin = beforeObj[prayer] !== undefined ? Number(beforeObj[prayer]) : 15;
    let targetMin = h * 60 + m - beforeMin;
    if (targetMin < 0) targetMin += 24 * 60;
    if (curTotalMin === targetMin) {
      const alarmKey = `${todayStr}-${prayer}-${targetMin}`;
      if (lastAlarmTriggered !== alarmKey) {
        lastAlarmTriggered = alarmKey;
        playPrayerChime();
        const msg = beforeMin > 0
          ? `🕌 Namaz Alarm: ${beforeMin}m before ${L('prayer.' + prayer)} Jamat (${format12h(t)})! Time for Wudu & Preparation.`
          : `🕌 Namaz Alarm: Time for ${L('prayer.' + prayer)} Jamat (${format12h(t)})!`;
        toast(msg);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`🕌 ${L('prayer.' + prayer)} Preparation`, {
            body: msg,
            icon: '/icons/icon-192.png'
          });
        }
      }
    }
  });
}
setInterval(checkPrayerAlarm, 20000);

function applyThemeAndFont() {
  const p = profile();
  const t = p.theme || localStorage.getItem('moneybook.theme') || 'purple';
  const f = p.font || localStorage.getItem('moneybook.font') || 'inter';
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.font = f;
}

// ---------- Ledger ----------
function renderLedger() {
  const mode = ui.mode.ledger || 'list';
  const top = `${monthBar()}${modeSwitch('ledger')}`;
  if (mode === 'statement') return top + ledgerStatement();
  if (mode === 'pivot') return top + renderPivot('ledger');
  const month = allTx().filter(t => monthOf(t.date) === ui.month), s = monthStats(ui.month);
  if (ui.day && monthOf(ui.day) !== ui.month) ui.day = '';
  let list = month;
  if (ui.day) list = list.filter(t => t.date === ui.day);
  if (ui.filter !== 'all') list = list.filter(t => t.type === ui.filter);
  if (ui.account) list = list.filter(t => t.account === ui.account || t.toAccount === ui.account);
  if (ui.cat) list = list.filter(t => (t.category || '') === ui.cat);
  if (ui.q) { const q = ui.q.toLowerCase(); list = list.filter(t => [t.note, t.category, t.account, t.toAccount, t.amount].join(' ').toLowerCase().includes(q)); }
  list.sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));
  const groups = {};
  list.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));

  // calendar with a dot on days that have spending
  const spentDay = {};
  month.filter(t => t.type === 'expense').forEach(t => { spentDay[t.date] = (spentDay[t.date] || 0) + Number(t.amount); });
  const first = new Date(ui.month + '-01T00:00').getDay(), dim = daysInMonth(ui.month);
  let cal = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<span class="dow">${x}</span>`).join('') + '<span></span>'.repeat(first);
  for (let i = 1; i <= dim; i++) {
    const d = `${ui.month}-${pad(i)}`;
    cal += `<button type="button" class="day ${spentDay[d] ? 'has' : ''} ${d === ui.day ? 'sel' : ''} ${d === today() ? 'today' : ''}" data-day="${d}"
      ${spentDay[d] ? `data-tip="${dayLabel(d)}: spent ${esc(money(spentDay[d]))}"` : ''} aria-label="${dayLabel(d)}">${i}</button>`;
  }
  const cats = [...new Set(month.map(t => t.category).filter(Boolean))].sort();
  const chips = ['all', ...Object.keys(TYPES)].map(k => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${ui.filter === k}">${k === 'all' ? 'All' : esc(typeLabel(k))}</button>`).join('');
  return `${top}
  <div class="duo">
    <div class="sum purple"><small>Total ${esc(typeLabel('income').toLowerCase())}</small><b>${money(s.income)}</b><span>${monthLabel(ui.month)}</span></div>
    <div class="sum orange"><small>Total ${esc(typeLabel('expense').toLowerCase())}</small><b>${money(s.expense)}</b><span>Daily avg ${money(Math.round(s.daily))}</span></div></div>
  ${renderLedgerBudgets(ui.month)}
  <details class="card calcard" ${ui.calOpen ? 'open' : ''} data-cal><summary><span>📅 ${ui.day ? relDay(ui.day) : 'Pick a day'}</span>${ui.day ? '<button type="button" class="chip" data-day="">Clear ✕</button>' : '<span class="muted small">dots = spending</span>'}</summary>
    <div class="mcal">${cal}</div></details>
  <div class="filters">
    <input class="search" type="search" placeholder="Search notes, category, amount…" value="${esc(ui.q)}" data-search aria-label="Search">
    <select data-fsel="cat" aria-label="Category"><option value="">All categories</option>${cats.map(c => `<option ${c === ui.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select data-fsel="account" aria-label="${esc(L('field.account'))}"><option value="">All ${esc(L('field.account').toLowerCase())}s</option>${accountNames().map(a => `<option ${a === ui.account ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
  <div class="chips">${chips}</div>
  ${list.length ? Object.entries(groups).map(([d, items]) => {
    const spent = sumBy(items.filter(t => t.type === 'expense'), t => t.amount);
    return `<div class="card daycard"><div class="dayhead"><span>${relDay(d)}</span><span>${spent ? 'Spent ' + money(spent) : ''}</span></div><ul class="list">${items.map(txLine).join('')}</ul></div>`;
  }).join('') : '<div class="card"><div class="empty">No transactions for this filter.</div></div>'}`;
}

function ledgerStatement() {
  const st = accountStatement(ui.month), s = monthStats(ui.month);
  const tot = k => sumBy(st, r => r[k]);
  const accTable = table([esc(L('field.account')), 'Opening', 'Inflow', 'Outflow', 'Closing'],
    st.map(r => [esc(r.name), money(r.opening), `<span class="in">${money(r.inflow)}</span>`, `<span class="out">${money(r.outflow)}</span>`, `<b>${money(r.closing)}</b>`]),
    ['Total', money(tot('opening')), money(tot('inflow')), money(tot('outflow')), money(tot('closing'))]);
  const pl = [
    ...s.incomeByCat.map(([k, v]) => [esc(k), `<span class="in">${money(v)}</span>`]),
    [`<b>Total ${esc(typeLabel('income').toLowerCase())}</b>`, `<b class="in">${money(s.income)}</b>`],
    ...s.expenseByCat.map(([k, v]) => [esc(k), `<span class="out">${money(v)}</span>`]),
    [`<b>Total ${esc(typeLabel('expense').toLowerCase())}</b>`, `<b class="out">${money(s.expense)}</b>`],
  ];
  const sd = profile().startDate;
  return `<div class="card"><h2>Account statement · ${monthLabel(ui.month)}</h2>${accTable}
    <p class="small muted">Opening = opening balance${sd ? ` (books start ${dayLabel(sd)})` : ''} + all earlier entries. Transfers show as outflow from one account and inflow to the other.</p></div>
  <div class="card"><h2>Income & expense statement</h2>${table(['', esc(L('field.amount'))], pl, [`<b>Net result</b>`, `<b class="${s.net < 0 ? 'out' : 'in'}">${money(s.net)}</b>`])}
    ${s.purchases ? `<p class="small muted">Includes ${money(s.purchases)} of ${esc(L('sec.purchases'))} items not found in the ledger.</p>` : ''}</div>
  <div class="card"><h2>Loans & internal movements</h2>${table(['', esc(L('field.amount'))], [
    [typeLabel('lend') + ' (receivable out)', money(s.lent)], [typeLabel('collect') + ' (receivable in)', money(s.collected)],
    [typeLabel('borrow') + ' (payable in)', money(s.borrowed)], [typeLabel('repay') + ' (payable out)', money(s.repaid)],
    [typeLabel('transfer') + 's between accounts', money(s.transfer)]])}</div>`;
}

// ---------- Dues ----------
function dueLine(d) {
  const i = dueInfo()[d.id], k = d.kind;
  const sub = i.status === 'done' ? `Settled${i.settledOn ? ' ' + dayLabel(i.settledOn) : ''}`
    : i.status === 'partial' ? `${money(i.paid)} of ${money(d.amount)} paid${d.dueDate ? ' · due ' + dayLabel(d.dueDate) : ''}`
      : d.dueDate ? `Due by ${dayLabel(d.dueDate)}` : d.date ? 'Since ' + dayLabel(d.date) : 'Open';
  const linked = d.originTxId || i.payments;
  const isFixed = d.term === 'fixed';
  const termBadge = `<span class="badge ${isFixed ? 'st-done' : 'st-partial'} due-term-badge">${isFixed ? 'স্থায়ী' : 'চলিত'}</span>`;
  return `<li data-due-open="${esc(d.id)}"><div class="ico">${k === 'receivable' ? '↙' : '↗'}</div>
    <div class="main"><div class="t due-title"><span class="due-name">${esc(d.name)}</span>${termBadge}${linked ? ' <span class="small muted" title="Linked to ledger">🔗</span>' : ''}</div>
      <div class="s">${sub}${d.note ? ' · ' + esc(d.note) : ''}</div>
      ${i.status === 'partial' ? `<div class="progress"><div style="width:${Math.min(100, i.paid / d.amount * 100).toFixed(0)}%"></div></div>` : ''}</div>
    <div class="amt due-amt"><div class="due-val">${money(i.status === 'done' ? d.amount : i.remaining)}</div>
      <button type="button" class="badge st-${i.show}" data-due-badge="${esc(d.id)}" title="${i.status === 'done' ? 'Tap to reopen' : 'Tap to record a payment'}">${STATUS_LABEL[i.show]}</button></div></li>`;
}

function renderDues() {
  const mode = ui.mode.dues || 'list';
  const k = ui.dueKind, t = dueTotals(k), info = dueInfo();
  const top = modeSwitch('dues');
  if (mode === 'statement') return top + duesStatement();
  if (mode === 'pivot') return top + renderPivot('dues');
  const st = ui.dueStatus || 'all';
  const term = ui.dueTerm || 'all';
  const all = rows('Dues').filter(d => d.kind === k);
  const match = (d, s) => s === 'all' || (s === 'overdue' ? info[d.id].overdue : info[d.id].status === s);
  const termMatch = d => term === 'all' || (d.term || 'current') === term;
  const chip = s => `<button type="button" class="chip" data-duestatus="${s}" aria-pressed="${st === s}">${s === 'all' ? 'All' : STATUS_LABEL[s]} <span class="muted">${all.filter(d => match(d, s) && termMatch(d)).length}</span></button>`;
  const list = all.filter(d => match(d, st) && termMatch(d));
  const open = list.filter(d => info[d.id].status !== 'done').sort((a, b) =>
    (info[b.id].overdue - info[a.id].overdue) || String(a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.name.localeCompare(b.name));
  const done = list.filter(d => info[d.id].status === 'done').sort((a, b) => String(info[b.id].settledOn).localeCompare(info[a.id].settledOn));
  const group = (title, items, sumLabel, sum) => items.length ? `<div class="dayhead"><span>${title} · ${items.length}</span><span>${sumLabel} ${money(sum)}</span></div>
    <ul class="list">${items.map(dueLine).join('')}</ul>` : '';
  const curRemaining = sumBy(all.filter(d => (d.term || 'current') === 'current' && info[d.id].status !== 'done'), d => info[d.id].remaining);
  const fixRemaining = sumBy(all.filter(d => d.term === 'fixed' && info[d.id].status !== 'done'), d => info[d.id].remaining);
  return `${top}${loanSyncBanner()}<div class="chips">
    <button type="button" class="chip" data-duekind="receivable" aria-pressed="${k === 'receivable'}">${esc(L('due.receivable'))} (they owe you)</button>
    <button type="button" class="chip" data-duekind="payable" aria-pressed="${k === 'payable'}">${esc(L('due.payable'))} (you owe)</button></div>
  <div class="chips" style="margin-top:6px">
    <button type="button" class="chip" data-dueterm="all" aria-pressed="${term === 'all'}">সব ধরন (All)</button>
    <button type="button" class="chip" data-dueterm="current" aria-pressed="${term === 'current'}">চলিত (Current) · ${all.filter(d => (d.term || 'current') === 'current').length}</button>
    <button type="button" class="chip" data-dueterm="fixed" aria-pressed="${term === 'fixed'}">স্থায়ী (Fixed) · ${all.filter(d => d.term === 'fixed').length}</button>
  </div>
  <div class="grid3 three" style="margin-top:10px">
    <div class="stat"><div class="k">Total</div><div class="v">${money(t.total)}</div></div>
    <div class="stat"><div class="k">Remaining</div><div class="v warn">${money(t.due)}</div></div>
    <div class="stat"><div class="k">Paid / done</div><div class="v in">${money(t.done)}</div></div>
  </div>
  <div class="due-term-summary">
    <span>চলিত (Current): <b>${money(curRemaining)}</b></span>
    <span class="dot-sep">·</span>
    <span>স্থায়ী (Fixed): <b>${money(fixRemaining)}</b></span>
  </div>
  <div class="chips" style="margin-top:10px">${['all', 'due', 'partial', 'overdue', 'done'].map(chip).join('')}</div>
  <div class="card">${list.length ? group('Open', open, 'left', sumBy(open, d => info[d.id].remaining)) + group('Done', done, 'settled', sumBy(done, d => d.amount))
    : '<div class="empty">Nothing here. Tap + to add.</div>'}</div>
  <p class="small muted">Tap a badge to record a payment (it is added to your ${esc(L('tab.ledger'))}) or to reopen a done item. 🔗 = linked to ledger entries.</p>`;
}

function duesStatement() {
  const info = dueInfo(), per = {};
  rows('Dues').forEach(d => {
    const key = d.kind + '|' + d.name.trim().toLowerCase(), i = info[d.id];
    const p = per[key] = per[key] || { name: d.name.trim(), kind: d.kind, total: 0, paid: 0, left: 0, n: 0, open: 0 };
    p.total += Number(d.amount) || 0; p.paid += i.settled; p.left += i.remaining; p.n++; if (i.status !== 'done') p.open++;
  });
  const section = kind => {
    const list = Object.values(per).filter(p => p.kind === kind).sort((a, b) => b.left - a.left);
    return table([esc(L('due.name')), 'Entries', 'Total', 'Paid', 'Remaining', 'Status'],
      list.map(p => [esc(p.name), p.n, money(p.total), money(p.paid), `<b class="${p.left ? 'warn' : ''}">${money(p.left)}</b>`, p.open ? `<span class="badge st-due">${p.open} open</span>` : '<span class="badge st-done">Done</span>']),
      ['Total', sumBy(list, p => p.n), money(sumBy(list, p => p.total)), money(sumBy(list, p => p.paid)), money(sumBy(list, p => p.left)), '']);
  };
  const people = {};
  rows('Ledger').filter(t => ['lend', 'collect', 'borrow', 'repay'].includes(t.type)).forEach(t => {
    const who = (t.category || t.note || '(no name)').trim();
    const p = people[who.toLowerCase()] = people[who.toLowerCase()] || { who, lend: 0, collect: 0, borrow: 0, repay: 0, unlinked: 0 };
    p[t.type] += Number(t.amount) || 0; if (!t.dueId) p.unlinked++;
  });
  const pl = Object.values(people), net = p => (p.lend - p.collect) - (p.borrow - p.repay);
  const unlinked = sumBy(pl, p => p.unlinked);
  return `<div class="card"><h2>${esc(L('due.receivable'))} by person (they owe you)</h2>${section('receivable')}</div>
  <div class="card"><h2>${esc(L('due.payable'))} by person (you owe)</h2>${section('payable')}</div>
  <div class="card"><h2>Loan movements in ${esc(L('tab.ledger'))} (all time)</h2>
    ${table([esc(L('field.person')), typeLabel('lend'), typeLabel('collect'), typeLabel('borrow'), typeLabel('repay'), 'Net'],
      pl.map(p => [esc(p.who) + (p.unlinked ? ' <span class="small muted">· ' + p.unlinked + ' unlinked</span>' : ''), money(p.lend), money(p.collect), money(p.borrow), money(p.repay), `<b>${money(net(p))}</b>`]),
      ['Total', money(sumBy(pl, p => p.lend)), money(sumBy(pl, p => p.collect)), money(sumBy(pl, p => p.borrow)), money(sumBy(pl, p => p.repay)), money(sumBy(pl, net))])}
    <p class="small muted">Net above zero means they owe you. ${unlinked ? `${unlinked} older entries are not linked to a due yet – open the person in the List view to link them with one tap.` : ''}</p></div>`;
}

// ---------- More ----------
let booksLoaded = false;
async function ensureBooksLoaded() {
  if (booksLoaded) return;
  if (rows('Books').length > 0) { booksLoaded = true; return; }
  try {
    const res = await fetch('books_seed.json');
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) {
        list.forEach(b => {
          db.Books[b.id] = {
            id: b.id,
            sl: b.sl || 0,
            name: b.name || '',
            author: b.author || '',
            genre: b.genre || '',
            version: b.version || '',
            progress: b.progress || '',
            status: b.status || 'Want to read',
            deleted: !!b.deleted,
            updatedAt: stamp()
          };
          db.dirty.Books[b.id] = true;
        });
        persist();
        render();
      }
    }
  } catch (e) {
    console.warn('Could not load books seed:', e);
  }
  booksLoaded = true;
}

function renderMore() {
  if (ui.sub === 'purchases') return renderPurchases();
  if (ui.sub === 'books') { ensureBooksLoaded(); return renderBooks(); }
  if (ui.sub === 'namaz') return renderNamaz();
  if (ui.sub === 'settings') return renderSettings();
  if (ui.sub === 'profile') return renderProfile();
  if (ui.sub === 'data') return renderData();
  if (ui.sub === 'companion') {
    setTimeout(() => window.openQuickControl?.(), 50);
    return `${back}<div class="card" style="margin-top:12px;text-align:center;padding:24px">
      <h3>⚡ Quick Setup & Companion</h3>
      <p class="muted" style="margin:8px 0 16px">The quick control panel is open. You can close it anytime.</p>
      <button type="button" class="btn primary" data-action="open-quick-control">Re-open Quick Control</button>
    </div>`;
  }
  return `<div class="card menu">
    <a href="#more/profile"><span>👤 Profile & custom names</span><span class="muted">›</span></a>
    <a href="#more/books"><span>📚 Book List</span><span class="muted">${rows('Books').length} books ›</span></a>
    <a href="#more/purchases"><span>🛒 ${esc(L('sec.purchases'))}</span><span class="muted">${rows('Purchases').length} ›</span></a>
    <a href="#more/namaz"><span>🕌 ${esc(L('sec.namaz'))}</span><span class="muted">›</span></a>
    <a href="#more/companion" data-action="open-quick-control"><span>⚡ Quick Setup, Tools & Samples</span><span class="muted">›</span></a>
    <a href="#more/data"><span>⇅ Import / Export</span><span class="muted">›</span></a>
    <a href="#more/settings"><span>📊 Google Sheet Sync</span><span class="muted">${googleSyncState.user ? esc(googleSyncState.user.email || 'Connected') : 'Login with Google'} ›</span></a></div>`;
}
const back = `<a href="#more" class="small">‹ More</a>`;

// ---------- Books Library ----------
function renderBooks() {
  const all = rows('Books');
  const q = (ui.bookQ || '').toLowerCase().trim();
  const st = ui.bookStatus || 'all';

  const completeCount = all.filter(b => /complete|finished|পড়া শেষ/i.test(b.status || b.progress)).length;
  const readingCount = all.filter(b => /reading|চলছে|পড়তেছি/i.test(b.status || b.progress)).length;
  const notBuyCount = all.filter(b => /not buy|কিনতে হবে|wishlist/i.test(b.status || b.progress)).length;

  let filtered = all;
  if (q) {
    filtered = filtered.filter(b =>
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.author && b.author.toLowerCase().includes(q)) ||
      (b.genre && b.genre.toLowerCase().includes(q)) ||
      (b.version && b.version.toLowerCase().includes(q))
    );
  }
  if (st === 'complete') filtered = filtered.filter(b => /complete|finished|পড়া শেষ/i.test(b.status || b.progress));
  else if (st === 'reading') filtered = filtered.filter(b => /reading|চলছে|পড়তেছি/i.test(b.status || b.progress));
  else if (st === 'notbuy') filtered = filtered.filter(b => /not buy|কিনতে হবে|wishlist/i.test(b.status || b.progress));

  filtered.sort((a, b) => (Number(a.sl) || 9999) - (Number(b.sl) || 9999) || String(a.name).localeCompare(b.name));

  return `${back}
  <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
    <h2>📚 Book List (${all.length})</h2>
    <button type="button" class="btn primary" data-action="add-book" style="padding:6px 14px;font-size:13px">+ Add Book</button>
  </div>
  
  <div class="grid3 three" style="margin-top:8px">
    <div class="stat"><div class="k">Total Books</div><div class="v">${all.length}</div></div>
    <div class="stat"><div class="k">Completed</div><div class="v in">${completeCount}</div></div>
    <div class="stat"><div class="k">Reading / Wish</div><div class="v warn">${readingCount + notBuyCount}</div></div>
  </div>

  <div style="margin-top:10px;display:flex;gap:8px">
    <input type="search" placeholder="Search title, author, genre..." value="${esc(ui.bookQ || '')}" data-book-search style="margin:0;flex:1">
  </div>

  <div class="chips" style="margin-top:10px;overflow-x:auto">
    <button type="button" class="chip" data-bookstatus="all" aria-pressed="${st === 'all'}">All · ${all.length}</button>
    <button type="button" class="chip" data-bookstatus="reading" aria-pressed="${st === 'reading'}">📖 Reading · ${readingCount}</button>
    <button type="button" class="chip" data-bookstatus="complete" aria-pressed="${st === 'complete'}">✓ Complete · ${completeCount}</button>
    <button type="button" class="chip" data-bookstatus="notbuy" aria-pressed="${st === 'notbuy'}">🛒 Wishlist/Not Buy · ${notBuyCount}</button>
  </div>

  <div class="card" style="margin-top:12px">
    ${filtered.length ? `<ul class="list">${filtered.map(b => {
      const isComplete = /complete|finished/i.test(b.status || b.progress);
      const isReading = /reading/i.test(b.status || b.progress);
      const badgeCls = isComplete ? 'st-done' : isReading ? 'st-due' : 'st-partial';
      return `<li class="book-row">
        <div class="ico book-ico">📖</div>
        <div class="main book-main">
          <div class="t book-title">
            <span class="book-name">${esc(b.name)}</span>
            ${b.sl ? `<span class="book-sl">#${b.sl}</span>` : ''}
          </div>
          <div class="s book-meta">
            ${b.author ? `<span class="book-author">✍️ ${esc(b.author)}</span>` : ''}
            ${b.genre ? `<span class="book-genre">${esc(b.genre)}</span>` : ''}
            ${b.version ? `<span class="book-ver">${esc(b.version)}</span>` : ''}
          </div>
        </div>
        <div class="book-right">
          <span class="badge ${badgeCls} book-badge">
            ${esc(b.status || b.progress || 'Want to read')}
          </span>
          <div class="book-actions">
            <button type="button" class="btn ghost icon-btn" data-book-edit="${esc(b.id)}" title="Edit book">✏️</button>
            <button type="button" class="btn ghost icon-btn" data-book-del="${esc(b.id)}" title="Remove book" style="color:var(--out)">🗑️</button>
          </div>
        </div>
      </li>`;
    }).join('')}</ul>` : `<div class="empty" style="padding:24px">No books found. ${q ? 'Try clearing the search query.' : '<button type="button" class="btn primary" data-action="add-book" style="margin-top:8px">+ Add your first book</button>'}</div>`}
  </div>

  <div class="card" style="margin-top:14px;padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <span class="small muted">Book Library (${all.length} total)</span>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn ghost small" data-action="export-books-csv">📤 Export CSV</button>
        <button type="button" class="btn ghost small" data-action="import-books-csv">📥 Import CSV</button>
      </div>
    </div>
    <input type="file" id="importBooksFile" accept=".csv,text/csv" hidden>
  </div>`;
}

function bookForm(existing) {
  const b = existing ? Object.assign({}, existing) : { sl: rows('Books').length + 1, name: '', author: '', genre: '', version: 'Bengali', progress: '', status: 'Reading' };
  const allGenres = Array.from(new Set(rows('Books').map(x => x.genre).filter(Boolean)));
  
  openSheet(`<h3>${existing ? 'Edit Book' : 'Add New Book (বই যোগ করুন)'}</h3>
    <label for="bkName">Book Name / বইয়ের নাম</label>
    <input id="bkName" name="name" required value="${esc(b.name || '')}" placeholder="Book title" autofocus>
    
    <label for="bkAuthor">Author / লেখক</label>
    <input id="bkAuthor" name="author" value="${esc(b.author || '')}" placeholder="Author name">
    
    <div class="grid2">
      <div>
        <label for="bkGenre">Genre / ক্যাটাগরি</label>
        <input id="bkGenre" name="genre" list="genreList" value="${esc(b.genre || '')}" placeholder="Psychology, Islamic, etc.">
        <datalist id="genreList">${allGenres.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      </div>
      <div>
        <label for="bkVer">Version / Language</label>
        <input id="bkVer" name="version" value="${esc(b.version || 'Bengali')}" placeholder="Bengali, English, Arabic">
      </div>
    </div>

    <div class="grid2">
      <div>
        <label for="bkStatus">Reading Status</label>
        <select id="bkStatus" name="status">
          <option value="Reading" ${(b.status === 'Reading') ? 'selected' : ''}>📖 Reading (পড়তেছি)</option>
          <option value="Complete" ${(b.status === 'Complete') ? 'selected' : ''}>✓ Complete (পড়া শেষ)</option>
          <option value="Not Buy" ${(b.status === 'Not Buy') ? 'selected' : ''}>🛒 Not Buy (কেনা হয়নি)</option>
          <option value="Bought" ${(b.status === 'Bought') ? 'selected' : ''}>🛍️ Bought (কেনা হয়েছে)</option>
          <option value="Want to read" ${(b.status === 'Want to read') ? 'selected' : ''}>📋 Want to read</option>
        </select>
      </div>
      <div>
        <label for="bkSl">Serial No #</label>
        <input id="bkSl" name="sl" type="number" value="${esc(b.sl || '')}" placeholder="SL number">
      </div>
    </div>

    <label for="bkProg">Progress / Note (পৃষ্ঠা, চ্যাপ্টার বা নোট)</label>
    <input id="bkProg" name="progress" value="${esc(b.progress || '')}" placeholder="e.g. Page 45, Chapter 3, etc.">

    ${actions(!!existing)}`,
  fd => {
    const name = (fd.get('name') || '').trim();
    if (!name) return 'Enter the book name';
    const rec = {
      id: existing?.id || uid(),
      sl: Number(fd.get('sl')) || (existing ? existing.sl : rows('Books').length + 1),
      name,
      author: (fd.get('author') || '').trim(),
      genre: (fd.get('genre') || '').trim(),
      version: (fd.get('version') || '').trim(),
      status: fd.get('status') || 'Reading',
      progress: (fd.get('progress') || '').trim(),
      deleted: false,
    };
    upsert('Books', rec);
    commit();
    toast(existing ? 'Book updated' : 'Book added to library');
  },
  existing ? () => askConfirm(`Delete "${b.name}" from library?`, () => {
    softDelete('Books', existing.id);
    commit();
    toast('Book removed');
  }, 'Delete') : null);
}

function exportBooksCsv() {
  const list = rows('Books').sort((a, b) => (Number(a.sl) || 9999) - (Number(b.sl) || 9999));
  const headers = ['SL No', 'Book Name', 'Author', 'Genre', 'Version', 'Progress', 'Status'];
  const grid = [headers, ...list.map(b => [b.sl || '', b.name || '', b.author || '', b.genre || '', b.version || '', b.progress || '', b.status || ''])];
  saveFile(`books-library-${today()}.csv`, new Blob(['\uFEFF' + toCsv(grid)], { type: 'text/csv' }));
  toast('Books exported to CSV');
}

async function importBooksFromCsv(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const grid = parseCsv(text);
    if (!grid.length || grid.length < 2) { toast('CSV file is empty'); return; }
    const headers = grid[0].map(h => String(h || '').trim().toLowerCase());
    const findIdx = patterns => headers.findIndex(h => patterns.some(p => h.includes(p)));
    const slIdx = findIdx(['sl', 'serial', '#']);
    const nameIdx = findIdx(['book name', 'name', 'title', 'বই']);
    const authorIdx = findIdx(['author', 'writer', 'লেখক']);
    const genreIdx = findIdx(['genre', 'category', 'ধরন']);
    const verIdx = findIdx(['version', 'language', 'ভাষা', 'edition']);
    const progIdx = findIdx(['progress', 'অগ্রগতি']);
    const statIdx = findIdx(['status', 'অবস্থা']);

    if (nameIdx === -1) { toast('Could not find Book Name column in CSV'); return; }
    let count = 0;
    grid.slice(1).forEach((r, i) => {
      const name = String(r[nameIdx] || '').trim();
      if (!name) return;
      const sl = slIdx >= 0 ? (Number(r[slIdx]) || (rows('Books').length + count + 1)) : (rows('Books').length + count + 1);
      const id = 'bk-' + (sl || uid());
      db.Books[id] = {
        id,
        sl,
        name,
        author: authorIdx >= 0 ? String(r[authorIdx] || '').trim() : '',
        genre: genreIdx >= 0 ? String(r[genreIdx] || '').trim() : '',
        version: verIdx >= 0 ? String(r[verIdx] || '').trim() : 'Bengali',
        progress: progIdx >= 0 ? String(r[progIdx] || '').trim() : '',
        status: statIdx >= 0 ? String(r[statIdx] || '').trim() : 'Reading',
        deleted: false,
        updatedAt: stamp()
      };
      db.dirty.Books[id] = true;
      count++;
    });
    persist();
    render();
    toast(`Imported ${count} books from CSV`);
  } catch (err) {
    toast('Error reading CSV: ' + err.message);
  }
}

// ---------- Purchases ----------
function renderPurchases() {
  const mode = ui.mode.purchases || 'list';
  const scopeChip = `<div class="chips"><button type="button" class="chip" data-pall="0" aria-pressed="${!ui.pAll}">${monthLabel(ui.month)}</button>
    <button type="button" class="chip" data-pall="1" aria-pressed="${ui.pAll}">All time</button></div>`;
  const top = `${back}<div style="margin-top:10px">${monthBar()}</div>${modeSwitch('purchases')}`;
  if (mode === 'pivot') return top + renderPivot('purchases');
  const info = purchaseInfo();
  const list = rows('Purchases').filter(p => ui.pAll || monthOf(p.date) === ui.month).sort((a, b) => String(b.date).localeCompare(a.date));
  if (mode === 'statement') return top + scopeChip + purchasesStatement(list, info);
  const total = sumBy(list, p => p.price);
  return `${top}${scopeChip}
  <div class="stat" style="margin-bottom:10px"><div class="k">${list.length} items</div><div class="v">${money(total)}</div></div>
  <div class="card">${list.length ? `<ul class="list">${list.map(p => {
    const s = info[p.id]?.status;
    return `<li data-purchase-edit="${esc(p.id)}"><div class="ico">🛒</div><div class="main"><div class="t">${esc(p.name)}</div>
    <div class="s">${p.date ? dayLabel(p.date) : ''}${p.source ? ' · ' + esc(p.source) : ''}${p.category ? ' · ' + esc(p.category) : ''}${Number(p.charge) > 0 ? ' · + ' + esc(L('field.charge').toLowerCase()) + ' ' + money(p.charge) : ''}</div></div>
    <div class="amt"><div>${money(Number(p.price))}</div><span class="badge ${s === 'counted' ? 'due' : ''}" title="${esc(PURCHASE_STATUS[s])}">${s === 'counted' ? '+ ' + esc(typeLabel('expense')) : 'In ' + esc(L('tab.ledger'))}</span></div></li>`;
  }).join('')}</ul>` : '<div class="empty">No purchases in this period.</div>'}</div>
  <p class="small muted">Items marked <b>+ ${esc(typeLabel('expense'))}</b> are counted in your expenses and balances automatically, because no ledger expense with the same date and amount exists.</p>`;
}

function purchasesStatement(list, info) {
  const by = f => { const m = {}; list.forEach(p => { const k = f(p) || '—'; m[k] = (m[k] || 0) + (Number(p.price) || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const total = sumBy(list, p => p.price);
  const counted = sumBy(list.filter(p => info[p.id]?.status === 'counted'), p => p.price);
  const t2 = (title, entries) => `<div class="card"><h2>${title}</h2>${table(['', esc(L('pur.price')), 'Share'],
    entries.map(([k, v]) => [esc(k), money(v), total ? Math.round(v / total * 100) + '%' : '–']), ['Total', money(total), '100%'])}</div>`;
  const fees = sumBy(list, p => p.charge);
  return `${fees ? `<p class="small muted">Plus ${money(fees)} in ${esc(L('field.charge').toLowerCase())}s (delivery, fees) on these items.</p>` : ''}<div class="grid3 three">
    <div class="stat"><div class="k">Total</div><div class="v">${money(total)}</div></div>
    <div class="stat"><div class="k">Added to ${esc(typeLabel('expense').toLowerCase())}</div><div class="v warn">${money(counted)}</div></div>
    <div class="stat"><div class="k">Already in ${esc(L('tab.ledger').toLowerCase())}</div><div class="v in">${money(total - counted)}</div></div></div>
  <div style="height:12px"></div>
  ${t2('By ' + esc(L('field.category').toLowerCase()), by(p => p.category || 'Purchase'))}
  ${t2('By ' + esc(L('pur.shop').toLowerCase()), by(p => p.source))}
  ${t2('Paid from ' + esc(L('field.account').toLowerCase()), by(p => p.account))}
  ${t2('Expense status', by(p => PURCHASE_STATUS[info[p.id]?.status]))}`;
}

// ---------- Namaz ----------
function namazRecord(date) { const r = db.Namaz['nz-' + date]; return r && !r.deleted ? r : null; }
function renderNamaz() {
  const mode = ui.mode.namaz || 'list';
  const top = `${back}${modeSwitch('namaz', ['Tracker', 'Statement', 'Pivot'])}`;
  if (mode === 'pivot') return top + monthBar() + renderPivot('namaz');
  if (mode === 'statement') {
    const r = namazRows('month'), days = r.length / ALL_PRAYERS.length;
    const per = ALL_PRAYERS.map(p => { const done = r.filter(x => x.prayer === p && x.done).length; return [esc(L('prayer.' + p)), done, days, days ? Math.round(done / days * 100) + '%' : '–']; });
    const byDate = {}; r.filter(x => PRAYERS.fard.includes(x.prayer)).forEach(x => { byDate[x.date] = (byDate[x.date] || 0) + x.done; });
    const full = Object.values(byDate).filter(n => n === 5).length;
    const fardDone = r.filter(x => x.done && PRAYERS.fard.includes(x.prayer)).length;
    return `${top}${monthBar()}<div class="grid3 three">
      <div class="stat"><div class="k">${esc(L('nz.fard'))} prayed</div><div class="v">${fardDone}/${days * 5}</div></div>
      <div class="stat"><div class="k">Full days (5/5)</div><div class="v in">${full}</div></div>
      <div class="stat"><div class="k">${esc(L('nz.fard'))} missed</div><div class="v warn">${days * 5 - fardDone}</div></div></div>
      <div class="card" style="margin-top:12px"><h2>Per prayer · ${monthLabel(ui.month)}</h2>${table(['Prayer', 'Prayed', 'Days', 'Rate'], per)}</div>`;
  }
  const d = ui.namazDate, rec = namazRecord(d) || {};
  const ym = monthOf(d), days = daysInMonth(ym), first = new Date(ym + '-01T00:00').getDay();
  let cal = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="muted">${x}</div>`).join('') + '<div style="background:none"></div>'.repeat(first);
  for (let i = 1; i <= days; i++) {
    const date = `${ym}-${pad(i)}`, r = namazRecord(date), n = r ? PRAYERS.fard.filter(p => r[p]).length : 0, alpha = n / 5;
    cal += `<div data-namaz-day="${date}" data-tip="${dayLabel(date)}: ${n}/5" style="cursor:pointer;${n ? `background:rgba(15,118,110,${0.2 + alpha * 0.8});color:${alpha > .5 ? '#fff' : 'inherit'}` : ''}${date === d ? ';outline:2px solid var(--brand)' : ''}">${i}</div>`;
  }
  const btn = p => `<button type="button" data-prayer="${p}" aria-pressed="${!!rec[p]}">${esc(L('prayer.' + p))}</button>`;
  return `${top}
  ${renderJamatCard()}
  <div class="card"><label for="nzDate">${esc(L('field.date'))}</label><input id="nzDate" type="date" value="${d}" data-namaz-date>
    <h2 style="margin-top:14px">${esc(L('nz.fard'))} · ${PRAYERS.fard.filter(p => rec[p]).length}/5</h2><div class="namaz">${PRAYERS.fard.map(btn).join('')}</div>
    <h2 style="margin-top:14px">${esc(L('nz.extra'))}</h2><div class="namaz">${PRAYERS.extra.map(btn).join('')}</div></div>
  <div class="card"><h2>${monthLabel(ym)} · ${esc(L('nz.fard'))} completion</h2><div class="cal">${cal}</div></div>`;
}

// ---------- Profile ----------
function listEditor(key, items) {
  return `<div class="listedit" data-list="${key}">${items.map(v => `<div class="row"><input value="${esc(v)}" data-orig="${esc(v)}" aria-label="Name">
    <button type="button" class="btn ghost x" data-list-remove aria-label="Remove">✕</button></div>`).join('')}
    <div class="row"><input placeholder="+ Add new" data-orig="" aria-label="Add new"></div></div>`;
}
function renderProfile() {
  const p = profile();
  return `${back}
  <div class="card" style="margin-top:10px"><h2>Profile</h2>
    <label for="pfName">Your name</label><input id="pfName" value="${esc(p.name)}" placeholder="Shown on the home screen">
    <div class="grid2"><div><label for="pfCur">Currency symbol</label><input id="pfCur" value="${esc(p.currency)}" maxlength="4"></div>
    <div><label for="pfStart">Books start date</label><input id="pfStart" type="date" value="${esc(p.startDate)}"></div></div>
    <p class="small muted">Entries before the start date are already included in the opening balances, so they do not change balances (they still appear in monthly reports).</p></div>
  <div class="card">
    <h2>🎨 UI Design & Appearance</h2>
    <label style="display:block;margin-bottom:8px">Color Theme</label>
    <div class="theme-picker">
      ${[
        ['purple', 'Royal Violet', '#6a3de8', '#f26b3a'],
        ['emerald', 'Emerald Oasis', '#059669', '#d97706'],
        ['ocean', 'Ocean Blue', '#2563eb', '#0284c7'],
        ['midnight', 'Midnight Slate', '#475569', '#7c3aed'],
        ['sunset', 'Sunset Amber', '#ea580c', '#e11d48'],
        ['rose', 'Rose Bloom', '#db2777', '#9333ea'],
      ].map(([id, name, c1, c2]) => `
        <button type="button" class="theme-swatch ${p.theme === id ? 'active' : ''}" data-theme-set="${id}" title="${name}">
          <span class="swatch-dots" style="background:linear-gradient(135deg, ${c1}, ${c2})"></span>
          <span class="swatch-label">${name}</span>
        </button>
      `).join('')}
    </div>
    <label style="display:block;margin:14px 0 8px">Font & Typography</label>
    <div class="font-picker">
      ${[
        ['inter', 'Inter', 'Clean System Sans'],
        ['jakarta', 'Plus Jakarta', 'Geometric Sans'],
        ['outfit', 'Outfit', 'Modern Rounded'],
        ['roboto', 'Roboto', 'Google Sans'],
        ['serif', 'Playfair', 'Editorial Serif'],
        ['bengali', 'Noto Bengali', 'Bengali / English'],
        ['mono', 'JetBrains Mono', 'Tabular Monospace'],
      ].map(([id, name, desc]) => `
        <button type="button" class="font-chip ${p.font === id ? 'active' : ''}" data-font-set="${id}" title="${desc}">
          <b style="font-size:13px">${name}</b>
          <small class="muted" style="display:block;font-size:10px">${desc}</small>
        </button>
      `).join('')}
    </div>
  </div>
  <div class="card"><h2>${esc(typeLabel('income'))} sources</h2>${listEditor('incomeCats', p.incomeCats)}</div>
  <div class="card"><h2>${esc(typeLabel('expense'))} categories</h2>${listEditor('expenseCats', p.expenseCats)}
    <p class="small muted">Renaming a source or category also renames it on existing entries.</p></div>
  <div class="card"><h2>${esc(L('field.account'))}s & opening balances</h2>
    <ul class="list">${rows('Accounts').map(a => `<li data-acc-edit="${esc(a.id)}"><div class="ico">🏦</div><div class="main"><div class="t">${esc(a.name)}</div><div class="s">Opening ${money(Number(a.opening))}</div></div><div class="muted">Edit</div></li>`).join('')}</ul>
    <div class="actions"><button type="button" class="btn ghost" data-action="add-account">+ Add ${esc(L('field.account').toLowerCase())}</button></div></div>
  <div class="card"><h2>Field names</h2><p class="small muted">Rename anything you see in the app. Leave a box empty to use the default.</p>
    ${LABEL_GROUPS.map(([g, keys]) => `<details><summary>${g}</summary><div class="grid2">${keys.map(k => `<div><label>${esc(DEFAULT_LABELS[k])}</label>
      <input data-label="${k}" value="${esc(p.labels[k] || '')}" placeholder="${esc(DEFAULT_LABELS[k])}"></div>`).join('')}</div></details>`).join('')}</div>
  <div class="actions sticky"><button type="button" class="btn ghost" data-action="reset-labels">Reset names</button><button type="button" class="btn" data-action="save-profile">Save profile</button></div>`;
}

function saveProfileFromForm() {
  const readList = key => {
    const box = view.querySelector(`[data-list="${key}"]`), out = [], renames = {};
    box.querySelectorAll('input').forEach(inp => {
      const v = inp.value.trim(), o = inp.dataset.orig;
      if (!v) return;
      if (!out.includes(v)) out.push(v);
      if (o && o !== v) renames[o] = v;
    });
    return { out, renames };
  };
  const inc = readList('incomeCats'), exp = readList('expenseCats');
  const labels = {};
  view.querySelectorAll('[data-label]').forEach(i => { if (i.value.trim()) labels[i.dataset.label] = i.value.trim(); });
  let renamed = 0;
  const rename = (map, types) => rows('Ledger').forEach(t => {
    if (types.includes(t.type) && map[t.category]) { upsert('Ledger', Object.assign({}, t, { category: map[t.category] }), { batch: true }); renamed++; }
  });
  rename(inc.renames, ['income']); rename(exp.renames, ['expense']);
  rows('Purchases').forEach(p => { if (exp.renames[p.category]) { upsert('Purchases', Object.assign({}, p, { category: exp.renames[p.category] }), { batch: true }); renamed++; } });
  saveProfile({
    name: $('#pfName').value.trim(), currency: $('#pfCur').value.trim() || '৳', startDate: $('#pfStart').value,
    labels, incomeCats: inc.out, expenseCats: exp.out,
  });
  toast(renamed ? `Profile saved · ${renamed} entries renamed` : 'Profile saved');
}

// ---------- Settings (Google Sheets Sync) ----------
function renderSettings() {
  const u = googleSyncState.user;
  const sheet = googleSyncState.spreadsheet;
  const pending = pendingCount();
  const lastSyncStr = db.lastSync ? new Date(db.lastSync).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

  return `${back}
  <div class="card" style="margin-top:10px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:36px;height:36px;border-radius:10px;background:#0f9d58;color:#fff;display:grid;place-items:center;font-size:20px">📊</div>
      <div>
        <h2 style="margin:0;font-size:17px">Google Sheets Cloud Sync</h2>
        <span class="small muted">Live automatic backup & history</span>
      </div>
    </div>
    <p class="small muted" style="margin:6px 0 16px;line-height:1.5">
      Login with Google to automatically connect and sync your personal Google Sheet on your Google Drive. All your transactions, dues, purchases, and book library will be permanently preserved.
    </p>

    ${u ? `
      <!-- User Profile Card -->
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg);border-radius:14px;margin-bottom:14px;border:1px solid var(--line)">
        ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid var(--brand)">` : `<div style="width:42px;height:42px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700">${esc((u.displayName || u.email || 'G')[0].toUpperCase())}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.displayName || 'Google User')}</div>
          <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.email || '')}</div>
        </div>
        <button type="button" class="btn ghost small" data-action="google-signout" style="padding:6px 12px;font-size:12px">Sign out</button>
      </div>

      <!-- Google Sheet Connection Box -->
      <div class="gsheet-card">
        <div class="gsheet-head">
          <div class="gsheet-title">
            <div class="gsheet-ico">📄</div>
            <div style="min-width:0">
              <div style="line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sheet ? sheet.name : 'Personal Money Book & Ledger')}</div>
              <small class="muted" style="font-size:11px">Connected Google Sheet on Drive</small>
            </div>
          </div>
          <span class="gsheet-badge">${googleSyncState.hasToken ? '🟢 Connected' : '🟡 Re-auth'}</span>
        </div>

        <div class="gsheet-meta">
          <div>Status: <b>${googleSyncState.hasToken ? 'Auto-Sync Active' : 'Session expired – tap Reconnect'}</b></div>
          <div>Last synced: <b>${lastSyncStr}</b> · Pending changes: <b>${pending}</b></div>
          ${lastError ? `<div class="out" style="margin-top:6px;font-weight:600">${esc(lastError)}</div>` : ''}
        </div>

        <div class="gsheet-actions">
          ${sheet?.url ? `
            <a href="${esc(sheet.url)}" target="_blank" rel="noopener noreferrer" class="btn-gsheet-open">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              Open in Google Sheets ↗
            </a>
          ` : ''}
          <button type="button" class="btn" data-action="google-sync" style="background:var(--brand);color:#fff">
            🔄 Sync Now
          </button>
          ${!googleSyncState.hasToken ? `
            <button type="button" class="btn ghost" data-action="google-signin">
              🔑 Reconnect Access
            </button>
          ` : ''}
        </div>
      </div>
    ` : `
      <!-- Signed Out / Login State -->
      <div style="text-align:center;padding:18px 10px 14px">
        <div style="width:54px;height:54px;border-radius:16px;background:color-mix(in srgb, #0f9d58 15%, transparent);color:#0f9d58;display:grid;place-items:center;font-size:26px;margin:0 auto 12px">
          📊
        </div>
        <h3 style="margin:0 0 6px">Sign In to Preserve Historical Data</h3>
        <p class="small muted" style="max-width:440px;margin:0 auto 18px;line-height:1.5">
          One tap to connect your Google account. A dedicated spreadsheet will be set up automatically in your Google Drive and updated with every ledger transaction.
        </p>

        <button class="gsi-material-button" data-action="google-signin" type="button">
          <div class="gsi-material-button-icon">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="display: block;">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
          </div>
          <span class="gsi-material-button-contents">Sign in with Google</span>
        </button>

        ${lastError ? `<p class="small out" style="margin-top:12px">${esc(lastError)}</p>` : ''}
      </div>
    `}
  </div>

  <div class="card">
    <h2>📱 Local Device Storage</h2>
    <p class="small muted">Data is saved on this device first for instant offline use. Syncing pushes updates to Google Sheets.</p>
    <div class="actions">
      <button type="button" class="btn danger" data-action="wipe">Clear data on this device</button>
    </div>
  </div>`;
}

// ======================================================================
// Import / Export
// ======================================================================
const EXPORT_COLS = {
  Ledger: ['id', 'date', 'type', 'account', 'toAccount', 'amount', 'charge', 'category', 'note', 'dueId'],
  Dues: ['id', 'kind', 'name', 'amount', 'date', 'dueDate', 'doneDate', 'note', 'origin', 'originTxId', 'term'],
  Purchases: ['id', 'date', 'name', 'price', 'charge', 'category', 'source', 'account', 'inLedger', 'note'],
  Books: ['id', 'sl', 'name', 'author', 'genre', 'version', 'progress', 'status'],
  Namaz: ['id', 'date', ...ALL_PRAYERS],
  Accounts: ['id', 'name', 'opening'],
};
const SECTION_NAMES = {
  Ledger: () => L('tab.ledger'),
  Dues: () => L('tab.dues'),
  Purchases: () => L('sec.purchases'),
  Books: () => 'Books (বইয়ের তালিকা)',
  Namaz: () => L('sec.namaz'),
  Accounts: () => L('field.account') + 's'
};

function renderData() {
  const pv = ui.importPreview;
  return `${back}
  <div class="card" style="margin-top:10px"><h2>Export</h2>
    <div class="actions wrap">
      <button type="button" class="btn" data-action="export-xlsx">Excel workbook (all sections)</button>
      <button type="button" class="btn ghost" data-action="export-json">Full backup (JSON)</button></div>
    <label for="csvSec">One section as CSV</label>
    <div class="row"><select id="csvSec">${Object.keys(EXPORT_COLS).map(t => `<option value="${t}">${esc(SECTION_NAMES[t]())}</option>`).join('')}</select>
      <button type="button" class="btn ghost" data-action="export-csv" style="flex:none">Export CSV</button></div>
    <p class="small muted">The Excel file has one sheet per section plus a Summary sheet. You can edit it and import it back. Rows with the same id are updated, not duplicated.</p></div>
  <div class="card"><h2>Import</h2>
    <p class="small">Accepted files:</p>
    <ul class="small muted bullets">
      <li><b>Your monthly workbook</b> (like <i>10_October_2026.xlsx</i>): reads the Transection, Liabilities and Prod Log tabs</li>
      <li><b>Money Book Excel export</b>, or any .xlsx with sheets named Ledger / Dues / Purchases / Namaz / Accounts</li>
      <li><b>CSV</b> for one section (choose it below). The first row must be column names like date, type, account, amount, category, note</li>
      <li><b>JSON backup</b> from this app</li></ul>
    <label for="impSec">Section for CSV files</label>
    <select id="impSec">${Object.keys(EXPORT_COLS).map(t => `<option value="${t}">${esc(SECTION_NAMES[t]())}</option>`).join('')}</select>
    <div class="actions"><button type="button" class="btn" data-action="pick-import">Choose file…</button>
      <button type="button" class="btn ghost" data-action="sample">Load sample (Oct 2026)</button></div>
    <input type="file" id="importFile" accept=".xlsx,.csv,.json,application/json,text/csv" hidden>
    ${ui.importLog ? `<p class="small">${ui.importLog}</p>` : ''}</div>
  ${pv ? `<div class="card preview"><h2>Ready to import: ${esc(pv.file)}</h2>
    ${table(['Section', 'Rows'], Object.entries(pv.counts).filter(([, n]) => n).map(([t, n]) => [esc(SECTION_NAMES[t] ? SECTION_NAMES[t]() : t), n]))}
    ${pv.warnings.length ? `<p class="small warn">${pv.warnings.map(esc).join('<br>')}</p>` : ''}
    ${pv.opening ? `<label class="check"><input type="checkbox" id="impOpening" ${pv.openingDefault ? 'checked' : ''}> Use this workbook's opening balances and set books start date to ${dayLabel(pv.opening.startDate)}</label>
      <p class="small muted">Tick this for the first month you import. For later months, leave it unticked: balances then carry over from the earlier months.</p>` : ''}
    ${pv.purchaseOption ? `<label class="check"><input type="checkbox" id="impPurLedger" checked> Prod Log purchases are already inside the Transection cash-outs (don't count them twice)</label>
      <p class="small muted">Your sheet records daily cash-outs as one amount, so most purchases cannot be matched line by line. Untick only if the Prod Log items were never entered in the Transection tab.</p>` : ''}
    <div class="actions"><button type="button" class="btn ghost" data-action="cancel-import">Cancel</button><button type="button" class="btn" data-action="apply-import">Import ${pv.total} rows</button></div></div>` : ''}`;
}

// --- deterministic ids so re-importing the same file updates instead of duplicating ---
function hashId(prefix, s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507) + 0x9e3779b9; }
  return prefix + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
function idMaker(prefix) {
  const seen = {};
  return key => { seen[key] = (seen[key] || 0) + 1; return hashId(prefix, key + '#' + seen[key]); };
}

// --- CSV ---
function toCsv(rowsArr) { return rowsArr.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n'); }
function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(v => String(v).trim() !== ''));
}

// --- map a header row onto a section's fields (accepts field keys and your custom labels) ---
const FIELD_ALIASES = {
  date: ['date', 'field.date', 'started on'], type: ['type'], account: ['account', 'from', 'field.account', 'from account'], toAccount: ['toaccount', 'to', 'to account', 'field.toAccount'],
  amount: ['amount', 'field.amount', 'value'], category: ['category', 'field.category', 'source name', 'field.source', 'person', 'field.person'], note: ['note', 'notes', 'field.note', 'comment', 'comments'],
  kind: ['kind'], name: ['name', 'due.name', 'item', 'pur.item'], dueDate: ['duedate', 'due by', 'due.dueDate'], doneDate: ['donedate', 'settled on', 'due.doneDate'],
  charge: ['charge', 'fee', 'field.charge', 'service charge'],
  price: ['price', 'pur.price'], source: ['source', 'shop', 'pur.shop', 'shop / source'], inLedger: ['inledger', 'in ledger'], opening: ['opening', 'opening balance'], id: ['id'],
};
function headerMap(header, table) {
  const norm = s => String(s || '').trim().toLowerCase();
  const fields = EXPORT_COLS[table];
  return header.map(h => {
    const n = norm(h);
    return fields.find(f => {
      if (norm(f) === n) return true;
      if (table === 'Namaz' && ALL_PRAYERS.some(p => p === f && norm(L('prayer.' + p)) === n)) return true;
      return (FIELD_ALIASES[f] || []).some(a => a === n || (a.includes('.') && norm(L(a)) === n));
    }) || null;
  });
}
const typeFromText = v => {
  const n = String(v || '').trim().toLowerCase();
  return Object.keys(TYPES).find(k => k === n || typeLabel(k).toLowerCase() === n) || '';
};
const toBool = v => v === true || v === 1 || /^(true|yes|1|done|✓)$/i.test(String(v ?? '').trim());
const toNum = v => { if (typeof v === 'number') return v; const n = Number(String(v ?? '').replace(/[,৳$\s]/g, '')); return isFinite(n) ? n : NaN; };

/** Convert a 2D array (first row = header) into records for one table. */
function recordsFromGrid(table, grid, prefix, warnings) {
  if (!grid || grid.length < 2) return [];
  const map = headerMap(grid[0], table), mk = idMaker(prefix + table + '-'), out = [];
  const statusIdx = grid[0].findIndex(h => /^status$/i.test(String(h ?? '').trim()));
  if (!map.some(Boolean)) { warnings.push(`${table}: no recognised column names in the first row.`); return []; }
  grid.slice(1).forEach((r, i) => {
    if (!r) return;
    const o = {};
    map.forEach((f, j) => { if (f && r[j] !== undefined && r[j] !== null && String(r[j]).trim() !== '') o[f] = r[j]; });
    if (!Object.keys(o).length) return;
    ['date', 'dueDate', 'doneDate'].forEach(k => { if (k in o) o[k] = XLSX_LITE.toDate(o[k]) || String(o[k]); });
    ['amount', 'price', 'opening', 'charge'].forEach(k => { if (k in o) o[k] = toNum(o[k]); });
    ['note', 'category', 'name', 'source', 'account', 'toAccount'].forEach(k => { if (k in o) o[k] = String(o[k]).trim(); });
    if (table === 'Ledger') {
      o.type = typeFromText(o.type) || (o.toAccount ? 'transfer' : 'expense');
      if (!(o.amount > 0) || !o.date) { warnings.push(`Ledger row ${i + 2}: needs a date and an amount above 0 – skipped.`); return; }
      o.account = o.account || accountNames()[0] || 'Cash';
    }
    if (table === 'Dues') { o.kind = /pay/i.test(String(o.kind || '')) || String(o.kind || '').toLowerCase() === L('due.payable').toLowerCase() ? 'payable' : 'receivable'; if (!o.name || isNaN(o.amount)) return;
      if (statusIdx >= 0 && !o.doneDate && /^(done|paid|settled)$/i.test(String(r[statusIdx] ?? '').trim())) o.doneDate = o.date || today(); }
    if (table === 'Purchases') { o.inLedger = toBool(o.inLedger); if (!o.name || isNaN(o.price)) return; }
    if (table === 'Namaz') { if (!o.date) return; ALL_PRAYERS.forEach(p => { o[p] = toBool(o[p]); }); o.id = 'nz-' + o.date; }
    if (table === 'Accounts') { if (!o.name) return; o.opening = isNaN(o.opening) ? 0 : o.opening; const ex = rows('Accounts').find(a => a.name.toLowerCase() === o.name.toLowerCase()); o.id = o.id || (ex ? ex.id : 'acc-' + o.name.toLowerCase().replace(/\W+/g, '-')); }
    o.id = o.id ? String(o.id) : mk(JSON.stringify(EXPORT_COLS[table].map(f => o[f] ?? '')));
    o.deleted = false;
    out.push(o);
  });
  return out;
}

/** Your original monthly workbook format (Transection / Liabilities / Prod Log). */
function recordsFromMonthlyWorkbook(wb, warnings) {
  const T = wb['Transection'];
  const cell = (sh, r, c) => (sh && sh[r - 1] ? sh[r - 1][c - 1] : undefined);
  const ACC = Object.fromEntries(['Cash', 'EBL', 'NRB', 'Bkash', 'Nagad', 'DBBL', ...accountNames()].map(a => [a.toLowerCase(), a]));
  const split = tag => { if (!tag) return [null, null]; const [a, ...d] = String(tag).trim().split('_'); return [ACC[a.toLowerCase()] || null, d.join('_').toLowerCase()]; };
  const recs = { Ledger: [], Dues: [], Purchases: [], Accounts: [] };
  const mk = idMaker('wb-');
  const accounts = [];
  for (let r = 3; r <= 8; r++) { const n = cell(T, r, 7); if (n && ACC[String(n).toLowerCase()]) accounts.push({ name: ACC[String(n).toLowerCase()], opening: Math.round((toNum(cell(T, r, 8)) || 0) * 100) / 100 }); }
  const dates = [];
  for (let r = 3; r <= (T?.length || 0); r++) { const d = XLSX_LITE.toDate(cell(T, r, 11)); if (d) dates.push(d); }
  const month = dates.length ? monthOf(dates.sort()[dates.length - 1]) : monthOf(today());
  for (let r = 3; r <= (T?.length || 0); r++) {
    const [acc, dir] = split(cell(T, r, 12)), amt = Math.round(toNum(cell(T, r, 13)) * 100) / 100;
    if (!acc || !(amt > 0)) continue;
    const date = XLSX_LITE.toDate(cell(T, r, 11)) || month + '-01';
    const purpose = String(cell(T, r, 14) ?? '').trim(), pl = purpose.toLowerCase();
    const [pacc, pdir] = split(purpose);
    const rec = { date, account: acc, toAccount: '', amount: amt, category: '', note: String(cell(T, r, 16) ?? '').trim(), deleted: false };
    if (pacc && pdir === 'in' && dir === 'out') Object.assign(rec, { type: 'transfer', toAccount: pacc });
    else if (pacc && pdir === 'out' && dir === 'in') Object.assign(rec, { type: 'transfer', account: pacc, toAccount: acc });
    else if (pl === 'expense') Object.assign(rec, { type: 'expense', category: 'General' });
    else if (pl === 'service charge') Object.assign(rec, { type: 'expense', category: 'Service Charge' });
    else if (pl === 'receivable_out') Object.assign(rec, { type: 'lend', category: rec.note });
    else if (pl === 'receivable_in') Object.assign(rec, { type: 'collect', category: rec.note });
    else if (pl === 'payable_in') Object.assign(rec, { type: 'borrow', category: rec.note });
    else if (pl === 'payable_out') Object.assign(rec, { type: 'repay', category: rec.note });
    else if (dir === 'in') Object.assign(rec, { type: 'income', category: purpose || 'Other' });
    else Object.assign(rec, { type: 'expense', category: purpose || 'General' });
    rec.id = mk(['L', rec.date, rec.type, rec.account, rec.toAccount, rec.amount, rec.category].join('|'));
    recs.Ledger.push(rec);
  }
  const Lb = wb['Liabilities'];
  if (Lb) for (let r = 5; r <= 40; r++) {
    [['receivable', 3], ['payable', 10]].forEach(([kind, c]) => {
      const name = cell(Lb, r, c), amt = toNum(cell(Lb, r, c + 1));
      if (!name || typeof name !== 'string' || !isFinite(amt) || name === 'Total') return;
      const rec = { kind, name: name.trim(), amount: Math.round(amt * 100) / 100, dueDate: '', doneDate: XLSX_LITE.toDate(cell(Lb, r, c + 3)), note: '', deleted: false };
      rec.id = mk(['D', kind, rec.name, rec.amount, month].join('|'));
      recs.Dues.push(rec);
    });
  }
  const P = wb['Prod Log'];
  if (P) P.slice(1).forEach(row => {
    if (!row || !row[0] || !row[1]) return;
    const rec = { date: XLSX_LITE.toDate(row[0]), name: String(row[1]).trim(), price: toNum(row[2]) || 0, source: String(row[3] ?? '').trim(), note: String(row[4] ?? '').trim(), category: 'Purchase', account: '', inLedger: false, deleted: false };
    rec.id = mk(['P', rec.date, rec.name, rec.price].join('|'));
    recs.Purchases.push(rec);
  });
  if (!recs.Ledger.length) warnings.push('No transactions found in the Transection tab (columns K–P).');
  return { recs, opening: accounts.length ? { accounts, startDate: month + '-01' } : null };
}

async function prepareImport(file) {
  const warnings = [];
  let recs = {}, opening = null, wbFormat = false;
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const data = JSON.parse(await file.text());
    TABLES.forEach(t => { if (Array.isArray(data[t])) recs[t] = data[t].filter(r => r && r.id).map(r => normalize(t, r)); });
  } else if (name.endsWith('.xlsx')) {
    const wb = await XLSX_LITE.read(await file.arrayBuffer());
    if (wb['Transection']) { ({ recs, opening } = recordsFromMonthlyWorkbook(wb, warnings)); wbFormat = true; }
    else {
      const sheetFor = t => Object.keys(wb).find(n => [t.toLowerCase(), SECTION_NAMES[t]().toLowerCase()].includes(n.trim().toLowerCase()));
      Object.keys(EXPORT_COLS).forEach(t => { const s = sheetFor(t); if (s) recs[t] = recordsFromGrid(t, wb[s].map(r => r || []), 'x-', warnings); });
      if (!Object.keys(recs).length) {
        const first = Object.keys(wb)[0], t = $('#impSec').value;
        warnings.push(`No sheet named after a section – read "${first}" as ${SECTION_NAMES[t]()}.`);
        recs[t] = recordsFromGrid(t, (wb[first] || []).map(r => r || []), 'x-', warnings);
      }
    }
  } else {
    const t = $('#impSec').value;
    recs[t] = recordsFromGrid(t, parseCsv(await file.text()), 'c-', warnings);
  }
  const counts = Object.fromEntries(Object.entries(recs).map(([t, l]) => [t, l.length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) throw new Error(warnings[0] || 'Nothing to import in that file');
  ui.importPreview = { file: file.name, recs, counts, total, warnings: warnings.slice(0, 6), opening, openingDefault: !rows('Ledger').length, purchaseOption: !!(wbFormat && recs.Purchases?.length) };
  ui.importLog = '';
  render();
}

function applyImport() {
  const pv = ui.importPreview; if (!pv) return;
  let n = 0;
  const purInLedger = pv.purchaseOption && $('#impPurLedger')?.checked;
  Object.entries(pv.recs).forEach(([t, list]) => list.forEach(r => {
    const rec = Object.assign({}, r);
    if (t === 'Purchases' && purInLedger) rec.inLedger = true;
    upsert(t, rec, { batch: true }); n++;
  }));
  if (pv.opening && $('#impOpening')?.checked) {
    pv.opening.accounts.forEach(a => {
      const ex = rows('Accounts').find(x => x.name.toLowerCase() === a.name.toLowerCase());
      upsert('Accounts', Object.assign({}, ex || { id: 'acc-' + a.name.toLowerCase() }, { name: a.name, opening: a.opening, deleted: false }), { batch: true });
    });
    saveProfile({ startDate: pv.opening.startDate }, { batch: true });
  }
  ui.importPreview = null;
  ui.importLog = `✓ Imported ${n} rows from ${esc(pv.file)}.`;
  const lastDate = (pv.recs.Ledger || []).map(r => r.date).sort().pop();
  if (lastDate) ui.month = monthOf(lastDate);
  persist(); render(); scheduleSync();
  toast(`Imported ${n} rows`);
}

function exportRows(t) {
  const cols = EXPORT_COLS[t];
  if (t === 'Dues') {
    const info = dueInfo();
    return [[...cols, 'status', 'paid', 'remaining'], ...rows(t).sort((a, b) => String(a.name).localeCompare(b.name))
      .map(r => [...cols.map(c => r[c] ?? ''), STATUS_LABEL[info[r.id].show], info[r.id].settled, info[r.id].remaining])];
  }
  return [cols, ...rows(t).sort((a, b) => String(a.date || a.name || '').localeCompare(String(b.date || b.name || ''))).map(r => cols.map(c => r[c] ?? ''))];
}
function summaryRows() {
  const months = [...new Set(allTx().map(t => monthOf(t.date)))].filter(Boolean).sort();
  return [['Month', typeLabel('income'), typeLabel('expense'), 'Net', 'From ' + L('sec.purchases'), typeLabel('lend'), typeLabel('collect'), typeLabel('borrow'), typeLabel('repay')],
    ...months.map(m => { const s = monthStats(m); return [m, s.income, s.expense, s.net, s.purchases, s.lent, s.collected, s.borrowed, s.repaid].map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v); }),
    [], ['Account', 'Balance now'], ...Object.entries(balancesAt()).map(([k, v]) => [k, Math.round(v * 100) / 100])];
}

let downloadsNs;
async function saveFile(name, blob) {
  // Inside the Claude preview, files go through its downloads permission; everywhere else a normal download.
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.Filesystem) {
    try {
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
      const { uri } = await cap.Plugins.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      if (cap.Plugins.Share) await cap.Plugins.Share.share({ title: name, url: uri, dialogTitle: 'Save or share ' + name }).catch(() => {});
      toast('Saved ' + name);
    } catch (e) { toast('Could not save: ' + (e?.message || e)); }
    return;
  }
  if (downloadsNs === undefined) downloadsNs = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (downloadsNs) {
    try { await downloadsNs.save({ filename: name, data: blob }); toast('Saved ' + name); }
    catch (e) { if (e?.code !== 'declined') toast('Could not save: ' + (e?.message || e?.code || e)); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ======================================================================
// Rendering & routing
// ======================================================================
function render() {
  applyThemeAndFont();
  const [tab, sub] = (location.hash.slice(1) || 'home').split('/');
  const tabs = ['home', 'ledger', 'dues', 'more'];
  ui.tab = tabs.includes(tab) ? tab : 'home'; ui.sub = sub || '';
  document.querySelectorAll('.tabs a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === ui.tab);
    a.querySelector('b').textContent = L('tab.' + a.dataset.tab);
  });
  const nm = profile().name, h = new Date().getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#title').textContent = ui.tab === 'home' ? `${greet}${nm ? ', ' + nm.split(' ')[0] : ''} ${h >= 5 && h < 17 ? '☀️' : '🌙'}`
    : ui.tab === 'more' && ui.sub ? ({ purchases: L('sec.purchases'), books: 'Book List (বইয়ের তালিকা)', namaz: L('sec.namaz'), profile: 'Profile', data: 'Import / Export', settings: 'Sync', companion: 'Quick Tools' }[ui.sub] || L('tab.more')) : L('tab.' + ui.tab);
  $('#subtitle').textContent = ui.tab === 'home' ? 'Today, ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : ui.tab === 'ledger' ? monthLabel(ui.month) : ui.tab === 'dues' ? `${L('due.receivable')} & ${L('due.payable')}` : ui.tab === 'more' && ui.sub === 'books' ? `${rows('Books').length} books in library` : L('app.title');
  $('#avatar').textContent = nm ? nm.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : '👤';
  document.title = L('app.title');
  const fn = { home: renderHome, ledger: renderLedger, dues: renderDues, more: renderMore }[ui.tab];
  const focusSearch = document.activeElement?.hasAttribute?.('data-search');
  view.innerHTML = fn();
  if (focusSearch) { const s = view.querySelector('[data-search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  updateSyncPill();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ======================================================================
// Forms (bottom sheet)
// ======================================================================
const dlg = $('#sheet'), form = $('#sheetForm');
let confirmCb = null;
function openSheet(html, onSubmit, onDelete) {
  form.onclick = null; form.oninput = null; form.onchange = null;
  form.innerHTML = html;
  form.onsubmit = e => {
    e.preventDefault();
    if (e.submitter?.value === 'cancel') { dlg.close(); return; }
    const err = onSubmit(new FormData(form));
    if (err) { toast(err); return; }
    dlg.close();
  };
  const del = form.querySelector('[data-delete]');
  if (del) del.onclick = () => askConfirm('Delete this entry?', () => { onDelete(); toast('Deleted'); });
  if (!dlg.open) dlg.showModal();
  form.querySelector('[autofocus]')?.focus();
}
/** In-page confirmation (works where window.confirm is blocked). */
function askConfirm(msg, onYes, yesLabel = 'Yes, continue') {
  confirmCb = onYes;
  form.onclick = null;
  form.innerHTML = `<h3>Please confirm</h3><p>${esc(msg)}</p><div class="actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="yes">${esc(yesLabel)}</button></div>`;
  form.onsubmit = e => { e.preventDefault(); dlg.close(); if (e.submitter?.value === 'yes' && confirmCb) confirmCb(); confirmCb = null; };
  if (!dlg.open) dlg.showModal();
}
const opts = (list, sel) => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const actions = isEdit => `<div class="actions">${isEdit ? '<button type="button" class="btn danger" data-delete>Delete</button>' : ''}
  <button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="save">Save</button></div>`;

// Allows typing "250+120+60" like spreadsheet cells.
/** Charge input used by every money form. */
const chargeInput = (id, val) => `<label for="${id}">${esc(L('field.charge'))} (${esc(profile().currency)} or %) <span class="muted">· optional</span></label>
  <input id="${id}" name="charge" inputmode="decimal" value="${esc(val || '')}" placeholder="0 – e.g. 18.50 or 1.85%">
  <p class="hintbox small" data-charge-info hidden></p>`;
/** Live preview of what the charge does to the account(s). get() → {account, to, sign} (sign 0 = transfer). */
function wireCharge(get) {
  const info = form.querySelector('[data-charge-info]'); if (!info) return;
  const upd = () => {
    const amtEl = form.querySelector('[name="amount"]') || form.querySelector('[name="price"]');
    const amt = evalAmount(amtEl?.value) || 0, ch = evalCharge(form.charge.value, amt), g = get();
    if (isNaN(ch)) { info.hidden = false; info.innerHTML = '<span class="out">Charge must be a number or a % like 1.85%</span>'; return; }
    if (!ch && g.sign !== 0) { info.hidden = true; return; }
    const acc = esc(g.account || '—');
    const main = g.sign === 0 ? `${acc}: <b class="out">−${money(amt + ch)}</b> · ${esc(g.to || '')}: <b class="in">+${money(amt)}</b>`
      : g.sign < 0 ? `${acc}: <b class="out">−${money(amt + ch)}</b> (${money(amt)} + ${money(ch)} ${esc(L('field.charge').toLowerCase())})`
        : `${acc}: <b class="in">+${money(amt - ch)}</b> (${money(amt)} − ${money(ch)} ${esc(L('field.charge').toLowerCase())})`;
    info.hidden = false;
    info.innerHTML = main + (ch ? `<br>${money(ch)} is recorded as <b>${esc(L('cat.charge'))}</b> expense.` : '');
  };
  form.oninput = upd; form.onchange = upd; upd();
}
/** Charge as a number, or a percentage of the amount ("1.85%"). Empty = 0. */
function evalCharge(v, amount) {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return 0;
  const m = /^([\d.]+)\s*%$/.exec(s);
  if (m) return Math.round(Number(m[1]) * amount) / 100;
  return evalAmount(s);
}
function evalAmount(v) {
  const s = String(v || '').replace(/,/g, '').trim();
  if (!/^[\d.+\-*/() ]+$/.test(s)) return NaN;
  try { return Math.round(Function(`"use strict";return (${s})`)() * 100) / 100; } catch { return NaN; }
}

function openDueOptions(kind, keepId) {
  const info = dueInfo();
  return rows('Dues').filter(d => d.kind === kind && (info[d.id].status !== 'done' || d.id === keepId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => `<option value="${esc(d.id)}" ${d.id === keepId ? 'selected' : ''}>${esc(d.name)} · ${money(info[d.id].remaining)} left</option>`).join('');
}

function txForm(existing, preset = {}) {
  const t = existing ? Object.assign({}, existing) : Object.assign({ type: ui.filter in TYPES ? ui.filter : 'expense', date: monthOf(today()) === ui.month ? today() : ui.month + '-01', account: accountNames()[0] || 'Cash' }, preset);
  let type = t.type;
  const draw = () => {
    const isT = type === 'transfer', p = profile(), accs = accountNames();
    const sk = SETTLE_KIND[type], lk = LOAN_KIND[type];
    const catField = type === 'income'
      ? `<div><label for="fCat">${esc(L('field.source'))}</label><input id="fCat" name="category" list="catList" value="${esc(t.category || p.incomeCats[0] || '')}" placeholder="Choose or type"><datalist id="catList">${p.incomeCats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>`
      : type === 'expense'
        ? `<div><label for="fCat">${esc(L('field.category'))}</label><input id="fCat" name="category" list="catList" value="${esc(t.category || '')}" placeholder="Choose or type"><datalist id="catList">${p.expenseCats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>`
        : `<div><label for="fWho">${esc(L('field.person'))}</label><input id="fWho" name="category" value="${esc(t.category || '')}" placeholder="Name" ${lk ? 'required' : ''}></div>`;
    const prevDue = existing?.dueId && db.Dues[existing.dueId];
    const link = sk ? `<label for="fDue">Settles a ${esc(L('due.' + sk).toLowerCase())}?</label>
        <select id="fDue" name="dueId"><option value="">— No —</option>${openDueOptions(sk, t.dueId)}</select>`
      : lk ? `<p class="hintbox small">🔗 ${prevDue && prevDue.originTxId === existing.id ? 'Linked to' : 'Creates'} a <b>${esc(L('due.' + lk).toLowerCase())}</b> for this person in ${esc(L('tab.dues'))}. Record their ${lk === 'receivable' ? 'repayments' : 'repayments to them'} there or with ${esc(typeLabel(lk === 'receivable' ? 'collect' : 'repay'))}.</p>` : '';
    const purchaseBox = type === 'expense'
      ? `<label class="check" style="margin-top:10px;font-weight:600;display:flex;align-items:center;gap:8px;padding:4px 0">
           <input type="checkbox" id="fInPurchase" name="inPurchase" ${(t.inPurchase || t.purchaseId || (existing?.purchaseId && db.Purchases[existing.purchaseId])) ? 'checked' : ''}>
           <span>🛒 Record in Purchase History (পার্সেস হিস্ট্রিতে যোগ করুন)</span>
         </label>` : '';
    form.querySelector('#txDyn').innerHTML = `<p class="small muted" style="margin:6px 0 0">${TYPES[type].hint}</p>
      <div class="grid2"><div><label for="fAcc">${isT ? 'From ' + esc(L('field.account').toLowerCase()) : esc(L('field.account'))}</label><select id="fAcc" name="account">${opts(accs, t.account)}</select></div>
      ${isT ? `<div><label for="fTo">${esc(L('field.toAccount'))}</label><select id="fTo" name="toAccount">${opts(accs, t.toAccount || accs.find(a => a !== t.account))}</select></div>` : catField}</div>${link}
      ${chargeInput('fCharge', t.charge)}
      ${purchaseBox}`;
    wireCharge(() => ({ account: form.account.value, to: form.toAccount?.value, sign: TYPES[type].sign }));
    form.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', b.dataset.type === type));
    const sel = form.querySelector('#fDue');
    if (sel) sel.onchange = () => {
      t.dueId = sel.value;
      const d = db.Dues[sel.value]; if (!d) return;
      if (!form.amount.value) form.amount.value = dueInfo()[d.id].remaining;
      if ((type === 'collect' || type === 'repay') && form.category && !form.category.value) form.category.value = d.name;
    };
  };
  openSheet(`<h3>${existing ? 'Edit' : 'New'} transaction</h3>
    <div class="seg" role="group" aria-label="Type">${Object.keys(TYPES).map(k => `<button type="button" data-type="${k}">${esc(typeLabel(k))}</button>`).join('')}</div>
    <label for="fAmt">${esc(L('field.amount'))} (${esc(profile().currency)})</label><input id="fAmt" class="amount-input" name="amount" inputmode="decimal" required value="${t.amount !== undefined ? esc(t.amount) : ''}" placeholder="0" autofocus>
    <div id="txDyn"></div>
    <label for="fDate">${esc(L('field.date'))}</label><input id="fDate" type="date" name="date" required value="${esc(t.date)}">
    <label for="fNote">${esc(L('field.note'))}</label><input id="fNote" name="note" value="${esc(t.note || '')}" placeholder="Optional (client, shop, reason…)">
    ${actions(!!existing)}`,
  fd => {
    const amount = evalAmount(fd.get('amount'));
    if (!(amount > 0)) return 'Enter a valid amount';
    if (type === 'transfer' && fd.get('account') === fd.get('toAccount')) return 'Pick two different accounts';
    const person = (fd.get('category') || '').trim();
    if (LOAN_KIND[type] && !person) return 'Enter the person’s name';
    const charge = evalCharge(fd.get('charge'), amount);
    if (isNaN(charge) || charge < 0) return 'Charge must be 0 or more (a number or a % like 1.85%)';
    const inPurchase = type === 'expense' && (fd.get('inPurchase') === 'on' || fd.get('inPurchase') === 'true' || !!form.querySelector('#fInPurchase')?.checked);
    const rec = {
      id: existing?.id || uid(), type, date: fd.get('date'), account: fd.get('account'),
      toAccount: type === 'transfer' ? fd.get('toAccount') : '', amount, charge: charge || '',
      category: type === 'transfer' ? '' : person || (type === 'expense' ? 'General' : ''),
      note: (fd.get('note') || '').trim(), dueId: SETTLE_KIND[type] ? (fd.get('dueId') || '') : '',
      inPurchase: !!inPurchase,
      purchaseId: inPurchase ? (existing?.purchaseId || ('pur-' + (existing?.id || uid()))) : '',
      deleted: false,
    };
    const prevDue = existing?.dueId && db.Dues[existing.dueId];
    const wasOrigin = !!(prevDue && !prevDue.deleted && prevDue.originTxId === existing.id);
    if (LOAN_KIND[type]) {
      rec.dueId = wasOrigin && prevDue.kind === LOAN_KIND[type] ? prevDue.id : 'due-' + rec.id;
      upsert('Ledger', rec, { batch: true });
      const ex = db.Dues[rec.dueId];
      upsert('Dues', Object.assign({ dueDate: '', doneDate: '', note: rec.note }, ex && !ex.deleted ? ex : {},
        { id: rec.dueId, kind: LOAN_KIND[type], name: person, amount, date: rec.date, origin: 'loan', originTxId: rec.id, deleted: false }), { batch: true });
    } else upsert('Ledger', rec, { batch: true });

    if (inPurchase) {
      upsert('Purchases', {
        id: rec.purchaseId,
        name: rec.note || rec.category || 'Expense item',
        price: rec.amount,
        charge: rec.charge || '',
        date: rec.date,
        category: rec.category || 'Purchase',
        account: rec.account || '',
        source: '',
        note: rec.note ? (rec.note + ' (From Ledger Expense)') : 'From Ledger Expense',
        inLedger: true,
        ledgerTxId: rec.id,
        deleted: false,
      }, { batch: true });
    } else if (existing?.purchaseId && db.Purchases[existing.purchaseId]) {
      softDelete('Purchases', existing.purchaseId);
    }

    if (wasOrigin && rec.dueId !== prevDue.id) detachOrigin(prevDue);
    commit();
    const d = rec.dueId && db.Dues[rec.dueId];
    toast(d && SETTLE_KIND[type] ? (dueInfo()[d.id].status === 'done' ? `Saved · ${d.name} is now Done` : `Saved · ${money(dueInfo()[d.id].remaining)} left for ${d.name}`)
      : d ? `Saved · ${L('due.' + d.kind)} updated for ${d.name}` : (inPurchase ? 'Saved · Added to Ledger & Purchase History' : 'Saved'));
  }, () => deleteTx(existing));
  form.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
    t.account = form.account?.value || t.account;
    if (form.charge) t.charge = form.charge.value;
    if (form.category) t.category = (type === b.dataset.type) ? form.category.value : '';
    if (SETTLE_KIND[b.dataset.type] !== SETTLE_KIND[type]) t.dueId = '';
    type = b.dataset.type; draw();
  });
  draw();
}

function dueForm(existing, kindArg) {
  const kind = existing?.kind || kindArg || ui.dueKind;
  const d = existing ? Object.assign({}, existing) : { kind, date: today(), term: 'current' };
  const info = existing ? dueInfo()[existing.id] : null;
  let status = info && info.status === 'done' ? 'done' : 'due';
  const origin = existing && d.originTxId && db.Ledger[d.originTxId] && !db.Ledger[d.originTxId].deleted ? db.Ledger[d.originTxId] : null;
  const loanLbl = kind === 'receivable' ? `I lent money now – records a ${typeLabel('lend')} from my account` : `I borrowed money now – records a ${typeLabel('borrow')} into my account`;
  const billLbl = kind === 'receivable' ? 'They owe me for work / an invoice – no money moved yet' : 'I owe a bill (rent, utility, card…) – no money moved yet';
  openSheet(`<h3>${existing ? 'Edit' : 'New'} ${esc(L('due.' + kind).toLowerCase())}</h3>
    <label for="dName">${esc(L('due.name'))}</label><input id="dName" name="name" required value="${esc(d.name || '')}" autofocus>
    <label for="dAmt">${esc(L('field.amount'))} (${esc(profile().currency)})</label><input id="dAmt" name="amount" inputmode="decimal" required value="${esc(d.amount ?? '')}">
    <div class="grid2"><div><label for="dDate">Started on</label><input id="dDate" type="date" name="date" value="${esc(d.date || '')}"></div>
    <div><label for="dDue">${esc(L('due.dueDate'))}</label><input id="dDue" type="date" name="dueDate" value="${esc(d.dueDate || '')}"></div></div>
    
    <label>ধরন / Category</label>
    <div class="seg" role="group" aria-label="Due Category">
      <button type="button" data-term="current" aria-pressed="${(d.term || 'current') === 'current'}">চলিত (Current)</button>
      <button type="button" data-term="fixed" aria-pressed="${d.term === 'fixed'}">স্থায়ী (Fixed)</button>
    </div>
    <input type="hidden" name="term" id="dTerm" value="${esc(d.term || 'current')}">

    <label>Status</label><div class="seg" role="group" aria-label="Status">
      <button type="button" data-st="due">Due / open</button><button type="button" data-st="done">Done</button></div>
    ${info && info.paid ? `<p class="small muted">${money(info.paid)} already paid through linked ledger entries.</p>` : ''}
    ${!existing ? `<label>How did it start?</label>
      <label class="check"><input type="radio" name="origin" value="loan" checked> ${esc(loanLbl)}</label>
      <label class="check"><input type="radio" name="origin" value="bill"> ${esc(billLbl)}</label>
      <div id="dAccWrap"><label for="dAcc">${esc(L('field.account'))}</label><select id="dAcc" name="account">${opts(accountNames(), accountNames()[0])}</select>
        ${chargeInput('dCharge', '')}</div>`
      : origin ? `<p class="hintbox small">🔗 Started by the ${esc(typeLabel(origin.type))} on ${dayLabel(origin.date)} from ${esc(origin.account)}. Name, amount and date stay in sync with it.</p>` : ''}
    <label for="dNote">${esc(L('field.note'))}</label><input id="dNote" name="note" value="${esc(d.note || '')}">
    ${actions(!!existing)}`,
  fd => {
    const amount = evalAmount(fd.get('amount')), name = fd.get('name').trim();
    if (!(amount > 0)) return 'Enter a valid amount';
    const term = fd.get('term') || 'current';
    const rec = Object.assign({}, existing || {}, {
      id: existing?.id || uid(), kind, name, amount, date: fd.get('date') || today(), dueDate: fd.get('dueDate'),
      note: fd.get('note').trim(), term, deleted: false,
    });
    rec.doneDate = status === 'done' ? (existing?.doneDate || (info?.status === 'done' ? info.settledOn : '') || today()) : '';
    if (status === 'done' && info?.status === 'done' && !existing.doneDate) rec.doneDate = ''; // already done by payments
    if (!existing) {
      rec.origin = fd.get('origin');
      if (rec.origin === 'loan') {
        const charge = evalCharge(fd.get('charge'), amount);
        if (isNaN(charge) || charge < 0) return 'Charge must be 0 or more (a number or a % like 1.85%)';
        const tx = { id: uid(), type: kind === 'receivable' ? 'lend' : 'borrow', account: fd.get('account'), toAccount: '', amount, charge: charge || '', date: rec.date, category: name, note: rec.note, dueId: rec.id, deleted: false };
        rec.originTxId = tx.id;
        upsert('Ledger', tx, { batch: true });
      }
    } else if (origin) {
      upsert('Ledger', Object.assign({}, origin, { amount, date: rec.date, category: name }), { batch: true });
    }
    upsert('Dues', rec, { batch: true });
    commit();
    if (status === 'due' && dueInfo()[rec.id].status === 'done') toast('Still Done – linked payments cover the full amount');
    else toast(!existing && rec.origin === 'loan' ? `Saved · ${typeLabel(kind === 'receivable' ? 'lend' : 'borrow')} added to ${L('tab.ledger')}` : 'Saved');
  }, () => askConfirm(`Delete ${d.name}? Linked ${L('tab.ledger')} entries are kept (only unlinked).`, () => deleteDue(existing), 'Delete'));
  const setSt = v => { status = v; form.querySelectorAll('[data-st]').forEach(b => b.setAttribute('aria-pressed', b.dataset.st === v)); };
  form.querySelectorAll('[data-st]').forEach(b => b.onclick = () => setSt(b.dataset.st));
  setSt(status);
  form.querySelectorAll('[data-term]').forEach(b => b.onclick = () => {
    form.querySelector('#dTerm').value = b.dataset.term;
    form.querySelectorAll('[data-term]').forEach(x => x.setAttribute('aria-pressed', x.dataset.term === b.dataset.term));
  });
  form.querySelectorAll('input[name="origin"]').forEach(r => r.onchange = () => { form.querySelector('#dAccWrap').hidden = form.origin.value !== 'loan'; });
  if (!existing) wireCharge(() => ({ account: form.account?.value, sign: kind === 'receivable' ? -1 : 1 }));
}

/** Record a payment for a due: creates a linked ledger entry. */
function payForm(d) {
  const info = dueInfo()[d.id], kind = d.kind, p = profile();
  const [loanT, billT] = kind === 'receivable' ? ['collect', 'income'] : ['repay', 'expense'];
  const labels = kind === 'receivable'
    ? { collect: `${typeLabel('collect')} – loan returned`, income: `${typeLabel('income')} – payment for work` }
    : { repay: `${typeLabel('repay')} – loan repaid`, expense: `${typeLabel('expense')} – bill paid` };
  let type = d.origin === 'loan' || db.Ledger[d.originTxId] ? loanT : billT;
  const cats = type => type === 'income' ? p.incomeCats : p.expenseCats;
  const defCat = type => type === 'income' ? (p.incomeCats[0] || 'Other') : (p.expenseCats.includes('Payable') ? 'Payable' : 'General');
  openSheet(`<h3>${kind === 'receivable' ? 'Payment received' : 'Payment made'} · ${esc(d.name)}</h3>
    <p class="small muted">${money(info.remaining)} of ${money(d.amount)} left. This adds an entry to your ${esc(L('tab.ledger'))} and updates the status.</p>
    <div class="seg" role="group" aria-label="Payment type">${[loanT, billT].map(k => `<button type="button" data-ptype="${k}">${esc(labels[k])}</button>`).join('')}</div>
    <label for="yAmt">${esc(L('field.amount'))} (${esc(p.currency)})</label><input id="yAmt" class="amount-input" name="amount" inputmode="decimal" required value="${info.remaining || ''}" autofocus>
    <div class="grid2"><div><label for="yAcc">${kind === 'receivable' ? 'Received in' : 'Paid from'}</label><select id="yAcc" name="account">${opts(accountNames(), accountNames()[0])}</select></div>
    <div><label for="yDate">${esc(L('field.date'))}</label><input id="yDate" type="date" name="date" value="${today()}"></div></div>
    <div id="yCatWrap"><label for="yCat">${esc(L('field.category'))}</label><input id="yCat" name="category" list="yCatList"><datalist id="yCatList"></datalist></div>
    ${chargeInput('yCharge', '')}
    <label for="yNote">${esc(L('field.note'))}</label><input id="yNote" name="note" placeholder="${esc(L('due.' + kind))}: ${esc(d.name)}">
    ${actions(false)}`,
  fd => {
    const amount = evalAmount(fd.get('amount'));
    if (!(amount > 0)) return 'Enter a valid amount';
    const charge = evalCharge(fd.get('charge'), amount);
    if (isNaN(charge) || charge < 0) return 'Charge must be 0 or more (a number or a % like 1.85%)';
    upsert('Ledger', {
      id: uid(), type, account: fd.get('account'), toAccount: '', amount, charge: charge || '', date: fd.get('date') || today(),
      category: type === loanT ? d.name : (fd.get('category') || '').trim() || defCat(type),
      note: (fd.get('note') || '').trim() || `${L('due.' + kind)}: ${d.name}`, dueId: d.id, deleted: false,
    });
    const now = dueInfo()[d.id];
    toast(now.status === 'done' ? `${d.name}: paid in full – Done` : `${d.name}: ${money(now.remaining)} left`);
  });
  const setType = k => {
    type = k;
    form.querySelectorAll('[data-ptype]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ptype === k));
    form.querySelector('#yCatWrap').hidden = k === loanT;
    form.querySelector('#yCatList').innerHTML = cats(k).map(c => `<option value="${esc(c)}">`).join('');
    form.querySelector('#yCat').value = defCat(k);
    form.querySelector('label[for="yCat"]').textContent = k === 'income' ? L('field.source') : L('field.category');
  };
  form.querySelectorAll('[data-ptype]').forEach(b => b.onclick = () => setType(b.dataset.ptype));
  setType(type);
  wireCharge(() => ({ account: form.account.value, sign: kind === 'receivable' ? 1 : -1 }));
}

/** Detail view of a due: status, payment history, link suggestions. */
function dueDetail(id) {
  const d = db.Dues[id]; if (!d || d.deleted) { if (dlg.open) dlg.close(); return; }
  const i = dueInfo()[id], kind = d.kind;
  const linked = rows('Ledger').filter(t => t.dueId === id).sort((a, b) => String(a.date).localeCompare(b.date));
  const key = d.name.trim().toLowerCase();
  const okTypes = kind === 'receivable' ? ['lend', 'collect', 'income'] : ['borrow', 'repay', 'expense'];
  const hit = t => { const c = (t.category || '').toLowerCase(), n = (t.note || '').toLowerCase(); return (c && (c.includes(key) || (c.length >= 3 && key.includes(c)))) || n.includes(key); };
  const sugg = key.length >= 3 ? rows('Ledger').filter(t => !t.dueId && okTypes.includes(t.type) && hit(t)).sort((a, b) => String(b.date).localeCompare(a.date)).slice(0, 8) : [];
  const txRow = (t, btn) => `<li><div class="ico">${TYPES[t.type].icon}</div><div class="main"><div class="t">${esc(typeLabel(t.type))}${t.id === d.originTxId ? ' <span class="small muted">(started it)</span>' : ''}</div>
    <div class="s">${dayLabel(t.date)} · ${esc(t.account)}${t.note ? ' · ' + esc(t.note) : ''}</div></div><div class="amt"><div>${money(t.amount)}</div>${btn}</div></li>`;
  form.innerHTML = `<div class="row between"><h3>${esc(d.name)}</h3><span class="badge st-${i.show}">${STATUS_LABEL[i.show]}</span></div>
    <p class="small muted" style="margin-top:0">${esc(L('due.' + kind))}${d.date ? ' · since ' + dayLabel(d.date) : ''}${d.dueDate ? ' · due by ' + dayLabel(d.dueDate) : ''}${i.settledOn ? ' · settled ' + dayLabel(i.settledOn) : ''}</p>
    <div class="grid3 three"><div class="acc"><div class="k">Total</div><div class="v">${money(d.amount)}</div></div>
      <div class="acc"><div class="k">Paid</div><div class="v in">${money(i.settled)}</div></div>
      <div class="acc"><div class="k">Remaining</div><div class="v warn">${money(i.remaining)}</div></div></div>
    <div class="progress big"><div style="width:${d.amount ? Math.min(100, i.settled / d.amount * 100).toFixed(0) : 0}%"></div></div>
    ${d.doneDate && !i.paid ? '<p class="small muted">Marked done by hand (no linked payment).</p>' : ''}
    <h4>${esc(L('tab.ledger'))} entries</h4>
    ${linked.length ? `<ul class="list">${linked.map(t => txRow(t, `<button type="button" class="badge" data-unlink="${esc(t.id)}">Unlink</button>`)).join('')}</ul>` : '<p class="small muted">No linked entries yet.</p>'}
    ${sugg.length ? `<h4>Possible matches in ${esc(L('tab.ledger'))}</h4><ul class="list">${sugg.map(t => txRow(t, `<button type="button" class="badge st-due" data-link="${esc(t.id)}">Link</button>`)).join('')}</ul>` : ''}
    <div class="actions wrap">
      ${i.status !== 'done' ? '<button type="button" class="btn" data-dd="pay">Record payment</button>' : ''}
      <button type="button" class="btn ghost" data-dd="toggle">${i.status === 'done' ? 'Reopen' : 'Mark done'}</button>
      <button type="button" class="btn ghost" data-dd="edit">Edit</button>
      <button type="button" class="btn ghost" data-dd="close">Close</button></div>`;
  form.onsubmit = e => { e.preventDefault(); };
  form.onclick = e => {
    const b = e.target.closest('[data-dd],[data-link],[data-unlink]'); if (!b) return;
    if (b.dataset.dd === 'close') dlg.close();
    else if (b.dataset.dd === 'pay') payForm(d);
    else if (b.dataset.dd === 'edit') dueForm(d);
    else if (b.dataset.dd === 'toggle') { toggleDue(d); dueDetail(id); }
    else if (b.dataset.link) {
      const t = db.Ledger[b.dataset.link];
      upsert('Ledger', Object.assign({}, t, { dueId: id }), { batch: true });
      if (LOAN_KIND[t.type] && !d.originTxId) upsert('Dues', Object.assign({}, d, { originTxId: t.id, origin: 'loan' }), { batch: true });
      commit(); dueDetail(id);
    } else if (b.dataset.unlink) {
      const t = db.Ledger[b.dataset.unlink];
      upsert('Ledger', Object.assign({}, t, { dueId: '' }), { batch: true });
      if (d.originTxId === t.id) upsert('Dues', Object.assign({}, db.Dues[id], { originTxId: '' }), { batch: true });
      commit(); dueDetail(id);
    }
  };
  if (!dlg.open) dlg.showModal();
}

function toggleDue(d) {
  const i = dueInfo()[d.id];
  if (i.status === 'done') {
    if (d.doneDate) {
      upsert('Dues', Object.assign({}, d, { doneDate: '' }));
      toast(dueInfo()[d.id].status === 'done' ? 'Still Done – linked payments cover the full amount' : `${d.name} reopened`);
    }
    else toast('Fully paid by linked payments – unlink one to reopen');
  } else { upsert('Dues', Object.assign({}, d, { doneDate: today() })); toast(`${d.name} marked done`); }
}

function purchaseForm(existing) {
  const p = existing || { date: monthOf(today()) === ui.month ? today() : ui.month + '-01', category: 'Purchase', account: accountNames()[0] || '' };
  const st = existing ? purchaseInfo()[existing.id]?.status : '';
  openSheet(`<h3>${existing ? 'Edit' : 'New'} purchase</h3>
    <label for="pName">${esc(L('pur.item'))}</label><input id="pName" name="name" required value="${esc(p.name || '')}" autofocus>
    <div class="grid2"><div><label for="pPrice">${esc(L('pur.price'))} (${esc(profile().currency)})</label><input id="pPrice" name="price" inputmode="decimal" required value="${esc(p.price ?? '')}"></div>
    <div><label for="pDate">${esc(L('field.date'))}</label><input id="pDate" type="date" name="date" value="${esc(p.date)}"></div></div>
    <div class="grid2"><div><label for="pCat">${esc(L('field.category'))}</label><input id="pCat" name="category" list="pcatList" value="${esc(p.category || '')}"><datalist id="pcatList">${profile().expenseCats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div><label for="pAcc">Paid from</label><select id="pAcc" name="account"><option value="">—</option>${opts(accountNames(), p.account)}</select></div></div>
    ${chargeInput('pCharge', p.charge)}
    <label for="pSrc">${esc(L('pur.shop'))}</label><input id="pSrc" name="source" value="${esc(p.source || '')}">
    <label for="pNote">${esc(L('field.note'))}</label><input id="pNote" name="note" value="${esc(p.note || '')}">
    <label class="check"><input type="checkbox" name="inLedger" ${p.inLedger ? 'checked' : ''}> I already added this as an expense in the ${esc(L('tab.ledger').toLowerCase())}</label>
    <p class="small muted">${st ? 'Now: ' + esc(PURCHASE_STATUS[st]) + '. ' : ''}If unticked, the app checks the ledger for an expense with the same date and amount. If none exists, this purchase counts as an expense and is taken from the "Paid from" account.</p>
    ${actions(!!existing)}`,
  fd => {
    const price = evalAmount(fd.get('price'));
    if (!(price >= 0)) return 'Enter a valid price';
    const charge = evalCharge(fd.get('charge'), price);
    if (isNaN(charge) || charge < 0) return 'Charge must be 0 or more (a number or a % like 1.85%)';
    upsert('Purchases', { id: existing?.id, name: fd.get('name').trim(), price, charge: charge || '', date: fd.get('date'), category: fd.get('category').trim() || 'Purchase', account: fd.get('account'), source: fd.get('source').trim(), note: fd.get('note').trim(), inLedger: !!fd.get('inLedger'), deleted: false });
  }, () => softDelete('Purchases', existing.id));
  wireCharge(() => ({ account: form.account.value, sign: -1 }));
}

function accountForm(existing) {
  const a = existing || {};
  openSheet(`<h3>${existing ? 'Edit' : 'New'} ${esc(L('field.account').toLowerCase())}</h3>
    <label for="aName">Name</label><input id="aName" name="name" required value="${esc(a.name || '')}" ${existing ? 'readonly' : 'autofocus'}>
    <label for="aOpen">Opening balance (${esc(profile().currency)})</label><input id="aOpen" name="opening" inputmode="decimal" value="${esc(a.opening ?? 0)}">
    ${actions(!!existing)}`,
  fd => {
    const name = fd.get('name').trim(), opening = evalAmount(fd.get('opening') || '0');
    if (isNaN(opening)) return 'Invalid balance';
    if (!existing && accountNames().includes(name)) return 'Account already exists';
    upsert('Accounts', { id: existing?.id || 'acc-' + name.toLowerCase().replace(/\W+/g, '-'), name, opening, deleted: false });
  }, () => softDelete('Accounts', existing.id));
}

// ======================================================================
// Events
// ======================================================================
$('#fab').onclick = () => {
  if (ui.tab === 'dues') dueForm();
  else if (ui.tab === 'more' && ui.sub === 'purchases') purchaseForm();
  else if (ui.tab === 'more' && ui.sub === 'books') bookForm();
  else txForm();
};
$('#syncPill').onclick = () => {
  if (window.GoogleSync && !googleSyncState.isSignedIn) { location.hash = 'more/settings'; return; }
  syncGoogleSheet(true);
};

view.addEventListener('click', e => {
  const el = e.target.closest('[data-month],[data-filter],[data-account],[data-edit],[data-duekind],[data-due],[data-due-badge],[data-due-open],[data-duestatus],[data-dueterm],[data-purchase-edit],[data-prayer],[data-namaz-day],[data-acc-edit],[data-action],[data-mode],[data-pall],[data-pivot-swap],[data-pivot-export],[data-list-remove],[data-quick],[data-day],[data-theme-set],[data-font-set],[data-filter-cat],[data-bookstatus],[data-book-edit],[data-book-del],a[href="#more/companion"]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.themeSet) {
    document.documentElement.dataset.theme = ds.themeSet;
    localStorage.setItem('moneybook.theme', ds.themeSet);
    saveProfile({ theme: ds.themeSet }, { batch: true });
    toast(`Theme set to ${ds.themeSet}`);
    render();
    return;
  }
  if (ds.fontSet) {
    document.documentElement.dataset.font = ds.fontSet;
    localStorage.setItem('moneybook.font', ds.fontSet);
    saveProfile({ font: ds.fontSet }, { batch: true });
    toast(`Font set to ${ds.fontSet}`);
    render();
    return;
  }
  if (ds.filterCat) {
    ui.cat = ds.filterCat === ui.cat ? '' : ds.filterCat;
    render();
    return;
  }
  if (ds.quick) { txForm(null, { type: ds.quick }); return; }
  if ('day' in ds) { e.preventDefault(); ui.day = ds.day === ui.day ? '' : ds.day; ui.calOpen = true; render(); return; }
  if (ds.dueterm) { ui.dueTerm = ds.dueterm; render(); return; }
  if (ds.bookstatus) { ui.bookStatus = ds.bookstatus; render(); return; }
  if (ds.bookEdit) { bookForm(db.Books[ds.bookEdit]); return; }
  if (ds.bookDel) {
    const b = db.Books[ds.bookDel];
    askConfirm(`Delete "${b ? b.name : 'this book'}" from library?`, () => {
      softDelete('Books', ds.bookDel);
      commit();
      toast('Book removed');
      render();
    }, 'Delete');
    return;
  }
  if (ds.action === 'open-quick-control' || el.getAttribute('href') === '#more/companion') {
    e.preventDefault();
    if (window.openQuickControl) window.openQuickControl();
    else window.dispatchEvent(new CustomEvent('moneybook:open-quick-control'));
    return;
  }
  if (ds.action === 'add-book') { bookForm(); return; }
  if (ds.action === 'export-books-csv') { exportBooksCsv(); return; }
  if (ds.action === 'import-books-csv') { $('#importBooksFile')?.click(); return; }
  if (ds.month) { ui.month = shiftMonth(ui.month, Number(ds.month)); ui.day = ''; if (ui.tab === 'more' && ui.sub === 'namaz') ui.namazDate = ui.month + '-01'; render(); }
  else if (ds.filter) { ui.filter = ds.filter; render(); }
  else if ('account' in ds) { ui.account = ds.account; render(); }
  else if (ds.edit) txForm(db.Ledger[ds.edit]);
  else if (ds.duekind) { ui.dueKind = ds.duekind; render(); }
  else if (ds.due) { ui.dueKind = ds.due; ui.mode.dues = 'list'; }
  else if (ds.dueBadge) {
    e.stopPropagation();
    const d = db.Dues[ds.dueBadge];
    if (dueInfo()[d.id].status === 'done') toggleDue(d); else payForm(d);
  }
  else if (ds.dueOpen) dueDetail(ds.dueOpen);
  else if (ds.duestatus) { ui.dueStatus = ds.duestatus; render(); }
  else if (ds.purchaseEdit) purchaseForm(db.Purchases[ds.purchaseEdit]);
  else if (ds.accEdit) accountForm(db.Accounts[ds.accEdit]);
  else if (ds.namazDay) { ui.namazDate = ds.namazDay; render(); }
  else if (ds.prayer) {
    const id = 'nz-' + ui.namazDate;
    const rec = Object.assign({ id, date: ui.namazDate }, db.Namaz[id], { deleted: false });
    rec[ds.prayer] = !rec[ds.prayer];
    upsert('Namaz', rec);
  }
  else if (ds.mode) { const [sec, m] = ds.mode.split(':'); ui.mode[sec] = m; render(); }
  else if (ds.pall) { ui.pAll = ds.pall === '1'; render(); }
  else if (ds.pivotSwap) { const st = ui.pivot[ds.pivotSwap]; if (st.cols) { [st.rows, st.cols] = [st.cols, st.rows]; render(); } }
  else if (ds.pivotExport) {
    const sec = ds.pivotExport;
    saveFile(`pivot-${sec}-${today()}.xlsx`, XLSX_LITE.write([{ name: 'Pivot ' + sec, rows: pivotExportRows(sec) }]));
  }
  else if ('listRemove' in ds) { el.closest('.row').remove(); }
  else if (ds.action) runAction(ds.action);
});
view.addEventListener('input', e => {
  if (e.target.matches('[data-search]')) { ui.q = e.target.value; render(); }
  if (e.target.matches('[data-book-search]')) { ui.bookQ = e.target.value; render(); }
  const box = e.target.closest('[data-list]');
  if (box && e.target === box.lastElementChild.querySelector('input') && e.target.value) {
    // typing in the "+ Add new" box turns it into a normal row and adds a fresh empty box
    const row = e.target.closest('.row');
    row.insertAdjacentHTML('beforeend', '<button type="button" class="btn ghost x" data-list-remove aria-label="Remove">✕</button>');
    box.insertAdjacentHTML('beforeend', '<div class="row"><input placeholder="+ Add new" data-orig="" aria-label="Add new"></div>');
  }
});
view.addEventListener('change', e => {
  if (e.target.matches('[data-namaz-date]') && e.target.value) { ui.namazDate = e.target.value; ui.month = monthOf(e.target.value); render(); }
  if (e.target.matches('[data-fsel]')) { ui[e.target.dataset.fsel] = e.target.value; render(); return; }
  if (e.target.matches('[data-pivot]')) { const [sec, k] = e.target.dataset.pivot.split(':'); ui.pivot[sec][k] = e.target.value; render(); }
  if (e.target.id === 'importFile') {
    const f = e.target.files[0]; e.target.value = '';
    if (f) prepareImport(f).catch(err => { ui.importPreview = null; ui.importLog = `<span class="out">Could not import: ${esc(err.message)}</span>`; render(); });
  }
  if (e.target.id === 'importBooksFile') {
    const f = e.target.files[0]; e.target.value = '';
    if (f) importBooksFromCsv(f);
  }
});

// Tooltip layer for charts and bars (hover + keyboard focus).
const tip = document.createElement('div'); tip.className = 'tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
function showTip(el, x, y) { tip.textContent = el.dataset.tip; tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (y - 36) + 'px'; tip.classList.add('show'); }
view.addEventListener('pointermove', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tip.classList.remove('show'); });
view.addEventListener('pointerleave', () => tip.classList.remove('show'));
view.addEventListener('toggle', e => { if (e.target.matches?.('[data-cal]')) ui.calOpen = e.target.open; }, true);
view.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.top); } });
view.addEventListener('focusout', () => tip.classList.remove('show'));

async function runAction(a) {
  if (a === 'save-sync') {
    db.settings.url = $('#sUrl').value.trim();
    db.settings.token = $('#sToken').value;
    persist();
    if (!db.settings.url) { toast('Saved – running in local-only mode'); render(); return; }
    TABLES.forEach(t => Object.keys(db[t]).forEach(id => { db.dirty[t][id] = true; }));
    db.lastSync = '';
    persist();
    await sync();
    toast(lastError ? 'Sync error: ' + lastError : 'Connected to Google Sheet');
    render();
  } else if (a === 'google-signin') {
    if (!window.GoogleSync) { toast('Google Sheets sync is loading, please wait a moment'); return; }
    lastError = '';
    try {
      toast('Opening Google Sign-In…');
      const res = await window.GoogleSync.signIn();
      toast(`Signed in as ${res.user.displayName || res.user.email} · Connected!`);
      await syncGoogleSheet(false);
      render();
    } catch (e) {
      lastError = e?.message || String(e);
      toast('Login failed: ' + lastError);
      render();
    }
  } else if (a === 'google-sync') {
    await syncGoogleSheet(true);
  } else if (a === 'google-signout') {
    askConfirm('Sign out of your Google Account? Your local data will stay safely on this device.', async () => {
      await window.GoogleSync?.signOut();
      toast('Signed out');
      render();
    }, 'Sign out');
  } else if (a === 'add-account') accountForm();
  else if (a === 'manage-budgets') budgetForm();
  else if (a === 'auto-budgets') autoBudgets();
  else if (a === 'clear-budgets') {
    saveProfile({ budgets: {} });
    toast('Category budgets cleared');
    render();
  }
  else if (a === 'set-jamat') jamatForm();
  else if (a === 'toggle-namaz-alarm') {
    const p = profile();
    const cur = p.namazAlarm || { enabled: true, offsetMinutes: 0 };
    const nextState = !cur.enabled;
    saveProfile({ namazAlarm: { ...cur, enabled: nextState } });
    if (nextState && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    toast(nextState ? '🔔 Prayer Jamat alarm turned ON' : '🔕 Prayer Jamat alarm turned OFF');
    render();
  }
  else if (a === 'test-jamat-alarm') {
    playPrayerChime();
    toast('🔊 Playing prayer chime test');
  }
  else if (a === 'loan-sync') applyLoanSync();
  else if (a === 'save-profile') saveProfileFromForm();
  else if (a === 'reset-labels') { view.querySelectorAll('[data-label]').forEach(i => { i.value = ''; }); toast('Names cleared – tap Save profile'); }
  else if (a === 'sample') {
    try {
      const seed = window.__SEED__ || await (await fetch('seed.json')).json();
      const pv = { file: 'Sample – October 2026', recs: {}, counts: {}, warnings: [], opening: seed.opening || null, openingDefault: !rows('Ledger').length, purchaseOption: true };
      Object.entries(seed).forEach(([t, list]) => { if (Array.isArray(list)) { pv.recs[t] = list; pv.counts[t] = list.length; } });
      pv.total = Object.values(pv.counts).reduce((x, y) => x + y, 0);
      ui.importPreview = pv; render();
    } catch { toast('Loading the sample needs the app to be online once'); }
  }
  else if (a === 'pick-import') $('#importFile').click();
  else if (a === 'apply-import') applyImport();
  else if (a === 'cancel-import') { ui.importPreview = null; render(); }
  else if (a === 'export-json') {
    const data = {}; TABLES.forEach(t => { data[t] = Object.values(db[t]); });
    saveFile(`moneybook-backup-${today()}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  } else if (a === 'export-xlsx') {
    const sheets = [{ name: 'Summary', rows: summaryRows() }, ...Object.keys(EXPORT_COLS).map(t => ({ name: t, rows: exportRows(t) }))];
    saveFile(`moneybook-${today()}.xlsx`, XLSX_LITE.write(sheets));
  } else if (a === 'export-csv') {
    const t = $('#csvSec').value;
    saveFile(`${t.toLowerCase()}-${today()}.csv`, new Blob(['﻿' + toCsv(exportRows(t))], { type: 'text/csv' }));
  } else if (a === 'wipe') {
    const msg = (pendingCount() ? `${pendingCount()} changes have not reached Google Sheet yet and will be lost. ` : '') +
      'Remove all data stored on this device? Your Google Sheet is not touched; syncing again downloads it back.';
    askConfirm(msg, () => {
      const settings = db.settings;
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      db = load(); db.settings = settings;
      changed(); persist(); render();
    }, 'Clear this device');
  }
}

// ======================================================================
// Boot
// ======================================================================
applyThemeAndFont();
ensureBooksLoaded();
render();
initGoogleSheetsIntegration();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
