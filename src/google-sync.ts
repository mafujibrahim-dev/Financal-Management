/**
 * Google Workspace & Firebase Auth Integration for Money Book
 * Handles Google Sign-In with OAuth scopes:
 * - https://www.googleapis.com/auth/spreadsheets
 * - https://www.googleapis.com/auth/drive.file
 * Automatically connects or creates a dedicated Google Sheet on Google Drive
 * and synchronizes all historical transactions, dues, purchases, books, and namaz records.
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as fbSignOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((s) => provider.addScope(s));
provider.setCustomParameters({
  prompt: 'select_account',
});

// In-memory access token storage (NEVER stored in localStorage as per security rules)
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;
let currentSpreadsheet: { id: string; name: string; url: string } | null = null;

const SPREADSHEET_TITLE = 'Personal Money Book & Ledger';
const LOCAL_SHEET_KEY = 'moneybook.google_sheet_id';

export interface SyncStatus {
  isSignedIn: boolean;
  user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
  } | null;
  spreadsheet: {
    id: string;
    name: string;
    url: string;
  } | null;
  lastSync: string | null;
  hasToken: boolean;
}

type StatusListener = (status: SyncStatus) => void;
const listeners: StatusListener[] = [];

function notifyListeners() {
  const status: SyncStatus = {
    isSignedIn: !!currentUser,
    user: currentUser
      ? {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
        }
      : null,
    spreadsheet: currentSpreadsheet,
    lastSync: localStorage.getItem('moneybook.last_google_sync') || null,
    hasToken: !!cachedAccessToken,
  };
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (e) {
      console.warn('Listener error', e);
    }
  });
}

// Initialize Auth listener on boot
export function initGoogleAuth(cb?: StatusListener) {
  if (cb) listeners.push(cb);

  // Restore stored sheet ID info if available
  const savedSheetId = localStorage.getItem(LOCAL_SHEET_KEY);
  if (savedSheetId) {
    currentSpreadsheet = {
      id: savedSheetId,
      name: SPREADSHEET_TITLE,
      url: `https://docs.google.com/spreadsheets/d/${savedSheetId}/edit`,
    };
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      cachedAccessToken = null;
    }
    notifyListeners();
  });

  notifyListeners();
}

/**
 * Sign in with Google using popup and obtain the OAuth access token for Google Sheets & Drive
 */
export async function signInWithGoogle(): Promise<{ user: User; accessToken: string }> {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Sheets access token');
    }
    cachedAccessToken = credential.accessToken;
    currentUser = result.user;

    // Automatically connect or create the Google Sheet
    await ensureSpreadsheet();
    notifyListeners();

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: any) {
    console.error('Google Sign-in failed:', err);
    throw err;
  }
}

/**
 * Sign out and clear cached credentials
 */
export async function signOutGoogle(): Promise<void> {
  await fbSignOut(auth);
  cachedAccessToken = null;
  currentUser = null;
  notifyListeners();
}

export function getCachedToken(): string | null {
  return cachedAccessToken;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

export function getSpreadsheetInfo() {
  return currentSpreadsheet;
}

/**
 * Ensures a dedicated Google Sheet exists on the user's Google Drive.
 * If already known or found in Drive, reuses it; otherwise creates it.
 */
export async function ensureSpreadsheet(): Promise<{ id: string; name: string; url: string }> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Sign in with Google first to access your Google Sheet');
  }

  // 1. Check if we have a valid saved spreadsheet ID
  const savedId = localStorage.getItem(LOCAL_SHEET_KEY);
  if (savedId) {
    try {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${savedId}?fields=spreadsheetId,properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        currentSpreadsheet = {
          id: data.spreadsheetId,
          name: data.properties?.title || SPREADSHEET_TITLE,
          url: `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
        };
        notifyListeners();
        return currentSpreadsheet;
      }
    } catch (e) {
      console.warn('Could not verify existing spreadsheet, searching Drive...', e);
    }
  }

  // 2. Search user's Google Drive for an existing spreadsheet with this title
  try {
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(
      SPREADSHEET_TITLE
    )}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,name)`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const found = searchData.files[0];
        localStorage.setItem(LOCAL_SHEET_KEY, found.id);
        currentSpreadsheet = {
          id: found.id,
          name: found.name,
          url: `https://docs.google.com/spreadsheets/d/${found.id}/edit`,
        };
        notifyListeners();
        return currentSpreadsheet;
      }
    }
  } catch (e) {
    console.warn('Error searching Google Drive files:', e);
  }

  // 3. Create a brand new Google Sheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: SPREADSHEET_TITLE,
      },
      sheets: [
        { properties: { title: 'Summary', gridProperties: { frozenRowCount: 3 } } },
        { properties: { title: 'Ledger', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Dues', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Purchases', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Books', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Namaz', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Accounts', gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Google Sheet: ${errText}`);
  }

  const createdData = await createRes.json();
  const newId = createdData.spreadsheetId;
  localStorage.setItem(LOCAL_SHEET_KEY, newId);
  currentSpreadsheet = {
    id: newId,
    name: SPREADSHEET_TITLE,
    url: `https://docs.google.com/spreadsheets/d/${newId}/edit`,
  };
  notifyListeners();
  return currentSpreadsheet;
}

/**
 * Ensures all required sheets (tabs) exist in the spreadsheet
 */
async function ensureSheetsExist(token: string, sheetId: string, requiredSheets: string[]) {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!metaRes.ok) return;
  const meta = await metaRes.json();
  const existing = new Set<string>((meta.sheets || []).map((s: any) => s.properties?.title));

  const addRequests = requiredSheets
    .filter((title) => !existing.has(title))
    .map((title) => ({
      addSheet: {
        properties: {
          title,
          gridProperties: { frozenRowCount: 1 },
        },
      },
    }));

  if (addRequests.length > 0) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: addRequests }),
    });
  }
}

/**
 * Push full database snapshot to the connected Google Sheet
 */
export async function syncDatabaseToGoogleSheet(db: any): Promise<{
  ok: boolean;
  syncedAt: string;
  sheetUrl: string;
  rowCount: number;
}> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Not authenticated. Please click "Sign in with Google" to sync.');
  }

  const sheet = await ensureSpreadsheet();
  const sheetId = sheet.id;

  const requiredSheets = ['Summary', 'Ledger', 'Dues', 'Purchases', 'Books', 'Namaz', 'Accounts'];
  await ensureSheetsExist(token, sheetId, requiredSheets);

  // Clear existing ranges to avoid old orphaned rows
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ranges: requiredSheets.map((s) => `${s}!A1:Z3000`),
    }),
  });

  // Prepare table rows
  const ledgerRows = Object.values(db.Ledger || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));

  const duesRows = Object.values(db.Dues || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

  const purchasesRows = Object.values(db.Purchases || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));

  const booksRows = Object.values(db.Books || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => (Number(a.sl) || 9999) - (Number(b.sl) || 9999));

  const namazRows = Object.values(db.Namaz || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));

  const accountsRows = Object.values(db.Accounts || {})
    .filter((r: any) => !r.deleted)
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

  // Calculate Summary metrics
  const months = Array.from(new Set(ledgerRows.map((t: any) => String(t.date || '').slice(0, 7)))).filter(Boolean).sort().reverse();
  const summaryData: (string | number)[][] = [
    ['Personal Money Book & Ledger', 'Last Synced:', new Date().toLocaleString()],
    ['Google Sheets Cloud Backup & Historical Records', '', ''],
    ['Month', 'Total Income', 'Total Expense', 'Net Balance', 'Purchases', 'Lent', 'Collected', 'Borrowed', 'Repaid'],
  ];

  months.forEach((m) => {
    const txs = ledgerRows.filter((t: any) => String(t.date || '').startsWith(m));
    const sumType = (tp: string) => txs.filter((t: any) => t.type === tp).reduce((acc: number, x: any) => acc + (Number(x.amount) || 0), 0);
    const inc = sumType('income');
    const exp = sumType('expense');
    const net = inc - exp;
    const pur = txs.filter((t: any) => t.virtual || t.category === 'Purchase').reduce((acc: number, x: any) => acc + (Number(x.amount) || 0), 0);
    summaryData.push([
      m,
      inc,
      exp,
      net,
      pur,
      sumType('lend'),
      sumType('collect'),
      sumType('borrow'),
      sumType('repay'),
    ]);
  });

  const valueUpdates = [
    {
      range: 'Summary!A1',
      values: summaryData,
    },
    {
      range: 'Ledger!A1',
      values: [
        ['Date', 'Type', 'Amount', 'Account', 'To Account', 'Category', 'Charge / Fee', 'Note', 'Due Link ID', 'Transaction ID', 'Last Updated'],
        ...ledgerRows.map((t: any) => [
          t.date || '',
          t.type || '',
          Number(t.amount) || 0,
          t.account || '',
          t.toAccount || '',
          t.category || '',
          t.charge || '',
          t.note || '',
          t.dueId || '',
          t.id || '',
          t.updatedAt || '',
        ]),
      ],
    },
    {
      range: 'Dues!A1',
      values: [
        ['Name', 'Kind (Receivable/Payable)', 'Amount', 'Term (Current/Fixed)', 'Date', 'Due Date', 'Settled Date', 'Origin', 'Note', 'Due ID', 'Last Updated'],
        ...duesRows.map((d: any) => [
          d.name || '',
          d.kind || '',
          Number(d.amount) || 0,
          d.term || 'current',
          d.date || '',
          d.dueDate || '',
          d.doneDate || '',
          d.origin || '',
          d.note || '',
          d.id || '',
          d.updatedAt || '',
        ]),
      ],
    },
    {
      range: 'Purchases!A1',
      values: [
        ['Date', 'Item Name', 'Price', 'Charge', 'Category', 'Paid From Account', 'Shop / Source', 'In Ledger', 'Note', 'Purchase ID', 'Last Updated'],
        ...purchasesRows.map((p: any) => [
          p.date || '',
          p.name || '',
          Number(p.price) || 0,
          p.charge || '',
          p.category || '',
          p.account || '',
          p.source || '',
          p.inLedger ? 'Yes' : 'No',
          p.note || '',
          p.id || '',
          p.updatedAt || '',
        ]),
      ],
    },
    {
      range: 'Books!A1',
      values: [
        ['SL #', 'Book Name', 'Author', 'Genre', 'Version / Language', 'Progress / Notes', 'Reading Status', 'Book ID', 'Last Updated'],
        ...booksRows.map((b: any) => [
          b.sl || '',
          b.name || '',
          b.author || '',
          b.genre || '',
          b.version || '',
          b.progress || '',
          b.status || '',
          b.id || '',
          b.updatedAt || '',
        ]),
      ],
    },
    {
      range: 'Namaz!A1',
      values: [
        ['Date', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Tahajjud', 'Chasht', 'Qiyam', 'Hajat', 'Istighfar', 'Istikhara', 'Fatima', 'KunFayaKun', 'Qaza'],
        ...namazRows.map((n: any) => [
          n.date || '',
          n.Fajr ? 'Done' : '',
          n.Dhuhr ? 'Done' : '',
          n.Asr ? 'Done' : '',
          n.Maghrib ? 'Done' : '',
          n.Isha ? 'Done' : '',
          n.Tahajjud ? 'Done' : '',
          n.Chasht ? 'Done' : '',
          n.Qiyam ? 'Done' : '',
          n.Hajat ? 'Done' : '',
          n.Istighfar ? 'Done' : '',
          n.Istikhara ? 'Done' : '',
          n.Fatima ? 'Done' : '',
          n.KunFayaKun ? 'Done' : '',
          n.Qaza ? 'Done' : '',
        ]),
      ],
    },
    {
      range: 'Accounts!A1',
      values: [
        ['Account Name', 'Opening Balance', 'Account ID', 'Last Updated'],
        ...accountsRows.map((a: any) => [
          a.name || '',
          Number(a.opening) || 0,
          a.id || '',
          a.updatedAt || '',
        ]),
      ],
    },
  ];

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueUpdates,
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Sheets update failed: ${errText}`);
  }

  const syncedAt = new Date().toISOString();
  localStorage.setItem('moneybook.last_google_sync', syncedAt);
  notifyListeners();

  const totalRecords =
    ledgerRows.length +
    duesRows.length +
    purchasesRows.length +
    booksRows.length +
    namazRows.length +
    accountsRows.length;

  return {
    ok: true,
    syncedAt,
    sheetUrl: sheet.url,
    rowCount: totalRecords,
  };
}

// Expose on global window object so vanilla JS in public/app.js can seamlessly call it
(window as any).GoogleSync = {
  init: initGoogleAuth,
  signIn: signInWithGoogle,
  signOut: signOutGoogle,
  sync: syncDatabaseToGoogleSheet,
  getSpreadsheet: getSpreadsheetInfo,
  getUser: getCurrentUser,
  getToken: getCachedToken,
  ensureSpreadsheet,
};
