/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Cloud,
  FileSpreadsheet,
  Smartphone,
  X,
  RefreshCw,
  Check,
  ShieldCheck,
  Palette,
  Volume2,
  PieChart,
  Bell,
  Sliders,
  Type
} from 'lucide-react';

const THEMES = [
  { id: 'purple', name: 'Royal Violet', c1: '#6a3de8', c2: '#f26b3a' },
  { id: 'emerald', name: 'Emerald Oasis', c1: '#059669', c2: '#d97706' },
  { id: 'ocean', name: 'Ocean Blue', c1: '#2563eb', c2: '#0284c7' },
  { id: 'midnight', name: 'Midnight Slate', c1: '#475569', c2: '#7c3aed' },
  { id: 'sunset', name: 'Sunset Amber', c1: '#ea580c', c2: '#e11d48' },
  { id: 'rose', name: 'Rose Bloom', c1: '#db2777', c2: '#9333ea' },
];

const FONTS = [
  { id: 'inter', name: 'Inter', desc: 'Clean System Sans' },
  { id: 'jakarta', name: 'Plus Jakarta', desc: 'Geometric Sans' },
  { id: 'outfit', name: 'Outfit', desc: 'Modern Rounded' },
  { id: 'roboto', name: 'Roboto', desc: 'Google Sans' },
  { id: 'serif', name: 'Playfair', desc: 'Editorial Serif' },
  { id: 'bengali', name: 'Noto Bengali', desc: 'Bengali / English' },
  { id: 'mono', name: 'JetBrains Mono', desc: 'Monospaced Numbers' },
];

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'sample' | 'budget' | 'namaz' | 'design' | 'cloud' | 'apk'>('sample');
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [seedData, setSeedData] = useState<any>(null);
  const [currentTheme, setCurrentTheme] = useState('purple');
  const [currentFont, setCurrentFont] = useState('inter');

  // Preload seed data for offline and instant sample loading
  useEffect(() => {
    fetch('/seed.json')
      .then((res) => res.json())
      .then((data) => {
        setSeedData(data);
        (window as any).__SEED__ = data;
      })
      .catch((err) => console.warn('Could not preload seed.json', err));

    const savedTheme = localStorage.getItem('moneybook.theme') || 'purple';
    const savedFont = localStorage.getItem('moneybook.font') || 'inter';
    setCurrentTheme(savedTheme);
    setCurrentFont(savedFont);
    document.documentElement.dataset.theme = savedTheme;
    document.documentElement.dataset.font = savedFont;

    (window as any).openQuickControl = () => setIsOpen(true);
    const onOpen = () => setIsOpen(true);
    window.addEventListener('open-quick-control', onOpen);
    const onHash = () => {
      if (location.hash === '#more/companion') {
        setIsOpen(true);
        location.hash = '#more';
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('open-quick-control', onOpen);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const handleSetTheme = (themeId: string) => {
    setCurrentTheme(themeId);
    document.documentElement.dataset.theme = themeId;
    localStorage.setItem('moneybook.theme', themeId);
    try {
      const raw = localStorage.getItem('moneybook.v1');
      if (raw) {
        const db = JSON.parse(raw);
        if (!db.Profile) db.Profile = {};
        if (!db.Profile.profile) db.Profile.profile = { id: 'profile' };
        db.Profile.profile.theme = themeId;
        localStorage.setItem('moneybook.v1', JSON.stringify(db));
      }
    } catch {}
    window.dispatchEvent(new Event('hashchange'));
  };

  const handleSetFont = (fontId: string) => {
    setCurrentFont(fontId);
    document.documentElement.dataset.font = fontId;
    localStorage.setItem('moneybook.font', fontId);
    try {
      const raw = localStorage.getItem('moneybook.v1');
      if (raw) {
        const db = JSON.parse(raw);
        if (!db.Profile) db.Profile = {};
        if (!db.Profile.profile) db.Profile.profile = { id: 'profile' };
        db.Profile.profile.font = fontId;
        localStorage.setItem('moneybook.v1', JSON.stringify(db));
      }
    } catch {}
    window.dispatchEvent(new Event('hashchange'));
  };

  const playTestChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const notes = [329.63, 392.00, 493.88, 659.25];
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
  };

  const handleLoadSampleInstant = () => {
    if (!seedData) {
      window.location.hash = '#more/data';
      setIsOpen(false);
      return;
    }

    try {
      const STORE_KEY = 'moneybook.v1';
      let db: any = null;
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) db = JSON.parse(raw);
      } catch (e) {
        console.warn(e);
      }

      if (!db) {
        db = {
          lastSync: '',
          settings: { url: '', token: '' },
          dirty: { Accounts: {}, Ledger: {}, Dues: {}, Purchases: {}, Namaz: {}, Profile: {} },
          Accounts: {},
          Ledger: {},
          Dues: {},
          Purchases: {},
          Namaz: {},
          Profile: {}
        };
      }

      const stamp = new Date().toISOString();

      // Load opening accounts
      if (seedData.opening?.accounts) {
        seedData.opening.accounts.forEach((acc: { name: string; opening: number }) => {
          const id = 'acc-' + acc.name.toLowerCase();
          db.Accounts[id] = { id, name: acc.name, opening: acc.opening, updatedAt: stamp };
          db.dirty.Accounts[id] = true;
        });
      }

      // Load tables
      ['Ledger', 'Dues', 'Purchases', 'Namaz'].forEach((table) => {
        if (Array.isArray(seedData[table])) {
          seedData[table].forEach((rec: any) => {
            const copy = { ...rec, updatedAt: stamp };
            db[table][copy.id] = copy;
            db.dirty[table][copy.id] = true;
          });
        }
      });

      // Set profile start date & category budgets
      db.Profile['profile'] = {
        id: 'profile',
        startDate: seedData.opening?.startDate || '2026-10-01',
        currency: '৳',
        name: 'Demo User',
        theme: currentTheme,
        font: currentFont,
        budgets: {
          _total: 45000,
          'Meal': 4500,
          'Grocery': 10000,
          'Living Cost': 15000,
          'Utility': 3500,
          'Personal': 3000,
          'Transport': 2500,
          'Service Charge': 1000
        },
        namazJamat: {
          Fajr: '05:15',
          Dhuhr: '13:15',
          Asr: '16:30',
          Maghrib: '17:45',
          Isha: '20:00'
        },
        namazAlarm: {
          enabled: true,
          offsetMinutes: 0
        },
        updatedAt: stamp
      };
      db.dirty.Profile['profile'] = true;

      localStorage.setItem(STORE_KEY, JSON.stringify(db));
      setSampleLoaded(true);

      // Trigger re-render of Money Book app
      window.location.hash = '#ledger';
      window.dispatchEvent(new Event('hashchange'));

      setTimeout(() => {
        window.location.reload();
      }, 350);
    } catch (err) {
      console.error(err);
      window.location.hash = '#more/data';
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* Helper Modal (Triggered from More menu) */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center font-bold text-sm">
                  MB
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    Money Book Companion
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Budgets · Namaz Alarms · Themes · Fonts
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-3 pt-2 bg-slate-50/40 dark:bg-slate-800/20 text-xs font-semibold text-slate-600 dark:text-slate-400 gap-1 overflow-x-auto scrollbar-none">
              <button
                onClick={() => setActiveTab('sample')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'sample'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Sample Data
              </button>
              <button
                onClick={() => setActiveTab('budget')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'budget'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <PieChart className="w-3.5 h-3.5" />
                Budgets
              </button>
              <button
                onClick={() => setActiveTab('namaz')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'namaz'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Bell className="w-3.5 h-3.5" />
                Namaz Jamat
              </button>
              <button
                onClick={() => setActiveTab('design')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'design'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                Themes & Fonts
              </button>
              <button
                onClick={() => setActiveTab('cloud')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'cloud'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Google Sheets
              </button>
              <button
                onClick={() => setActiveTab('apk')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'apk'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                APK
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto text-sm text-slate-700 dark:text-slate-300 space-y-4">
              {activeTab === 'sample' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50">
                    <h4 className="font-bold text-violet-950 dark:text-violet-200 flex items-center gap-1.5 mb-1.5">
                      <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                      October 2026 Sample Dataset + Budgets
                    </h4>
                    <p className="text-xs text-violet-800/80 dark:text-violet-300/80 leading-relaxed">
                      Instant 1-click loading of 100+ transactions, 6 bank/mobile-banking balances (Cash, EBL, NRB, Bkash, Nagad, DBBL), active dues, and category spending limits so you can immediately see the new Ledger progress bars in action!
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500 dark:text-slate-400 block">Ledger Records</span>
                      <strong className="text-base text-slate-900 dark:text-white">100 entries</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500 dark:text-slate-400 block">Category Budgets</span>
                      <strong className="text-base text-slate-900 dark:text-white">6 Limits & Ceiling</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500 dark:text-slate-400 block">Dues (Lent / Borrowed)</span>
                      <strong className="text-base text-slate-900 dark:text-white">14 records</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500 dark:text-slate-400 block">Namaz Prayer Log</span>
                      <strong className="text-base text-slate-900 dark:text-white">31 days heatmap</strong>
                    </div>
                  </div>

                  <button
                    onClick={handleLoadSampleInstant}
                    className="w-full py-3 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    {sampleLoaded ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-300" />
                        Sample Loaded! Reloading...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Instant Load October 2026 Data + Budgets
                      </>
                    )}
                  </button>
                </div>
              )}

              {activeTab === 'budget' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
                    <h5 className="font-bold text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <PieChart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Visual Category Spending Limits
                    </h5>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                      In the <b>Ledger</b> view, category spending is automatically tracked against monthly limits with color-coded progress bars:
                    </p>
                    <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Safe (&lt;80%)
                      </span>
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Warning (80-100%)
                      </span>
                      <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Over limit (&gt;100%)
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    You can set custom limits for each category or use the 1-click <b>⚡ Auto-fill</b> button to generate limits calculated from your historical spending habits.
                  </p>

                  <button
                    onClick={() => {
                      window.location.hash = '#ledger';
                      setIsOpen(false);
                      setTimeout(() => {
                        (window as any).budgetForm?.();
                      }, 200);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    <Sliders className="w-4 h-4" />
                    Open Ledger & Set Spending Limits
                  </button>
                </div>
              )}

              {activeTab === 'namaz' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 space-y-1.5">
                    <h5 className="font-bold text-xs text-violet-950 dark:text-violet-200 flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                      Manual Jamat Times & Serene Audio Alarm
                    </h5>
                    <p className="text-xs text-violet-800/80 dark:text-violet-300/80 leading-relaxed">
                      Set manual Jamat (congregation) times for Fajr, Dhuhr, Asr, Maghrib, and Isha. The app plays a harmonious 4-harmonic Web Audio chime and triggers browser notifications right at Jamat time or 5/10/15 minutes prior.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={playTestChime}
                      className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-semibold text-xs text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer transition-colors border border-slate-200 dark:border-slate-700"
                    >
                      <Volume2 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                      Test Audio Chime
                    </button>
                    <button
                      onClick={() => {
                        window.location.hash = '#more/namaz';
                        setIsOpen(false);
                      }}
                      className="py-2.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                    >
                      Open Namaz Tracker
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'design' && (
                <div className="space-y-4">
                  <div>
                    <h5 className="font-bold text-xs text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
                      <Palette className="w-4 h-4 text-violet-600" />
                      Select Color Theme
                    </h5>
                    <div className="grid grid-cols-3 gap-2">
                      {THEMES.map((theme) => (
                        <button
                          key={theme.id}
                          onClick={() => handleSetTheme(theme.id)}
                          className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
                            currentTheme === theme.id
                              ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-600'
                              : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <div
                            className="w-6 h-6 rounded-full shadow-xs"
                            style={{ background: `linear-gradient(135deg, ${theme.c1}, ${theme.c2})` }}
                          />
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                            {theme.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h5 className="font-bold text-xs text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
                      <Type className="w-4 h-4 text-violet-600" />
                      Select Typography Font
                    </h5>
                    <div className="grid grid-cols-2 gap-2">
                      {FONTS.map((font) => (
                        <button
                          key={font.id}
                          onClick={() => handleSetFont(font.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            currentFont === font.id
                              ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-600'
                              : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <span className="text-xs font-bold block text-slate-900 dark:text-white">
                            {font.name}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                            {font.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'cloud' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Google Sheets Automatic Cloud Sync</span>
                    </div>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                      Money Book operates <b>offline first</b> with automatic real-time sync to your personal Google Sheet on Google Drive. 
                      Every historical transaction, category, due, purchase, and book is permanently preserved.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h5 className="font-semibold text-xs text-slate-900 dark:text-white">How Google Sheets sync works:</h5>
                    <ol className="list-decimal list-inside text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      <li>Tap <b>Login with Google</b> in <b>More → Sync</b></li>
                      <li>A dedicated spreadsheet named <span className="font-semibold text-emerald-600">Personal Money Book &amp; Ledger</span> is automatically linked or created in your Google Drive</li>
                      <li>All tabs (Ledger, Dues, Purchases, Books, Namaz, Summary) are organized into clean spreadsheet columns</li>
                      <li>You can open and view your spreadsheet anytime via Google Sheets on web, phone, or tablet!</li>
                    </ol>
                  </div>

                  <button
                    onClick={() => {
                      window.location.hash = '#more/settings';
                      setIsOpen(false);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Open Google Sheets Sync (More → Sync)
                  </button>
                </div>
              )}

              {activeTab === 'apk' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
                    <h5 className="font-bold text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Capacitor Android Project Included
                    </h5>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                      The application contains a ready-to-build Android Capacitor project and a GitHub Actions workflow for zero-install APK builds!
                    </p>
                  </div>

                  <div className="space-y-2 text-xs">
                    <strong className="block text-slate-900 dark:text-white">Build Options:</strong>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 space-y-1">
                      <div className="text-slate-400"># Option A: GitHub Actions (Zero install)</div>
                      <div>Push code to GitHub → Actions → "Build Android APK"</div>
                      <div className="text-slate-400 mt-2"># Option B: Local Android Studio</div>
                      <div>npm run android:sync</div>
                      <div>npm run android:open</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Shortcuts:</span>
                <button
                  onClick={() => {
                    window.location.hash = '#home';
                    setIsOpen(false);
                  }}
                  className="hover:text-violet-600 underline"
                >
                  Home
                </button>
                <span>·</span>
                <button
                  onClick={() => {
                    window.location.hash = '#ledger';
                    setIsOpen(false);
                  }}
                  className="hover:text-violet-600 underline"
                >
                  Ledger
                </button>
                <span>·</span>
                <button
                  onClick={() => {
                    window.location.hash = '#more/namaz';
                    setIsOpen(false);
                  }}
                  className="hover:text-violet-600 underline"
                >
                  Namaz
                </button>
                <span>·</span>
                <button
                  onClick={() => {
                    window.location.hash = '#more/profile';
                    setIsOpen(false);
                  }}
                  className="hover:text-violet-600 underline"
                >
                  Profile
                </button>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
