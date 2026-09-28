// Spendings Tracker
// Set a weekly or monthly spending limit, watch the cash jar empty as you log
// spending, and build a streak of periods finished under the limit.
// Plain HTML, CSS and JavaScript, so it runs on GitHub Pages with no build step.
// Everything is stored in this browser's localStorage. Nothing is sent anywhere.
// A classic deferred script rather than a module, so index.html also works when
// opened straight from disk.

'use strict';

// Storage keys keep the app's first name so data saved before the rename still loads.
const STORAGE_KEY = 'money-tracker:v1';
const THEME_KEY = 'money-tracker:theme';
const MINUS = '−';
const DAY_MS = 864e5;

/* ------------------------------------------------------------ DOM helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) if (value != null) el.setAttribute(key, value);
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V4.5h5V7"/>',
  alert: '<path d="M12 4.5 3 19.5h18L12 4.5z"/><path d="M12 10v4M12 16.8v.2"/>',
};

function icon(name) {
  const el = svg('svg', { class: 'i', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  el.innerHTML = ICONS[name];
  return el;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ dates */

const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function parseDate(iso) {
  const [y, m, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY_MS);

const dateFormat = options => new Intl.DateTimeFormat(undefined, options);
const fmtMonthYear = dateFormat({ month: 'long', year: 'numeric' });
const fmtMonth = dateFormat({ month: 'long' });
const fmtMonthShort = dateFormat({ month: 'short' });
const fmtDayMonth = dateFormat({ day: 'numeric', month: 'short' });
const fmtDayMonthYear = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayLongMonth = dateFormat({ day: 'numeric', month: 'long' });
const fmtWeekday = dateFormat({ weekday: 'long' });
const fmtDay = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayYear = dateFormat({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtLongDate = dateFormat({ day: 'numeric', month: 'long', year: 'numeric' });

function dayLabel(iso) {
  if (iso === today()) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === isoDate(yesterday)) return 'Yesterday';
  const d = parseDate(iso);
  return (d.getFullYear() === new Date().getFullYear() ? fmtDay : fmtDayYear).format(d);
}

/* ---------------------------------------------------------------- periods */

// A period is a week or a month, named by the ISO date it starts on.

function periodStart(iso, type = state.period) {
  const d = parseDate(iso);
  if (type === 'month') d.setDate(1);
  else d.setDate(d.getDate() - ((d.getDay() - state.weekStart + 7) % 7));
  return isoDate(d);
}

function shiftPeriod(start, n, type = state.period) {
  const d = parseDate(start);
  if (type === 'month') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + 7 * n);
  return isoDate(d);
}

function periodEnd(start, type = state.period) {
  const d = parseDate(shiftPeriod(start, 1, type));
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

const currentStart = () => periodStart(today());

// A test for "was this purchase made in the period starting on `start`?"
function periodFilter(start) {
  const end = periodEnd(start);
  return t => t.date >= start && t.date <= end;
}

const spentIn = (start, skipId = null) => {
  const within = periodFilter(start);
  return state.tx.reduce((sum, t) => sum + (t.id !== skipId && within(t) ? t.amount : 0), 0);
};

function rangeLabel(start) {
  const a = parseDate(start);
  const b = parseDate(periodEnd(start));
  const f = a.getFullYear() === new Date().getFullYear() && b.getFullYear() === a.getFullYear() ? fmtDayMonth : fmtDayMonthYear;
  return typeof f.formatRange === 'function' ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}

// "This week", "Last week", "15 – 21 Sep", or "September 2026".
function periodName(start) {
  if (state.period === 'month') return fmtMonthYear.format(parseDate(start));
  const offset = Math.round(daysBetween(currentStart(), start) / 7);
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  if (offset === 1) return 'Next week';
  return rangeLabel(start);
}

// Fits after a verb: "this week", "last week", "in the week of 15 Sep", "in August".
function periodPhrase(start) {
  const d = parseDate(start);
  if (state.period === 'month') {
    if (start === currentStart()) return 'this month';
    return `in ${(d.getFullYear() === new Date().getFullYear() ? fmtMonth : fmtMonthYear).format(d)}`;
  }
  const name = periodName(start);
  return name.includes(' week') ? name.toLowerCase() : `in the week of ${fmtDayMonth.format(d)}`;
}

// When the next period begins: "Monday" or "1 October".
function nextStartName(start) {
  const next = parseDate(shiftPeriod(start, 1));
  return state.period === 'week' ? fmtWeekday.format(next) : fmtDayLongMonth.format(next);
}

/* ------------------------------------------------------------------ money */

// Amounts are stored as whole cents so sums never drift.
let fmt, fmtCompact;

function setupFormatters() {
  fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency });
  fmtCompact = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: state.currency, notation: 'compact', maximumFractionDigits: 1,
  });
  for (const el of $$('[data-currency]')) el.textContent = currencySymbol();
}

const money = cents => fmt.format(Math.abs(cents) / 100);
const currencySymbol = () => fmt.formatToParts(0).find(p => p.type === 'currency')?.value ?? state.currency;

const DECIMAL_SEP = new Intl.NumberFormat().formatToParts(1.5).find(p => p.type === 'decimal')?.value ?? '.';

// Reads what people actually type: "12.50", "12,50", "1,234.56", "1.234,56", "$ 40".
function parseAmount(text) {
  let s = String(text).replace(/[\s  '’]/g, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = null;
  if (lastDot >= 0 && lastComma >= 0) {
    dec = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const single = s.indexOf(sep) === s.lastIndexOf(sep);
    const digitsAfter = s.length - s.lastIndexOf(sep) - 1;
    // "1,234" is a thousands separator unless the locale writes decimals with a comma.
    if (single && (digitsAfter !== 3 || sep === DECIMAL_SEP)) dec = sep;
  }
  if (dec) {
    const [whole, frac = ''] = s.split(dec === '.' ? ',' : '.').join('').split(dec);
    s = `${whole || '0'}.${frac}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const value = Number(s);
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

function amountForInput(cents) {
  let s = (Math.abs(cents) / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  if (DECIMAL_SEP === ',') s = s.replace('.', ',');
  return s;
}

/* ------------------------------------------------------------------ state */

const DEFAULT_CATEGORIES = [
  ['groceries', 'Groceries'],
  ['eating-out', 'Eating out'],
  ['transport', 'Transport'],
  ['shopping', 'Shopping'],
  ['entertainment', 'Entertainment'],
  ['bills', 'Bills'],
  ['housing', 'Housing'],
  ['health', 'Health'],
  ['subscriptions', 'Subscriptions'],
  ['travel', 'Travel'],
  ['gifts', 'Gifts'],
  ['other', 'Other'],
];
// "Other" can't be deleted, so every purchase always has a category.
const FALLBACK = 'other';

const REGION_CURRENCY = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR',
  IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', IN: 'INR', JP: 'JPY',
  CN: 'CNY', KR: 'KRW', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', PH: 'PHP',
  SG: 'SGD', HK: 'HKD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', TR: 'TRY', AE: 'AED',
  SA: 'SAR', ID: 'IDR', MY: 'MYR', TH: 'THB', VN: 'VND', PK: 'PKR', BD: 'BDT', EG: 'EGP', IL: 'ILS',
  AR: 'ARS', CO: 'COP', CL: 'CLP', PE: 'PEN',
};
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'NGN', 'ZAR', 'JPY', 'MXN', 'BRL', 'PHP'];

function isCurrency(code) {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return false;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: code }); return true; } catch { return false; }
}

function guessCurrency() {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    try {
      const region = new Intl.Locale(tag).maximize().region;
      if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    } catch { /* unknown locale tag */ }
  }
  return 'USD';
}

// Monday, Sunday or Saturday, following the locale where the browser says.
function defaultWeekStart() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if ([1, 6, 7].includes(first)) return first % 7;
  } catch { /* no week info */ }
  return 1;
}

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function freshState() {
  return {
    v: 2,
    currency: guessCurrency(),
    period: 'week',
    weekStart: defaultWeekStart(),
    // Every limit you've set, with the period it took effect from. Past periods
    // keep the limit they had, so changing it never rewrites your streak.
    limits: [],
    theme: 'system',
    categories: DEFAULT_CATEGORIES.map(([id, name]) => ({ id, name })),
    tx: [],
    lastCat: null,
    lastBackup: null,
    backupNag: null,
    lastSeen: null,
  };
}

// Validates stored data and backups (including version 1 files), filling gaps instead of failing.
function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tx) || !Array.isArray(data.categories)) {
    throw new Error("This file isn't a Spendings Tracker backup.");
  }
  const rename = id => (id === 'other-expense' ? FALLBACK : id);
  const categories = [];
  const ids = new Set();
  for (const c of data.categories) {
    if (!c || typeof c.id !== 'string' || (c.type && c.type !== 'expense')) continue;
    const id = rename(c.id);
    if (ids.has(id)) continue;
    ids.add(id);
    categories.push({ id, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 40) : 'Untitled' });
  }
  if (!ids.has(FALLBACK)) {
    ids.add(FALLBACK);
    categories.push({ id: FALLBACK, name: 'Other' });
  }
  const tx = [];
  for (const t of data.tx) {
    if (!t || (t.type && t.type !== 'expense') || !Number.isInteger(t.amount) || t.amount <= 0 || !isISODate(t.date)) continue;
    const clean = {
      id: typeof t.id === 'string' && t.id ? t.id : newId(),
      amount: t.amount,
      cat: ids.has(rename(t.cat)) ? rename(t.cat) : FALLBACK,
      date: t.date,
      note: typeof t.note === 'string' ? t.note.trim().slice(0, 120) : '',
      created: Number(t.created) || 0,
    };
    if (t.sample) clean.sample = true;
    tx.push(clean);
  }
  const limits = (Array.isArray(data.limits) ? data.limits : [])
    .filter(e => e && isISODate(e.start) && Number.isInteger(e.amount) && e.amount > 0 && ['week', 'month'].includes(e.period))
    .map(e => ({ start: e.start, amount: e.amount, period: e.period, ...(e.sample ? { sample: true } : {}) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  return {
    v: 2,
    currency: isCurrency(data.currency) ? data.currency : guessCurrency(),
    period: ['week', 'month'].includes(data.period) ? data.period : (limits.at(-1)?.period ?? 'week'),
    weekStart: [0, 1, 6].includes(data.weekStart) ? data.weekStart : defaultWeekStart(),
    limits,
    theme: ['system', 'light', 'dark'].includes(data.theme) ? data.theme : 'system',
    categories,
    tx,
    lastCat: ids.has(data.lastCat) ? data.lastCat : null,
    lastBackup: typeof data.lastBackup === 'string' ? data.lastBackup : null,
    backupNag: typeof data.backupNag === 'string' ? data.backupNag : null,
    lastSeen: isISODate(data.lastSeen) ? data.lastSeen : null,
  };
}

let storageBlocked = false;
let saveFailed = false;

function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { storageBlocked = true; }
  if (!raw) return freshState();
  try {
    return normalize(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy rather than overwrite it on the next save.
    try { localStorage.setItem(`${STORAGE_KEY}:unreadable-${Date.now()}`, raw); } catch { /* full or blocked */ }
    return freshState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}

let state = loadState();

const view = { start: null, cat: null, query: '', table: false };
let highlightId = null;

/* ----------------------------------------------------------- limits, streak */

// The limit that applied to a period, or null if none did (before you set one,
// or before you last switched between weekly and monthly).
function limitFor(start) {
  let found = null;
  for (const e of state.limits) if (e.start <= start && (!found || e.start >= found.start)) found = e;
  return found?.period === state.period ? found.amount : null;
}

const currentLimit = () => limitFor(currentStart());

// A new limit applies from the start of the current period onward.
function setLimit(amount, period) {
  state.period = period;
  const start = currentStart();
  state.limits = state.limits.filter(e => e.start < start);
  state.limits.push({ start, amount, period });
}

function periodTotals() {
  const totals = new Map();
  for (const t of state.tx) {
    const start = periodStart(t.date);
    totals.set(start, (totals.get(start) ?? 0) + t.amount);
  }
  return totals;
}

// The streak counts finished periods in a row that stayed at or under their
// limit. Going over in the current period resets it straight away.
function streakInfo(totals) {
  const now = currentStart();
  const limitNow = limitFor(now);
  const overNow = limitNow != null && (totals.get(now) ?? 0) > limitNow;
  let run = 0;
  let best = 0;
  if (state.limits.length) {
    let p = periodStart(state.limits[0].start);
    for (let guard = 0; p < now && guard < 2000; guard++, p = shiftPeriod(p, 1)) {
      const limit = limitFor(p);
      run = limit != null && (totals.get(p) ?? 0) <= limit ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return { current: overNow ? 0 : run, best, overNow };
}

/* ----------------------------------------------------------------- render */

function render() {
  const focusKey = document.activeElement?.dataset?.key;
  const totals = periodTotals();
  renderTopbar();
  renderHero(totals);
  renderWhere();
  renderHistory(totals);
  renderList();
  renderBanner();
  if (focusKey) focusByKey(focusKey);
}

function focusByKey(key, fallback) {
  const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`) ?? fallback;
  if (el && document.activeElement !== el) el.focus({ preventScroll: true });
}

function renderTopbar() {
  const unit = state.period;
  $('#periodLabel').textContent = periodName(view.start);
  $('#prevPeriod').setAttribute('aria-label', `Previous ${unit}`);
  $('#nextPeriod').setAttribute('aria-label', `Next ${unit}`);
  $('#toCurrent').hidden = view.start === currentStart();
}

/* the hero: jar, what's left, streak */

function renderHero(totals) {
  const setup = !state.limits.length;
  $('#hero').classList.toggle('is-setup', setup);
  $('#setupForm').hidden = !setup;
  $('#heroText').hidden = setup;
  $('#streak').hidden = setup;
  if (setup) {
    $('#hero').classList.remove('is-over');
    setJar(0, null, false);
    return;
  }

  const unit = state.period;
  const start = view.start;
  const now = currentStart();
  const limit = limitFor(start);
  const spent = totals.get(start) ?? 0;
  const guide = $('#heroGuide');
  guide.replaceChildren();

  if (limit == null) {
    $('#hero').classList.remove('is-over');
    $('#heroLabel').textContent = 'Spent';
    showFigure(spent);
    $('#heroOf').textContent = `You didn't have a ${unit === 'week' ? 'weekly' : 'monthly'} limit yet.`;
    setJar(0, null, false);
  } else {
    const left = limit - spent;
    const over = left < 0;
    $('#hero').classList.toggle('is-over', over);
    showFigure(Math.abs(left));

    if (start > now) {
      $('#heroLabel').textContent = 'In the jar';
      $('#heroOf').textContent = `of ${money(limit)}`;
      guide.textContent = `This ${unit} hasn't started yet.`;
      setJar(1, null, false);
    } else if (start < now) {
      $('#heroLabel').textContent = over ? 'Went over by' : 'Left over';
      $('#heroOf').textContent = `${money(spent)} spent of ${money(limit)}`;
      guide.textContent = over ? 'That one broke the streak.' : 'You stayed under your limit.';
      setJar(Math.max(0, left) / limit, null, over);
    } else {
      const end = periodEnd(start);
      const total = daysBetween(start, end) + 1;
      const dayIndex = daysBetween(start, today()) + 1;
      const daysLeft = total - dayIndex + 1;
      $('#heroLabel').textContent = over ? 'Over your limit' : `Left this ${unit}`;
      $('#heroOf').textContent = over ? `${money(spent)} spent of ${money(limit)}` : `of ${money(limit)}`;
      if (over) {
        guide.append(icon('alert'), `Your streak resets. The jar refills on ${nextStartName(start)}.`);
      } else if (left === 0) {
        guide.textContent = `The jar is empty. Anything more goes over your limit until ${nextStartName(start)}.`;
      } else if (daysLeft === 1) {
        guide.textContent = `${money(left)} to spend today, the last day of the ${unit}.`;
      } else {
        const onPace = spent <= (limit * dayIndex) / total;
        const through = unit === 'week' ? fmtWeekday.format(parseDate(end)) : fmtDayLongMonth.format(parseDate(end));
        guide.textContent = `${onPace ? "You're on pace." : "You're spending faster than planned."} ` +
          `That's about ${money(Math.floor(left / daysLeft))} a day through ${through}.`;
      }
      // The pace mark shows where the cash should be by the end of today.
      setJar(Math.max(0, left) / limit, over ? null : 1 - dayIndex / total, over);
    }
  }
  renderStreak(streakInfo(totals));
}

let displayedFigure = null;
let figureFrame = 0;

function showFigure(target) {
  $('#heroFigureText').textContent = money(target);
  cancelAnimationFrame(figureFrame);
  if (displayedFigure === null || displayedFigure === target || reduceMotion()) {
    paintFigure(target);
    return;
  }
  const from = displayedFigure;
  const begin = performance.now();
  const step = now => {
    const p = Math.min(1, (now - begin) / 600);
    paintFigure(Math.round(from + (target - from) * (1 - (1 - p) ** 3)));
    if (p < 1) figureFrame = requestAnimationFrame(step);
  };
  figureFrame = requestAnimationFrame(step);
}

// Price-tag setting: a wide, heavy figure with the currency sign and cents raised.
function paintFigure(cents) {
  displayedFigure = cents;
  const nodes = [];
  let seenNumber = false;
  for (const part of fmt.formatToParts(Math.abs(cents) / 100)) {
    const last = nodes[nodes.length - 1];
    if (part.type === 'integer' || part.type === 'group') {
      if (last?.className === 'int') last.textContent += part.value;
      else nodes.push(h('span', { class: 'int' }, part.value));
      seenNumber = true;
    } else if (part.type === 'decimal' || part.type === 'fraction') {
      if (last?.className === 'frac') last.textContent += part.value;
      else nodes.push(h('span', { class: 'frac' }, part.value));
    } else if (part.type === 'currency') {
      nodes.push(h('span', { class: seenNumber ? 'cur cur-after' : 'cur' }, part.value));
    }
  }
  $('#heroFigure').replaceChildren(...nodes);
  fitFigure();
}

function fitFigure() {
  const el = $('#heroFigure');
  el.style.fontSize = '';
  const room = el.clientWidth;
  if (room > 0 && el.scrollWidth > room) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${Math.max(24, Math.floor((size * room) / el.scrollWidth))}px`;
  }
}

/* the jar */

const JAR = { width: 230, height: 242, bills: 20, floor: 232, ceiling: 96 };
const GLASS_PATH = 'M62 40C62 58 26 60 26 90V216Q26 240 50 240H150Q174 240 174 216V90C174 60 138 58 138 40';
let jarBills = [];
let jarCount = 0;
let jarTarget = 0;
let jarState = 'new'; // new, then waiting for the first frame, then live

// An open mason jar with a pile of bills in it. Each bill is its own element
// so it can fly out of the jar when you spend and drop back in when it refills.
function buildJar() {
  const root = $('#jar');
  root.setAttribute('viewBox', `0 0 ${JAR.width} ${JAR.height}`);
  const rand = mulberry32(11);
  const step = (JAR.floor - JAR.ceiling) / JAR.bills;
  const pile = svg('g');
  jarBills = Array.from({ length: JAR.bills }, (_, i) => {
    const x = 100 + (rand() - 0.5) * 10;
    const y = JAR.floor - i * step - 9;
    const tilt = (rand() - 0.5) * (4 + i * 0.4);
    const flip = rand() < 0.5 ? -1 : 1;
    const bill = svg('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(${flip} 1)` },
      svg('rect', { class: `bill-body tone-${i % 3}`, x: -58, y: -9, width: 116, height: 18, rx: 2.5 }),
      svg('rect', { class: 'bill-line', x: -54, y: -5.5, width: 108, height: 11, rx: 1.5 }),
      svg('circle', { class: 'bill-line', cx: -36, cy: 0, r: 3.6 }),
      svg('ellipse', { class: 'bill-line', cx: 12, cy: 0, rx: 10, ry: 3.2 }));
    const flyer = svg('g', {
      class: 'bill is-out',
      style: `--fx:${Math.round((rand() - 0.5) * 90)}px;--fr:${Math.round((rand() - 0.5) * 70)}deg`,
    }, bill);
    pile.append(flyer);
    return flyer;
  });
  root.replaceChildren(
    svg('path', { class: 'glass-back', d: `${GLASS_PATH}Z` }),
    pile,
    svg('path', { class: 'glass-front', d: GLASS_PATH }),
    svg('path', { class: 'glass-shine', d: 'M42 110C39 140 39 180 42 212' }),
    svg('rect', { class: 'jar-rim', x: 56, y: 24, width: 88, height: 18, rx: 5 }),
    svg('path', { class: 'jar-thread', d: 'M60 30.5H140M60 36H140' }),
    svg('g', { class: 'pace-mark', id: 'paceMark', style: 'display:none' },
      svg('line', { x1: 180, x2: 192, y1: 0, y2: 0 }),
      svg('text', { class: 'pace-label', x: 197, y: 0, dy: '0.35em', stroke: 'none' }, 'pace')),
  );
}

// fraction: how full the jar is (0 to 1). pace: where the cash should be by
// tonight, or null to hide the mark.
function setJar(fraction, pace, over) {
  jarTarget = fraction > 0 ? Math.max(1, Math.round(fraction * JAR.bills)) : 0;
  if (jarState === 'live') {
    applyJar();
  } else if (jarState === 'new') {
    // The first fill waits for a painted frame so the bills visibly drop in when the app opens.
    jarState = 'waiting';
    requestAnimationFrame(() => requestAnimationFrame(() => { jarState = 'live'; applyJar(); }));
  }

  $('#jar').classList.toggle('is-over', over);
  const mark = $('#paceMark');
  mark.style.display = pace == null ? 'none' : '';
  if (pace != null) mark.style.transform = `translateY(${JAR.floor - pace * (JAR.floor - JAR.ceiling)}px)`;
}

function applyJar() {
  const target = jarTarget;
  const leaving = target < jarCount;
  jarBills.forEach((bill, i) => {
    const show = i < target;
    if (bill.classList.contains('is-out') !== show) return;
    // Top bills leave first; refills land from the bottom up.
    const order = leaving ? jarCount - 1 - i : i - jarCount;
    bill.style.transitionDelay = `${Math.max(0, order) * (leaving ? 45 : 30)}ms`;
    bill.classList.toggle('is-out', !show);
  });
  jarCount = target;
}

/* the streak seal */

function buildSeal() {
  const points = [];
  for (let i = 0; i <= 360; i += 2) {
    const a = (i / 180) * Math.PI;
    const r = 34 + 2.4 * Math.cos(18 * a);
    points.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  $('#seal').replaceChildren(
    svg('path', { class: 'seal-edge', d: `M${points.join('L')}Z` }),
    svg('circle', { class: 'seal-ring', r: 27 }),
    svg('text', { class: 'seal-num', id: 'sealNum', x: 0, y: 1 }),
  );
}

function renderStreak({ current, best, overNow }) {
  const unit = state.period;
  const limit = currentLimit();
  $('#seal').classList.toggle('is-empty', current === 0);
  $('#sealNum').textContent = String(current);
  const bestLine = best > current ? ` Your best is ${best}.` : '';
  let title;
  let sub;
  if (current > 0) {
    title = `${current}-${unit} streak`;
    sub = limit != null ? `Stay under ${money(limit)} this ${unit} to make it ${current + 1}.` : '';
    sub += best > current ? bestLine : current > 1 ? ' Your best yet.' : '';
  } else if (overNow) {
    title = 'Streak reset';
    sub = `You went over this ${unit}. Finish next ${unit} under your limit to start again.${bestLine}`;
  } else {
    title = 'No streak yet';
    sub = `Finish this ${unit} under your limit to start one.${bestLine}`;
  }
  $('#streakTitle').textContent = title;
  $('#streakSub').textContent = sub.trim();
}

/* where it went */

function renderWhere() {
  const spent = new Map();
  const within = periodFilter(view.start);
  let total = 0;
  for (const t of state.tx) {
    if (!within(t)) continue;
    spent.set(t.cat, (spent.get(t.cat) ?? 0) + t.amount);
    total += t.amount;
  }
  const rows = state.categories
    .filter(c => spent.get(c.id))
    .map(c => ({ cat: c, amount: spent.get(c.id) }))
    .sort((a, b) => b.amount - a.amount || a.cat.name.localeCompare(b.cat.name));
  const phrase = periodPhrase(view.start);
  $('#whereSub').textContent = total ? `${money(total)} spent ${phrase}, by category.` : '';

  const max = Math.max(1, ...rows.map(r => r.amount));
  $('#whereList').replaceChildren(...rows.map(({ cat, amount }) => h('li', null,
    h('button', {
      class: 'cat',
      type: 'button',
      'aria-pressed': String(view.cat === cat.id),
      dataset: { key: `cat:${cat.id}` },
      onclick: () => toggleCategory(cat.id),
    },
    h('span', { class: 'cat-name' }, cat.name),
    h('span', { class: 'cat-val' }, money(amount)),
    h('span', { class: 'meter', 'aria-hidden': 'true' },
      h('span', { class: 'meter-fill', style: `width:${((amount / max) * 100).toFixed(3)}%` }))))));

  const empty = $('#whereEmpty');
  empty.hidden = total > 0;
  empty.textContent = `Nothing spent ${phrase}${view.start >= currentStart() ? ' yet' : ''}.`;
}

function toggleCategory(id) {
  view.cat = view.cat === id ? null : id;
  render();
  if (view.cat) {
    const list = $('#transactions');
    if (list.getBoundingClientRect().top > innerHeight - 120) {
      list.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }
}

/* past weeks or months */

const measure = document.createElement('canvas').getContext('2d');
function textWidth(text) {
  measure.font = '12px Archivo, ui-sans-serif, system-ui, sans-serif';
  return measure.measureText(text).width;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const n = raw / magnitude;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * magnitude;
}

// A column with a 4px rounded data end and a square foot on the baseline.
function columnPath(x, y, w, height, r) {
  r = Math.min(r, w / 2, height);
  const f = n => +n.toFixed(2);
  return `M${f(x)},${f(y + height)}V${f(y + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)}` +
    `H${f(x + w - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + height)}Z`;
}

function historyRows(totals) {
  const count = state.period === 'week' ? 8 : 6;
  return Array.from({ length: count }, (_, i) => {
    const start = shiftPeriod(view.start, i - count + 1);
    return { start, spent: totals.get(start) ?? 0, limit: limitFor(start) };
  });
}

function verdict(r) {
  if (r.limit == null) return 'No limit set';
  const diff = r.limit - r.spent;
  return diff >= 0 ? `${money(diff)} under the ${money(r.limit)} limit` : `${money(-diff)} over the ${money(r.limit)} limit`;
}

function renderHistory(totals) {
  const unit = state.period;
  const box = $('#historyChart');
  const rows = historyRows(totals);
  const hasData = rows.some(r => r.spent);
  $('#historyTitle').textContent = unit === 'week' ? 'Past weeks' : 'Past months';
  $('#historyEmpty').hidden = hasData;
  $('#historyEmpty').textContent = `Your past ${unit}s will show up here, next to your limit, once you start logging.`;
  $('#historyToggle').hidden = !hasData;
  $('#historyLegend').hidden = !hasData || view.table;
  $('#historyToggle').textContent = view.table ? 'Show chart' : 'Show table';
  $('#historyToggle').setAttribute('aria-pressed', String(view.table));
  box.replaceChildren();
  if (!hasData) return;
  if (view.table) box.append(historyTable(rows));
  else drawHistory(box, rows);
}

function drawHistory(box, rows) {
  const width = Math.max(260, Math.round(box.clientWidth || 320));
  const height = 216;
  const top = 24;
  const bottom = 28;
  const plotH = height - top - bottom;

  const peak = Math.max(...rows.flatMap(r => [r.spent, r.limit ?? 0])) / 100;
  const step = niceStep(peak / 4);
  const yMax = Math.max(step, Math.ceil(peak / step) * step);
  const ticks = [];
  for (let k = 0; k * step <= yMax + step / 2; k++) ticks.push(k * step);
  const tickText = ticks.map(v => fmtCompact.format(v));
  const left = Math.ceil(Math.max(...tickText.map(textWidth))) + 12;
  const band = (width - left) / rows.length;
  const barW = Math.min(28, Math.max(8, band * 0.42));
  const labelEvery = band < 46 ? 2 : 1;
  const y = v => top + plotH - (v / yMax) * plotH;
  const baseY = Math.round(y(0)) + 0.5;

  const bands = svg('g');
  const grid = svg('g', { 'aria-hidden': 'true' });
  const marks = svg('g', { 'aria-hidden': 'true' });
  const hits = svg('g');

  ticks.forEach((v, i) => {
    const ty = Math.round(y(v)) + 0.5;
    if (i) grid.append(svg('line', { class: 'grid-line', x1: left, x2: width, y1: ty, y2: ty }));
    grid.append(svg('text', { class: 'axis-label', x: left - 12, y: ty, dy: '0.35em', 'text-anchor': 'end' }, tickText[i]));
  });

  const tops = [];
  const backgrounds = rows.map((r, i) => {
    const x0 = left + i * band;
    const cx = x0 + band / 2;
    const isView = r.start === view.start;
    const bg = svg('rect', {
      class: `band-bg${isView ? ' is-current' : ''}`,
      x: (x0 + 3).toFixed(2), y: top - 18, width: (band - 6).toFixed(2), height: plotH + bottom + 14, rx: 8,
    });
    bands.append(bg);
    const status = r.limit == null ? 'none' : r.spent > r.limit ? 'over' : 'under';
    let barTop = baseY;
    if (r.spent) {
      barTop = Math.min(y(r.spent / 100), baseY - 2);
      marks.append(svg('path', { class: `bar-${status}`, d: columnPath(cx - barW / 2, barTop, barW, baseY - barTop, 4) }));
    }
    if (r.limit != null) {
      const ly = Math.round(y(r.limit / 100)) + 0.5;
      marks.append(svg('line', { class: 'limit-mark', x1: cx - barW / 2 - 5, x2: cx + barW / 2 + 5, y1: ly, y2: ly }));
    }
    // Over-limit columns carry an icon too, so the colour never works alone.
    if (status === 'over') {
      const flag = svg('g', { class: 'over-icon', transform: `translate(${(cx - 7.2).toFixed(2)} ${(barTop - 18).toFixed(2)}) scale(.6)` });
      flag.innerHTML = ICONS.alert;
      marks.append(flag);
    }
    if ((rows.length - 1 - i) % labelEvery === 0) {
      const d = parseDate(r.start);
      marks.append(svg('text', {
        class: `axis-label${isView ? ' is-current' : ''}`, x: cx.toFixed(2), y: height - 8, 'text-anchor': 'middle',
      }, state.period === 'week' ? fmtDayMonth.format(d) : fmtMonthShort.format(d)));
    }
    tops.push(Math.min(barTop, r.limit != null ? y(r.limit / 100) : baseY));
    return bg;
  });
  marks.append(svg('line', { class: 'base-line', x1: left, x2: width, y1: baseY, y2: baseY }));

  const tip = h('div', { class: 'tip', hidden: true, 'aria-hidden': 'true' });
  const showTip = i => {
    const r = rows[i];
    const ongoing = r.start === currentStart();
    tip.replaceChildren(
      h('p', { class: 'tip-title' }, state.period === 'week' ? rangeLabel(r.start) : fmtMonthYear.format(parseDate(r.start))),
      h('p', null, h('strong', null, money(r.spent)), ongoing ? ' spent so far' : ' spent'),
      h('p', { class: 'tip-note' }, verdict(r)),
    );
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    const cx = left + (i + 0.5) * band;
    tip.style.left = `${Math.min(Math.max(cx, half), width - half)}px`;
    tip.style.top = `${Math.max(tops[i] - 16, 0)}px`;
    backgrounds.forEach((bg, j) => bg.classList.toggle('is-hover', j === i));
  };
  const hideTip = () => {
    tip.hidden = true;
    backgrounds.forEach(bg => bg.classList.remove('is-hover', 'is-focus'));
  };

  rows.forEach((r, i) => {
    const hit = svg('rect', {
      class: 'band', x: (left + i * band).toFixed(2), y: 0, width: band.toFixed(2), height,
      tabindex: '0', role: 'button', 'data-key': `band:${r.start}`,
      'aria-label': `Go to ${state.period === 'week' ? `the week of ${rangeLabel(r.start)}` : fmtMonthYear.format(parseDate(r.start))}. ${money(r.spent)} spent, ${verdict(r)}.`,
    });
    hit.addEventListener('pointerenter', () => showTip(i));
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('focus', () => { showTip(i); backgrounds[i].classList.add('is-focus'); });
    hit.addEventListener('blur', hideTip);
    hit.addEventListener('click', () => goPeriod(r.start));
    hit.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goPeriod(r.start); }
    });
    hits.append(hit);
  });

  box.append(
    svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, role: 'group',
      'aria-label': `Spending for the last ${rows.length} ${state.period}s, against your limit`,
    }, bands, grid, marks, hits),
    tip,
  );
}

function historyTable(rows) {
  return h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, `Spending for the last ${rows.length} ${state.period}s, against your limit`),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, state.period === 'week' ? 'Week' : 'Month'),
      h('th', { scope: 'col' }, 'Spent'),
      h('th', { scope: 'col' }, 'Limit'),
      h('th', { scope: 'col' }, 'Result'))),
    h('tbody', null, [...rows].reverse().map(r => {
      const over = r.limit != null && r.spent > r.limit;
      return h('tr', { class: r.start === view.start ? 'is-current' : null },
        h('th', { scope: 'row' }, state.period === 'week' ? rangeLabel(r.start) : fmtMonthYear.format(parseDate(r.start))),
        h('td', null, money(r.spent)),
        h('td', null, r.limit == null ? 'None' : money(r.limit)),
        h('td', { class: over ? 'is-over' : null },
          r.limit == null ? '' : over ? `${money(r.spent - r.limit)} over` : `${money(r.limit - r.spent)} under`));
    })));
}

/* the spending list */

function renderList() {
  const box = $('#txList');
  const names = new Map(state.categories.map(c => [c.id, c.name]));
  const inView = state.tx.filter(periodFilter(view.start));
  const q = view.query.trim().toLocaleLowerCase();
  const items = inView
    .filter(t => !view.cat || t.cat === view.cat)
    .filter(t => !q || t.note.toLocaleLowerCase().includes(q) || (names.get(t.cat) ?? '').toLocaleLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  const chip = $('#activeFilter');
  chip.hidden = !view.cat;
  chip.replaceChildren(...(view.cat ? [h('button', {
    class: 'filter-chip', type: 'button', dataset: { key: 'filter-chip' },
    'aria-label': `Showing ${names.get(view.cat) ?? 'one category'} only. Show all categories.`,
    onclick: () => { view.cat = null; render(); $('#txTitle').focus(); },
  }, names.get(view.cat) ?? 'Category', icon('close'))] : []));

  if (!inView.length) {
    box.replaceChildren(h('div', { class: 'empty-block' },
      h('p', { class: 'empty' }, state.limits.length
        ? `Nothing logged ${periodPhrase(view.start)}. Every purchase you add takes cash out of the jar.`
        : 'Set your limit above, then log what you spend. Each purchase takes cash out of the jar.'),
      state.limits.length
        ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openTx() }, icon('plus'), 'Add spending')
        : null));
    return;
  }
  if (!items.length) {
    box.replaceChildren(h('div', { class: 'empty-block' },
      h('p', { class: 'empty' }, 'Nothing matches these filters.'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: clearFilters }, 'Clear filters')));
    return;
  }

  const days = new Map();
  for (const t of items) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }
  box.replaceChildren(...Array.from(days, ([date, list]) => h('section', { class: 'day' },
    h('h3', { class: 'day-head' },
      h('span', null, dayLabel(date)),
      h('span', { class: 'day-total' }, money(list.reduce((sum, t) => sum + t.amount, 0)))),
    h('ul', { class: 'tx-items' }, list.map(t => h('li', null, txRow(t, names)))))));
  highlightId = null;
}

function txRow(t, names) {
  const cat = names.get(t.cat) ?? 'Other';
  return h('button', {
    class: `tx${t.id === highlightId ? ' is-new' : ''}`,
    type: 'button',
    dataset: { key: `tx:${t.id}` },
    onclick: () => openTx(t.id),
  },
  h('span', { class: 'tx-main' },
    h('span', { class: 'tx-title' }, t.note || cat),
    t.note ? h('span', { class: 'tx-cat' }, cat) : null),
  h('span', { class: 'tx-amt' }, money(t.amount)));
}

function clearFilters() {
  view.cat = null;
  view.query = '';
  $('#search').value = '';
  render();
}

function goPeriod(start) {
  view.start = start;
  render();
}

/* banner */

function needsBackupReminder() {
  if (state.tx.filter(t => !t.sample).length < 15) return false;
  const since = iso => (iso ? Date.now() - Date.parse(iso) : Infinity);
  return since(state.lastBackup) > 30 * DAY_MS && since(state.backupNag) > 7 * DAY_MS;
}

function renderBanner() {
  const banner = $('#banner');
  let content = null;
  let warning = false;
  if (storageBlocked || saveFailed) {
    warning = true;
    content = [h('p', null, "This browser isn't letting Spendings Tracker save. Allow site data for this page, or your changes will be gone when you close it.")];
  } else if (state.tx.some(t => t.sample)) {
    content = [
      h('p', null, "You're looking at sample data. Clear it when you're ready to fill your own jar."),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: clearSample }, 'Clear sample data'),
    ];
  } else if (needsBackupReminder()) {
    content = [
      h('p', null, "Your data only lives in this browser. Export a backup so you don't lose your streak."),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: exportBackup }, 'Export backup'),
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => { state.backupNag = new Date().toISOString(); save(); renderBanner(); },
      }, 'Not now'),
    ];
  }
  banner.hidden = !content;
  banner.classList.toggle('is-warning', warning);
  banner.replaceChildren(...(content ? [h('div', { class: 'banner-inner', role: warning ? 'alert' : null }, content)] : []));
}

/* ------------------------------------------------------------ first limit */

function submitSetup(e) {
  e.preventDefault();
  const amount = parseAmount($('#setupAmount').value);
  const error = $('#setupError');
  if (!(amount > 0) || amount >= 1e13) {
    error.textContent = 'Enter a limit greater than zero.';
    error.hidden = false;
    $('#setupAmount').focus();
    return;
  }
  error.hidden = true;
  setLimit(amount, $('input[name="setupPeriod"]:checked').value);
  state.lastSeen = currentStart();
  view.start = currentStart();
  save();
  render();
  // The form is gone; move focus to what replaced it so the result is read out.
  $('#heroText').focus();
}

/* ------------------------------------------------------------- add sheet */

const txDialog = $('#txDialog');
const txForm = $('#txForm');
let editingId = null;
let categoryTouched = false;
let txReturnKey = null;

const txCategory = () => txForm.querySelector('input[name="txCat"]:checked')?.value;

function defaultDate() {
  const now = today();
  if (now >= view.start && now <= periodEnd(view.start)) return now;
  return view.start < now ? periodEnd(view.start) : view.start;
}

function openTx(id = null) {
  const t = id ? state.tx.find(x => x.id === id) : null;
  editingId = t?.id ?? null;
  categoryTouched = !!t;
  txReturnKey = t ? `tx:${t.id}` : null;
  $('#txAmount').value = t ? amountForInput(t.amount) : '';
  $('#txDate').value = t?.date ?? defaultDate();
  $('#txNote').value = t?.note ?? '';
  $('#txDialogTitle').textContent = t ? 'Edit spending' : 'Add spending';
  $('#txSubmit').textContent = t ? 'Save' : 'Add';
  $('#txDelete').hidden = !t;
  setAmountError('');
  renderTxCategories(t?.cat ?? view.cat ?? state.lastCat);
  renderNoteSuggestions();
  updateJarHint();
  showSheet(txDialog);
  // preventScroll: the field is already on screen, so don't let the browser shift the page.
  if (!t) $('#txAmount').focus({ preventScroll: true });
}

// A modal sheet locks the page behind it, so if a browser ever fails to draw
// one, close it again rather than leave the page dimmed and unusable.
function showSheet(dialog) {
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dialog.open && dialog.getBoundingClientRect().height < 40) {
      dialog.close();
      toast("That didn't open properly. Reload the page and try again.");
    }
  }));
}

function renderTxCategories(selected) {
  if (!state.categories.some(c => c.id === selected)) selected = state.categories[0]?.id;
  $('#txCats').replaceChildren(
    ...state.categories.map(c => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'txCat', value: c.id, checked: c.id === selected }),
      h('span', null, c.name))),
    newCategoryButton(),
  );
}

// "+ New" turns into a text field so a category can be added without leaving the form.
function newCategoryButton() {
  const button = h('button', { class: 'chip-new', type: 'button' }, icon('plus'), 'New');
  button.addEventListener('click', () => {
    const input = h('input', { class: 'chip-input', maxlength: '40', placeholder: 'Category name', 'aria-label': 'New category name' });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      let chosen = txCategory();
      if (name) {
        const existing = state.categories.find(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        chosen = (existing ?? addCategory(name)).id;
        categoryTouched = true;
      }
      renderTxCategories(chosen);
      txForm.querySelector(`input[name="txCat"][value="${CSS.escape(chosen ?? '')}"]`)?.focus();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
    });
    input.addEventListener('blur', finish);
    button.replaceWith(input);
    input.focus();
  });
  return button;
}

function renderNoteSuggestions() {
  const seen = new Set();
  const options = [];
  for (let i = state.tx.length - 1; i >= 0 && options.length < 50; i--) {
    const note = state.tx[i].note;
    const key = note.toLocaleLowerCase();
    if (!note || seen.has(key)) continue;
    seen.add(key);
    options.push(h('option', { value: note }));
  }
  $('#noteSuggestions').replaceChildren(...options);
}

function setAmountError(message) {
  const el = $('#txAmountError');
  el.textContent = message;
  el.hidden = !message;
  $('#txAmount').setAttribute('aria-invalid', message ? 'true' : 'false');
}

// Live preview of what this purchase does to its jar.
function updateJarHint() {
  const hint = $('#txJarHint');
  const date = isISODate($('#txDate').value) ? $('#txDate').value : today();
  const start = periodStart(date);
  const limit = limitFor(start);
  if (limit == null) { hint.textContent = ''; return; }
  const others = spentIn(start, editingId);
  const typed = parseAmount($('#txAmount').value);
  const amount = typed > 0 ? typed : 0;
  const leftBefore = limit - others;
  const leftAfter = leftBefore - amount;
  const phrase = periodPhrase(start);
  if (!amount) {
    hint.textContent = leftBefore >= 0
      ? `${money(leftBefore)} left in the jar ${phrase}.`
      : `Already ${money(-leftBefore)} over the limit ${phrase}.`;
  } else if (leftAfter >= 0) {
    hint.textContent = `Leaves ${money(leftAfter)} in the jar ${phrase}.`;
  } else {
    hint.textContent = leftBefore >= 0
      ? `Takes you ${money(-leftAfter)} over the limit ${phrase}.`
      : `${money(-leftAfter)} over the limit ${phrase}.`;
  }
}

function submitTx(e) {
  e.preventDefault();
  const amount = parseAmount($('#txAmount').value);
  if (!(amount > 0)) {
    setAmountError('Enter an amount greater than zero.');
    $('#txAmount').focus();
    return;
  }
  if (amount >= 1e13) {
    setAmountError('That amount is too large.');
    $('#txAmount').focus();
    return;
  }
  const cat = txCategory() ?? FALLBACK;
  const date = isISODate($('#txDate').value) ? $('#txDate').value : today();
  const note = $('#txNote').value.trim().slice(0, 120);
  const start = periodStart(date);
  const limit = limitFor(start);
  const spentBefore = spentIn(start, editingId);

  const existing = editingId ? state.tx.find(t => t.id === editingId) : null;
  let id;
  if (existing) {
    Object.assign(existing, { amount, cat, date, note });
    id = existing.id;
  } else {
    id = newId();
    state.tx.push({ id, amount, cat, date, note, created: Date.now() });
  }
  state.lastCat = cat;
  save();
  // If the button that opened the sheet is gone after re-rendering, focus lands on this row.
  txReturnKey = `tx:${id}`;
  txDialog.close();
  highlightId = id;
  render();

  if (start !== view.start) {
    toast(`${existing ? 'Moved' : 'Added'} to ${periodName(start).replace(/^(This|Last|Next)/, m => m.toLowerCase())}`, 'Show', () => {
      goPeriod(start);
      focusByKey(`tx:${id}`);
    });
  } else if (limit != null && start === currentStart()) {
    const left = limit - spentBefore - amount;
    if (left >= 0) toast(`${money(left)} left this ${state.period}`);
    else if (limit - spentBefore >= 0) toast(`That's ${money(-left)} over your limit. Your streak resets.`);
    else toast(`${money(-left)} over your limit this ${state.period}`);
  }
}

function deleteTx() {
  const index = state.tx.findIndex(t => t.id === editingId);
  if (index < 0) return;
  const [removed] = state.tx.splice(index, 1);
  save();
  txDialog.close();
  render();
  toast('Deleted', 'Undo', () => {
    state.tx.push(removed);
    highlightId = removed.id;
    save();
    render();
  });
}

/* --------------------------------------------------------------- settings */

const settingsDialog = $('#settingsDialog');

function openSettings() {
  renderSettings();
  $('#dataMsg').textContent = '';
  $('#catAddMsg').textContent = '';
  showSheet(settingsDialog);
}

function renderSettings() {
  const limit = currentLimit();
  $('#setLimit').value = limit != null ? amountForInput(limit) : '';
  for (const r of $$('input[name="setPeriod"]')) r.checked = r.value === state.period;
  $('#setWeekStart').value = String(state.weekStart);
  $('#weekStartField').hidden = state.period !== 'week';
  const select = $('#setCurrency');
  if (!select.options.length || !Array.from(select.options).some(o => o.value === state.currency)) {
    select.replaceChildren(...currencyOptions());
  }
  select.value = state.currency;
  for (const r of $$('input[name="theme"]')) r.checked = r.value === state.theme;
  renderCategoryEditors();
  renderLastBackup();
  $('#clearSample').hidden = !state.tx.some(t => t.sample);
  renderInstall();
}

function currencyOptions() {
  let codes = [];
  try { codes = Intl.supportedValuesOf('currency'); } catch { /* older browsers */ }
  if (!codes.length) codes = [...new Set([...COMMON_CURRENCIES, ...Object.values(REGION_CURRENCY)])];
  let names = null;
  try { names = new Intl.DisplayNames(undefined, { type: 'currency' }); } catch { /* older browsers */ }
  const label = code => `${names?.of(code) ?? code} (${code})`;
  const common = [...new Set([state.currency, guessCurrency(), ...COMMON_CURRENCIES])].filter(isCurrency);
  const rest = codes.filter(c => !common.includes(c) && isCurrency(c))
    .map(code => ({ code, text: label(code) }))
    .sort((a, b) => a.text.localeCompare(b.text));
  return [
    h('optgroup', { label: 'Common' }, common.map(code => h('option', { value: code }, label(code)))),
    h('optgroup', { label: 'All currencies' }, rest.map(o => h('option', { value: o.code }, o.text))),
  ];
}

// Switching between weekly and monthly converts the amount (52 weeks in 12 months)
// and rounds it to a tidy number you can adjust.
function convertLimit(cents, to) {
  const raw = to === 'month' ? (cents * 52) / 12 : (cents * 12) / 52;
  const unit = raw >= 100000 ? 5000 : raw >= 10000 ? 1000 : 100;
  return Math.max(unit, Math.round(raw / unit) * unit);
}

function changePeriod(period) {
  if (period === state.period) return;
  const limit = currentLimit();
  if (limit != null) setLimit(convertLimit(limit, period), period);
  else state.period = period;
  view.start = currentStart();
  save();
  render();
  renderSettings();
}

function changeWeekStart(day) {
  state.weekStart = day;
  // Line up existing weekly limits with the new first day of the week.
  const byStart = new Map();
  for (const e of state.limits) {
    const start = e.period === 'week' ? periodStart(e.start, 'week') : e.start;
    byStart.set(start, { ...e, start });
  }
  state.limits = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  view.start = periodStart(view.start);
  state.lastSeen = currentStart();
  save();
  render();
}

function renderCategoryEditors() {
  $('#setCats').replaceChildren(...state.categories.map(c => {
    const name = h('input', { value: c.name, maxlength: '40', autocomplete: 'off', 'aria-label': `Name of ${c.name}` });
    name.addEventListener('change', () => {
      const value = name.value.trim();
      if (value) { c.name = value.slice(0, 40); save(); render(); }
      name.value = c.name;
    });
    return h('li', null, name, c.id === FALLBACK
      ? h('span')
      : h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${c.name}`, onclick: () => deleteCategory(c.id) }, icon('trash')));
  }));
}

function addCategory(name) {
  const cat = { id: newId(), name: name.slice(0, 40) };
  const other = state.categories.findIndex(c => c.id === FALLBACK);
  state.categories.splice(other < 0 ? state.categories.length : other, 0, cat);
  save();
  return cat;
}

function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  const used = state.tx.filter(t => t.cat === id).length;
  const question = used ? `Delete “${cat.name}”? Its ${plural(used, 'purchase')} will move to Other.` : `Delete “${cat.name}”?`;
  if (!confirm(question)) return;
  for (const t of state.tx) if (t.cat === id) t.cat = FALLBACK;
  state.categories = state.categories.filter(c => c.id !== id);
  if (state.lastCat === id) state.lastCat = null;
  if (view.cat === id) view.cat = null;
  save();
  renderCategoryEditors();
  render();
}

function renderLastBackup() {
  $('#lastBackup').textContent = state.lastBackup
    ? `Last backup: ${fmtLongDate.format(new Date(state.lastBackup))}.`
    : "You haven't exported a backup yet.";
}

const setDataMsg = text => { $('#dataMsg').textContent = text; };

/* ------------------------------------------------------------ data in/out */

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportBackup() {
  state.lastBackup = new Date().toISOString();
  save();
  const payload = { app: 'spendings-tracker', exportedAt: state.lastBackup, ...state };
  download(`spendings-tracker-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  renderBanner();
  if (settingsDialog.open) {
    renderLastBackup();
    setDataMsg('Backup exported. Keep the file somewhere safe, like cloud storage or email.');
  } else {
    toast('Backup exported');
  }
}

function exportCsv() {
  // A leading = + - @ would run as a formula in spreadsheet apps, so quote it.
  const cell = value => {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const names = new Map(state.categories.map(c => [c.id, c.name]));
  const rows = [['Date', 'Category', `Amount (${state.currency})`, 'Note'].map(cell).join(',')];
  const sorted = [...state.tx].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  for (const t of sorted) {
    rows.push([cell(t.date), cell(names.get(t.cat) ?? 'Other'), (t.amount / 100).toFixed(2), cell(t.note)].join(','));
  }
  download(`spendings-tracker-${today()}.csv`, `﻿${rows.join('\r\n')}\r\n`, 'text/csv;charset=utf-8');
  setDataMsg(`Exported ${plural(state.tx.length, 'purchase')} as a spreadsheet file.`);
}

async function importBackup(file) {
  try {
    const data = normalize(JSON.parse(await file.text()));
    const n = data.tx.length;
    if (!confirm(`Replace everything in this browser with “${file.name}”? It has ${plural(n, 'purchase')}. Your current data will be overwritten.`)) return;
    state = data;
    view.cat = null;
    view.start = currentStart();
    state.lastSeen = currentStart();
    setupFormatters();
    applyTheme();
    save();
    render();
    renderSettings();
    setDataMsg(`Imported ${plural(n, 'purchase')}.`);
  } catch (err) {
    setDataMsg(err instanceof SyntaxError
      ? "Couldn't read that file. Choose a .json backup exported from Spendings Tracker."
      : `Couldn't import that file. ${err.message}`);
  }
}

function wipeAll() {
  if (!confirm("Delete your limit, streak, spending and settings in this browser? This can't be undone. Export a backup first if you might need it.")) return;
  state = freshState();
  view.cat = null;
  view.start = currentStart();
  displayedFigure = null;
  setupFormatters();
  applyTheme();
  save();
  render();
  renderSettings();
  setDataMsg('All data deleted.');
}

/* ------------------------------------------------------------ sample data */

const SAMPLE_SPEND = [
  ['groceries', 30, 1.8, ['Weekly shop', 'Farmers market', 'Corner store', 'Bulk buy']],
  ['eating-out', 24, 0.9, ['Coffee', 'Lunch', 'Takeout', 'Pizza night', 'Brunch with friends', 'Bakery']],
  ['transport', 14, 0.8, ['Bus fare', 'Fuel', 'Train ticket', 'Ride home', 'Parking']],
  ['shopping', 9, 1.6, ['Running shoes', 'Books', 'Kitchen things', 'New jeans']],
  ['entertainment', 9, 1.2, ['Cinema', 'Concert tickets', 'Board game', 'Bowling']],
  ['subscriptions', 5, 0.6, ['Streaming', 'Music', 'Cloud storage']],
  ['health', 4, 0.9, ['Pharmacy', 'Vitamins']],
  ['other', 5, 0.8, ['Haircut', 'Laundry']],
];

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Purchases spread over one period's days (up to today) that add up to `target`.
function samplePeriod(start, target, rand) {
  const last = [periodEnd(start), today()].sort()[0];
  const days = daysBetween(start, last) + 1;
  const count = Math.max(2, Math.round(days * (state.period === 'week' ? 1.4 : 1.1) * (0.8 + rand() * 0.4)));
  const totalWeight = SAMPLE_SPEND.reduce((sum, s) => sum + s[1], 0);
  const picks = Array.from({ length: count }, () => {
    let r = rand() * totalWeight;
    const spec = SAMPLE_SPEND.find(s => (r -= s[1]) < 0) ?? SAMPLE_SPEND[0];
    return { spec, weight: spec[2] * (0.4 + rand() * 1.2) };
  });
  const weights = picks.reduce((sum, p) => sum + p.weight, 0);
  let remaining = Math.round(target);
  return picks.map((p, i) => {
    const amount = i === picks.length - 1 ? remaining : Math.round((target * p.weight) / weights);
    remaining -= amount;
    const d = parseDate(start);
    d.setDate(d.getDate() + Math.floor(rand() * days));
    const [cat, , , notes] = p.spec;
    return { id: newId(), amount, cat, date: isoDate(d), note: notes[Math.floor(rand() * notes.length)], created: Date.now() + i, sample: true };
  }).filter(t => t.amount > 0);
}

function loadSample() {
  const rand = mulberry32(20260928);
  if (!state.limits.length) state.period = 'week';
  const weekly = state.period === 'week';
  const limit = currentLimit() ?? (weekly ? 30000 : 130000);
  // How much of the limit each finished period used, oldest first: one slip,
  // then a run of good periods, so the chart and the streak both have a story.
  const history = weekly ? [0.86, 0.91, 0.78, 1.14, 0.95, 0.83, 0.97, 0.72, 0.88] : [0.93, 1.09, 0.87, 0.96, 0.9];
  const now = currentStart();
  const first = shiftPeriod(now, -history.length);
  if (!state.limits.some(e => e.start <= first)) {
    state.limits.push({ start: first, amount: limit, period: state.period, sample: true });
    state.limits.sort((a, b) => a.start.localeCompare(b.start));
  }
  for (const c of DEFAULT_CATEGORIES) {
    if (!state.categories.some(x => x.id === c[0])) state.categories.push({ id: c[0], name: c[1] });
  }
  // A few dollars of noise so the totals don't come out as round numbers.
  const noisy = share => limit * share + Math.round((rand() - 0.5) * 800);
  history.forEach((share, k) => state.tx.push(...samplePeriod(shiftPeriod(first, k), noisy(share), rand)));
  const total = daysBetween(now, periodEnd(now)) + 1;
  const elapsed = daysBetween(now, today()) + 1;
  state.tx.push(...samplePeriod(now, limit * 0.82 * (elapsed / total), rand));
  state.lastSeen = now;
  view.start = now;
  save();
  render();
}

function clearSample() {
  state.tx = state.tx.filter(t => !t.sample);
  state.limits = state.limits.filter(e => !e.sample);
  view.cat = null;
  save();
  render();
  if (settingsDialog.open) {
    renderSettings();
    setDataMsg('Sample data cleared.');
  } else {
    toast('Sample data cleared');
  }
}

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;

function toast(message, actionLabel, action) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.replaceChildren(h('span', null, message));
  if (actionLabel) {
    el.append(h('button', { type: 'button', onclick: () => { hideToast(); action(); } }, actionLabel));
  }
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  toastTimer = setTimeout(hideToast, actionLabel ? 7000 : 4500);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

// When a new week or month has started since you last looked, say how the
// last one went: that's when the streak grows.
function greetNewPeriod() {
  const now = currentStart();
  const seen = state.lastSeen;
  state.lastSeen = now;
  save();
  if (!seen || seen >= now) return;
  const prev = shiftPeriod(now, -1);
  const limit = limitFor(prev);
  if (limit == null) return;
  const spent = spentIn(prev);
  const unit = state.period;
  const { current } = streakInfo(periodTotals());
  toast(spent <= limit
    ? `Last ${unit} you stayed ${money(limit - spent)} under. Streak: ${plural(current, unit)}.`
    : `Last ${unit} went ${money(spent - limit)} over. Fresh jar this ${unit}.`);
}

/* ---------------------------------------------------------- theme, install */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* blocked */ }
  const dark = state.theme === 'dark' || (state.theme === 'system' && darkQuery.matches);
  for (const meta of $$('meta[name="theme-color"]')) meta.content = dark ? '#0e1511' : '#f1f4ef';
}

let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function renderInstall() {
  const group = $('#installGroup');
  const hint = $('#installHint');
  const button = $('#installBtn');
  if (isStandalone()) {
    group.hidden = true;
  } else if (installPrompt) {
    group.hidden = false;
    button.hidden = false;
    hint.textContent = 'Install Spendings Tracker to open it like an app, even when you’re offline.';
  } else if (isIOS()) {
    group.hidden = false;
    button.hidden = true;
    hint.textContent = 'On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Safari can clear data for sites you haven’t visited in a week, but not for apps on your Home Screen.';
  } else {
    group.hidden = true;
  }
}

/* ------------------------------------------------------------------- init */

function init() {
  view.start = currentStart();
  setupFormatters();
  applyTheme();
  buildJar();
  buildSeal();
  render();

  // top bar
  $('#prevPeriod').addEventListener('click', () => goPeriod(shiftPeriod(view.start, -1)));
  $('#nextPeriod').addEventListener('click', () => goPeriod(shiftPeriod(view.start, 1)));
  $('#toCurrent').addEventListener('click', () => {
    goPeriod(currentStart());
    $('#prevPeriod').focus();
  });
  $('#openSettings').addEventListener('click', openSettings);
  for (const b of $$('[data-add]')) b.addEventListener('click', () => openTx());
  const topbar = $('#topbar');
  addEventListener('scroll', () => topbar.classList.toggle('is-scrolled', scrollY > 4), { passive: true });

  // first limit
  $('#setupForm').addEventListener('submit', submitSetup);
  $('#setupAmount').addEventListener('input', () => { $('#setupError').hidden = true; });
  $('#setupSample').addEventListener('click', loadSample);

  // list and chart
  $('#search').addEventListener('input', e => { view.query = e.target.value; renderList(); });
  $('#historyToggle').addEventListener('click', () => { view.table = !view.table; renderHistory(periodTotals()); });

  // add sheet
  txForm.addEventListener('submit', submitTx);
  txForm.addEventListener('change', e => {
    if (e.target.name === 'txCat') categoryTouched = true;
    if (e.target.id === 'txDate') updateJarHint();
  });
  $('#txAmount').addEventListener('input', () => { setAmountError(''); updateJarHint(); });
  // Typing a note you've used before picks the category you used with it.
  $('#txNote').addEventListener('input', () => {
    if (categoryTouched) return;
    const note = $('#txNote').value.trim().toLocaleLowerCase();
    if (!note) return;
    const match = [...state.tx].reverse().find(t => t.note.toLocaleLowerCase() === note);
    const radio = match && txForm.querySelector(`input[name="txCat"][value="${CSS.escape(match.cat)}"]`);
    if (radio) radio.checked = true;
  });
  $('#txDelete').addEventListener('click', deleteTx);
  txDialog.addEventListener('close', () => {
    const key = txReturnKey;
    txReturnKey = null;
    if (!key) return;
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      focusByKey(key, $('#txTitle'));
    });
  });

  // settings
  $('#setLimit').addEventListener('change', e => {
    const text = e.target.value.trim();
    const cents = parseAmount(text);
    if (cents > 0 && cents < 1e13) {
      setLimit(cents, state.period);
      if (!state.lastSeen) state.lastSeen = currentStart();
      save();
      render();
    }
    const limit = currentLimit();
    e.target.value = limit != null ? amountForInput(limit) : '';
  });
  for (const r of $$('input[name="setPeriod"]')) r.addEventListener('change', () => changePeriod(r.value));
  $('#setWeekStart').addEventListener('change', e => changeWeekStart(Number(e.target.value)));
  $('#setCurrency').addEventListener('change', e => {
    state.currency = e.target.value;
    setupFormatters();
    save();
    render();
  });
  for (const r of $$('input[name="theme"]')) {
    r.addEventListener('change', () => { state.theme = r.value; applyTheme(); save(); });
  }
  $('#catAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#catAddName');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (state.categories.some(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      $('#catAddMsg').textContent = `You already have a category called “${name}”.`;
      return;
    }
    addCategory(name);
    input.value = '';
    $('#catAddMsg').textContent = `Added “${name}”.`;
    renderCategoryEditors();
    render();
  });
  $('#exportJson').addEventListener('click', exportBackup);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importJson').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  $('#clearSample').addEventListener('click', clearSample);
  $('#wipeAll').addEventListener('click', wipeAll);
  $('#installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    renderInstall();
  });

  // all sheets: close buttons and tapping outside
  for (const dialog of $$('dialog')) {
    for (const b of $$('[data-close]', dialog)) b.addEventListener('click', () => dialog.close());
    let pressedOutside = false;
    const outside = e => {
      const r = dialog.getBoundingClientRect();
      return e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    };
    dialog.addEventListener('pointerdown', e => { pressedOutside = outside(e); });
    dialog.addEventListener('click', e => {
      if (pressedOutside && outside(e)) dialog.close();
      pressedOutside = false;
    });
  }

  // toast pauses while you're reading or reaching for it
  const toastEl = $('#toast');
  const resume = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 3000); };
  toastEl.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  toastEl.addEventListener('pointerleave', resume);
  toastEl.addEventListener('focusin', () => clearTimeout(toastTimer));
  toastEl.addEventListener('focusout', resume);

  // keyboard: N adds, / searches
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]') || !state.limits.length) return;
    const el = e.target;
    if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTx(); }
    else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });

  // redraw the chart when its width changes
  let chartWidth = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w && w !== chartWidth) {
      chartWidth = w;
      renderHistory(periodTotals());
    }
    fitFigure();
  }).observe($('#historyChart'));

  // once the typeface arrives, re-measure the figure and axis labels
  document.fonts?.ready.then(() => { fitFigure(); renderHistory(periodTotals()); });

  // another tab changed the data
  addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    view.start = periodStart(view.start);
    setupFormatters();
    applyTheme();
    render();
    if (settingsDialog.open) renderSettings();
  });

  darkQuery.addEventListener('change', applyTheme);

  // If the app stays open into a new week or month, move along with it.
  let shownCurrent = currentStart();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = currentStart();
    if (now !== shownCurrent) {
      if (view.start === shownCurrent) view.start = now;
      shownCurrent = now;
      if (state.limits.length) greetNewPeriod();
    }
    render();
  });

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    renderInstall();
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstall();
  });

  if (state.limits.length) greetNewPeriod();

  // home screen shortcut: ?add opens the add sheet
  const params = new URLSearchParams(location.search);
  if (params.has('add')) {
    history.replaceState(null, '', location.pathname);
    if (state.limits.length) openTx();
  }

  if (isStandalone()) navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else addEventListener('load', register);
  }
}

init();
