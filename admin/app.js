'use strict';

/* =============================================================================
   برو آند بايت — لوحة الفريق
   Vanilla JS SPA. Hash routing, session cookie auth, optimistic updates.
   ============================================================================= */

/* ------------------------------- helpers ----------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmtSYP = (n) => `${Number(n || 0).toLocaleString('en-US')} ل.س`;

function fmtClock(d) {
  return d.toLocaleTimeString('ar-SY-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = d.toLocaleTimeString('ar-SY-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `اليوم ${t}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `أمس ${t}`;
  return `${d.toLocaleDateString('ar-SY-u-nu-latn', { day: 'numeric', month: 'numeric' })} ${t}`;
}

/* icons (inline SVG, stroke = currentColor) */
const ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
};

/* --------------------------------- API ------------------------------------- */

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/* On the hosted backend everything is same-origin. When the panel runs on
   GitHub Pages it talks to the live backend cross-origin with a Bearer token
   (cookies cannot cross origins), mirroring the storefront's BB_BASE. */
const ADMIN_API_BASE = /(^|\.)github\.io$/.test(location.hostname)
  ? 'https://18npv6obi8-8820.hosted.obvious.ai'
  : '';

const ADMIN_TOKEN_KEY = 'bb_admin_token';

function getStoredToken() {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch { /* storage unavailable: panel still works same-origin via cookies */ }
}

function adminAsset(p) {
  const s = String(p || '');
  return ADMIN_API_BASE && s.startsWith('/') ? ADMIN_API_BASE + s : s;
}

async function api(path, opts = {}) {
  const { method = 'GET', body, formData } = opts;
  const init = { method, credentials: 'same-origin', headers: {} };
  const storedToken = getStoredToken();
  if (storedToken) init.headers['Authorization'] = `Bearer ${storedToken}`;
  if (formData) init.body = formData;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(ADMIN_API_BASE + path, init);
  } catch {
    const net = new ApiError('network', 0);
    net.kind = 'network';
    throw net;
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    // A stored token that stopped working (expired/rotated) ends the session.
    if (res.status === 401 && getStoredToken()) {
      setStoredToken('');
      if (state.user) { state.user = null; showLogin(); }
    }
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status, data && data.details);
  }
  return data;
}

/* known server messages → Arabic */
const AR_MESSAGES = {
  'Invalid username or password.': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  'Current password is incorrect.': 'كلمة المرور الحالية غير صحيحة.',
};

function apiMessage(err, fallback) {
  if (err && err.kind === 'network') return 'تعذر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.';
  if (err && err.status === 401) return 'انتهت الجلسة. الرجاء تسجيل الدخول من جديد.';
  if (err && AR_MESSAGES[err.message]) return AR_MESSAGES[err.message];
  return fallback || 'حدث خطأ غير متوقع. أعد المحاولة.';
}

/* ------------------------------ app state ---------------------------------- */

const state = {
  user: null,
  orders: {
    tab: 'active', active: [], history: [],
    known: new Set(), firstLoad: true, histStale: true,
    lastSync: null, pollTimer: null, loadSeq: 0,
  },
  categories: [],
  items: [],
};

/* ---------------------------- unsaved-changes guard ------------------------ */

const unsaved = new Set();
const markUnsaved = (k) => unsaved.add(k);
const clearUnsaved = (k) => unsaved.delete(k);
const anyUnsaved = () => unsaved.size > 0;

let suppressNavGuard = false;
let lastHash = '#/orders';

window.addEventListener('beforeunload', (e) => {
  if (anyUnsaved()) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('hashchange', async () => {
  if (suppressNavGuard) { suppressNavGuard = false; renderRoute(); return; }
  if (anyUnsaved()) {
    const ok = await confirmDialog({
      title: 'تغييرات غير محفوظة',
      text: 'لديك تعديلات لم يتم حفظها بعد. هل تريد المغادرة دون حفظ؟',
      confirmLabel: 'مغادرة دون حفظ', cancelLabel: 'متابعة التعديل', danger: true,
    });
    if (!ok) { suppressNavGuard = true; location.hash = lastHash; return; } // view DOM stays intact
    unsaved.clear();
  }
  lastHash = location.hash;
  renderRoute();
});

/* attach to a form: any input marks it unsaved until cleared */
function watchDirty(formEl, key) {
  formEl.addEventListener('input', () => markUnsaved(key));
  formEl.addEventListener('change', () => markUnsaved(key));
}

/* -------------------------------- toast ------------------------------------ */

function toast(msg, type = 'success') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

function toastErr(err, fallback) {
  console.error('[admin] API error:', err);
  toast(apiMessage(err, fallback), 'error');
}

/* ------------------------------- confirm ----------------------------------- */

function confirmDialog({ title, text, confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#confirm-root');
    root.innerHTML = `
      <div class="confirm-overlay">
        <div class="confirm-card" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
          <h3>${esc(title)}</h3>
          <p>${esc(text)}</p>
          <div class="confirm-actions">
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="yes">${esc(confirmLabel)}</button>
            <button type="button" class="btn btn-ghost" data-x="no">${esc(cancelLabel)}</button>
          </div>
        </div>
      </div>`;
    const done = (v) => { root.innerHTML = ''; resolve(v); };
    $('[data-x="yes"]', root).addEventListener('click', () => done(true));
    $('[data-x="no"]', root).addEventListener('click', () => done(false));
    $('.confirm-overlay', root).addEventListener('click', (e) => {
      if (e.target.classList.contains('confirm-overlay')) done(false);
    });
  });
}

/* -------------------------------- modal ------------------------------------ */

function openModal({ title, body, foot, onClose }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button type="button" class="modal-close" aria-label="إغلاق">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
      </div>
    </div>`;
  const overlay = $('.modal-overlay', root);
  const modalEl = $('.modal', root);
  let closing = false;
  const requestClose = async () => {
    if (closing) return;
    if (onClose && !(await onClose())) return;
    closing = true;
    root.innerHTML = '';
  };
  $('.modal-close', overlay).addEventListener('click', requestClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) requestClose(); });
  return { modalEl, requestClose };
}

/* ---------------------------- image upload field --------------------------- */

function wireImageField(box, initialUrl) {
  let val = initialUrl || '';
  box.innerHTML = `
    <div class="img-preview"></div>
    <div class="img-actions">
      <label class="btn btn-ghost btn-sm">اختيار صورة
        <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none">
      </label>
      <button type="button" class="btn btn-ghost btn-sm img-remove">إزالة الصورة</button>
    </div>`;
  const preview = $('.img-preview', box);
  const input = $('input[type="file"]', box);
  const paint = () => {
    preview.classList.remove('uploading');
    preview.innerHTML = val
      ? `<img src="${esc(adminAsset(val))}" alt="الصورة">`
      : `<div class="ph">${ICONS.image}<span>لا توجد صورة بعد</span></div>`;
  };
  paint();
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      toast('صيغة الملف غير مدعومة. المسموح: JPG أو PNG أو WEBP.', 'error');
      input.value = ''; return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast('حجم الصورة كبير جداً. الحد الأقصى 5 ميغابايت.', 'error');
      input.value = ''; return;
    }
    preview.classList.add('uploading');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api('/api/upload', { method: 'POST', formData: fd });
      val = r.url;
      paint();
      toast('تم رفع الصورة بنجاح');
      box.dispatchEvent(new Event('imgchange'));
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      toastErr(err, 'تعذر رفع الصورة. حاول مرة أخرى.');
    } finally { input.value = ''; }
  });
  $('.img-remove', box).addEventListener('click', () => {
    val = ''; paint(); box.dispatchEvent(new Event('imgchange'));
  });
  return { get: () => val };
}

/* ------------------------------- audio beep -------------------------------- */

let audioCtx = null;
function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume().catch((e) => console.warn('[admin] audio resume failed', e)); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { console.warn('[admin] audio unavailable:', e); }
}
function beep() {
  console.debug('[admin] beep: new order detected');
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch((e) => console.warn('[admin] audio resume failed', e));
  const t0 = audioCtx.currentTime;
  [[880, 0], [1175, 0.18]].forEach(([freq, dt]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + dt); osc.stop(t0 + dt + 0.2);
  });
}

/* ------------------------------- router ------------------------------------ */

const ROUTES = { orders: viewOrders, menu: viewMenu, categories: viewCategories, home: viewHome, settings: viewSettings };
const ROUTE_TITLES = { orders: 'الطلبات', menu: 'المينيو', categories: 'الأقسام', home: 'الرئيسية', settings: 'الإعدادات' };
let renderedRoute = null;

function currentRouteName() {
  const name = location.hash.replace(/^#\/?/, '');
  return ROUTES[name] ? name : 'orders';
}

function renderRoute(force) {
  if (!state.user) { showLogin(); return; }
  const name = currentRouteName();
  if (!force && name === renderedRoute) return; // keep DOM (preserves unsaved forms)
  stopPolling();
  renderedRoute = name;
  $$('#main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.title = `${ROUTE_TITLES[name]} — برو آند بايت`;
  ROUTES[name]();
}

function enterApp(afterLogin) {
  $('#login-view').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (afterLogin || !location.hash) location.hash = '#/orders';
  lastHash = location.hash || '#/orders';
  renderedRoute = null;
  renderRoute(true);
}

function showLogin(message) {
  stopPolling();
  $('#app').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  renderedRoute = null;
  const errBox = $('#login-error');
  if (message) { errBox.textContent = message; errBox.classList.remove('hidden'); }
  else errBox.classList.add('hidden');
}

function sessionExpired() {
  state.user = null;
  unsaved.clear();
  showLogin('انتهت الجلسة. الرجاء تسجيل الدخول من جديد.');
}

function stopPolling() {
  if (state.orders.pollTimer) { clearInterval(state.orders.pollTimer); state.orders.pollTimer = null; }
}

function viewError(err, retryFn) {
  const v = $('#view');
  v.innerHTML = `
    <div class="error-banner">
      <span>${esc(apiMessage(err, 'حدث خطأ غير متوقع.'))}</span>
      <button type="button" id="retry-btn">إعادة المحاولة</button>
    </div>`;
  $('#retry-btn').addEventListener('click', retryFn);
}

const spinnerHtml = `<div class="spinner-wrap"><div class="spinner"></div><span>جارٍ التحميل…</span></div>`;

/* =============================== الطلبات ==================================== */

function viewOrders() {
  const v = $('#view');
  v.innerHTML = `
    <div class="orders-toolbar">
      <div class="orders-tabs">
        <button type="button" id="tab-active">النشطة <span class="count" id="count-active">0</span></button>
        <button type="button" id="tab-done">المنجزة <span class="count" id="count-done">0</span></button>
      </div>
      <div class="sync-info">
        <button type="button" class="btn-icon" id="orders-refresh" title="تحديث الآن" aria-label="تحديث الآن">${ICONS.refresh}</button>
        <span id="sync-text">جارٍ التحديث…</span>
      </div>
    </div>
    <div id="orders-body">${spinnerHtml}</div>`;

  $('#tab-active').addEventListener('click', () => {
    if (state.orders.tab === 'active') return;
    state.orders.tab = 'active'; paintOrders();
  });
  $('#tab-done').addEventListener('click', () => {
    if (state.orders.tab !== 'done') state.orders.tab = 'done';
    paintOrders();
    if (state.orders.histStale) refreshOrders();
  });
  $('#orders-refresh').addEventListener('click', () => refreshOrders());

  $('#orders-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'preparing' || btn.dataset.act === 'done') setOrderStatus(id, btn.dataset.act);
  });

  refreshOrders(true);
  stopPolling();
  state.orders.pollTimer = setInterval(() => refreshOrders(), 15000);
}

async function refreshOrders(initial = false) {
  const seq = ++state.orders.loadSeq;
  const refreshBtn = $('#orders-refresh');
  if (refreshBtn) refreshBtn.classList.add('spin');
  const wantHistory = state.orders.tab === 'done' || state.orders.histStale || initial;
  try {
    const activeP = api('/api/orders?status=new,preparing');
    const histP = wantHistory ? api('/api/orders/history') : null;

    const active = (await activeP).orders || [];
    if (seq !== state.orders.loadSeq) return;

    // new-order detection → beep + toast (skip on very first load with backlog: beep once)
    const freshNew = active.filter((o) => o.status === 'new' && !state.orders.known.has(o.id));
    if (state.orders.firstLoad) { if (active.some((o) => o.status === 'new')) beep(); }
    else if (freshNew.length) { beep(); toast('وصل طلب جديد!', 'info'); }
    active.forEach((o) => state.orders.known.add(o.id));
    state.orders.firstLoad = false;
    state.orders.active = active;

    if (histP) {
      const h = await histP;
      if (seq !== state.orders.loadSeq) return;
      state.orders.history = h.orders || [];
      state.orders.histStale = false;
    }

    paintOrders();
    state.orders.lastSync = new Date();
    const syncText = $('#sync-text');
    if (syncText) { syncText.textContent = `آخر تحديث: ${fmtClock(state.orders.lastSync)}`; syncText.style.color = ''; }
  } catch (err) {
    if (seq !== state.orders.loadSeq) return;
    if (err.status === 401) return sessionExpired();
    console.error('[admin] orders refresh failed:', err);
    const syncText = $('#sync-text');
    if (syncText) { syncText.textContent = 'فشل التحديث — سنعيد المحاولة تلقائياً'; syncText.style.color = 'var(--red)'; }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spin');
  }
}

function paintOrders() {
  const body = $('#orders-body');
  if (!body) return;
  const { tab, active, history } = state.orders;
  const live = active.filter((o) => o.status !== 'done');
  const shown = tab === 'active' ? live : history;

  $('#tab-active').classList.toggle('active', tab === 'active');
  $('#tab-done').classList.toggle('active', tab === 'done');
  $('#count-active').textContent = live.length;
  $('#count-done').textContent = history.length;

  const n = live.length;
  document.title = `${n ? `(${n}) ` : ''}الطلبات — برو آند بايت`;

  if (!shown.length) {
    body.innerHTML = tab === 'active'
      ? `<div class="empty-state"><div class="big">🧾</div><p>لا توجد طلبات نشطة حالياً.<br>ستظهر الطلبات الجديدة هنا تلقائياً مع صوت تنبيه.</p></div>`
      : `<div class="empty-state"><div class="big">✅</div><p>لا توجد طلبات منجزة بعد.</p></div>`;
    return;
  }
  body.innerHTML = shown.map(orderCard).join('');
}

function orderCard(o) {
  const isNew = o.status === 'new';
  const isDone = o.status === 'done';
  const phoneDigits = String(o.customer_phone || '').replace(/[^+\d]/g, '');
  const badge = isDone
    ? '<span class="badge badge-done">منجز</span>'
    : isNew ? '<span class="badge badge-new">جديد</span>' : '<span class="badge badge-prep">قيد التحضير</span>';
  const when = fmtWhen(isDone ? (o.updated_at || o.created_at) : o.created_at);
  return `
    <article class="order-card ${isNew ? 'is-new' : ''} ${o.status === 'preparing' ? 'is-prep' : ''} ${isDone ? 'is-done' : ''}">
      <div class="oc-head">
        <span class="oc-num">طلب رقم #${o.id}</span>
        ${badge}
        <span class="oc-time">${ICONS.clock}<span>${esc(when)}</span></span>
      </div>
      <div class="oc-customer">${esc(o.customer_name)}</div>
      <a class="oc-phone" href="tel:${esc(phoneDigits)}" dir="ltr">${ICONS.phone}<span>${esc(o.customer_phone)}</span><em>اتصال</em></a>
      ${o.address ? `<div class="oc-line">${ICONS.pin}<span>${esc(o.address)}</span></div>` : ''}
      ${o.note ? `<div class="oc-note">${ICONS.note}<span>${esc(o.note)}</span></div>` : ''}
      <ul class="oc-items">
        ${(o.items || []).map((it) => `
          <li>
            <span class="qty">${it.qty}×</span>
            <span>${esc(it.name_ar || `منتج #${it.item_id}`)}</span>
            <span class="line-total">${fmtSYP((it.unit_price_syp || 0) * it.qty)}</span>
          </li>`).join('')}
      </ul>
      <div class="oc-total"><span>المجموع</span><strong>${fmtSYP(o.total_syp)}</strong></div>
      ${!isDone ? `
        <div class="oc-actions">
          ${isNew ? `<button type="button" class="btn btn-primary" data-act="preparing" data-id="${o.id}">بدأ التحضير</button>` : ''}
          ${o.status === 'preparing' ? `<button type="button" class="btn btn-success" data-act="done" data-id="${o.id}">تم</button>` : ''}
        </div>` : ''}
    </article>`;
}

async function setOrderStatus(id, status) {
  const o = state.orders.active.find((x) => x.id === id);
  if (!o || o.status === status) return;
  const prev = o.status;
  o.status = status; // optimistic — the card moves/changes instantly
  paintOrders();
  try {
    await api(`/api/orders/${id}/status`, { method: 'PATCH', body: { status } });
    if (status === 'done') {
      state.orders.known.delete(id);
      state.orders.histStale = true;
      toast(`تم إنجاز الطلب رقم ${id}`);
      if (state.orders.tab === 'done') refreshOrders();
    } else {
      toast(`الطلب رقم ${id} قيد التحضير الآن`);
    }
  } catch (err) {
    o.status = prev; // revert
    paintOrders();
    if (err.status === 401) return sessionExpired();
    toastErr(err, 'تعذر تحديث الطلب. حاول مرة أخرى.');
  }
}

/* =============================== المينيو ==================================== */

function itemsOf(catId) {
  return state.items
    .filter((it) => it.category_id === catId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

async function viewMenu() {
  const v = $('#view');
  v.innerHTML = spinnerHtml;
  try {
    const [c, i] = await Promise.all([api('/api/categories'), api('/api/items')]);
    state.categories = (c.categories || []).slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    state.items = i.items || [];
    paintMenu();
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    viewError(err, viewMenu);
  }
}

function paintMenu() {
  const v = $('#view');
  if (!state.categories.length) {
    v.innerHTML = `
      <div class="page-head"><h2>المينيو</h2></div>
      <div class="empty-state">
        <div class="big">🍽️</div>
        <p>لا توجد أقسام بعد.<br>أضف قسماً أولاً ثم أضف المنتجات إليه.</p>
        <a class="btn btn-primary" href="#/categories">إدارة الأقسام</a>
      </div>`;
    return;
  }
  v.innerHTML = `
    <div class="page-head">
      <h2>المينيو</h2>
      <span class="page-sub">عدد المنتجات: ${state.items.length}</span>
    </div>
    ${state.categories.map((cat) => {
      const items = itemsOf(cat.id);
      return `
      <section class="menu-cat">
        <div class="menu-cat-head">
          <h3>${esc(cat.name_ar || cat.name_en)}</h3>
          <span class="badge-mini">${items.length} منتج</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="add-item" data-cat="${cat.id}">+ إضافة منتج</button>
        </div>
        ${items.length
          ? items.map((it, idx) => itemRowHtml(it, idx, items.length)).join('')
          : `<div class="empty-state"><p>لا توجد منتجات في هذا القسم بعد.</p>
             <button type="button" class="btn btn-ghost btn-sm" data-act="add-item" data-cat="${cat.id}">+ إضافة أول منتج</button></div>`}
      </section>`;
    }).join('')}`;
}

function itemRowHtml(it, idx, len) {
  const badges = [
    it.is_hidden ? '<span class="badge-mini warn">مخفي</span>' : '',
    !it.is_available ? '<span class="badge-mini warn">غير متوفر</span>' : '',
    it.is_offer ? '<span class="badge-mini hot">عرض اليوم</span>' : '',
    it.is_popular ? '<span class="badge-mini hot">الأكثر طلباً</span>' : '',
  ].join('');
  return `
    <div class="item-row">
      <div class="item-thumb">${it.image ? `<img src="${esc(adminAsset(it.image))}" alt="">` : ICONS.image}</div>
      <div class="item-info">
        <div class="item-name">${esc(it.name_ar || it.name_en)} ${badges}</div>
        ${it.name_en ? `<div class="item-name-en">${esc(it.name_en)}</div>` : ''}
        <div class="item-price">${fmtSYP(it.price_syp)}</div>
      </div>
      <div class="item-actions">
        <div class="row">
          <button type="button" class="btn-icon" data-act="move-item" data-id="${it.id}" data-dir="up" title="نقل لأعلى" ${idx === 0 ? 'disabled' : ''}>${ICONS.up}</button>
          <button type="button" class="btn-icon" data-act="move-item" data-id="${it.id}" data-dir="down" title="نقل لأسفل" ${idx === len - 1 ? 'disabled' : ''}>${ICONS.down}</button>
        </div>
        <div class="row">
          <button type="button" class="btn-icon" data-act="edit-item" data-id="${it.id}" title="تعديل" aria-label="تعديل">${ICONS.edit}</button>
          <button type="button" class="btn-icon danger" data-act="del-item" data-id="${it.id}" title="حذف" aria-label="حذف">${ICONS.trash}</button>
        </div>
      </div>
    </div>`;
}

function openItemModal(itemId, presetCatId) {
  const isNew = !itemId;
  const item = isNew
    ? {
      id: null, category_id: presetCatId || (state.categories[0] && state.categories[0].id),
      name_ar: '', name_en: '', desc_ar: '', desc_en: '', price_syp: '', image: '',
      is_offer: false, is_popular: false, is_available: true, is_hidden: false,
    }
    : state.items.find((i) => i.id === itemId);
  if (!item) return;

  const catOptions = state.categories
    .map((c) => `<option value="${c.id}" ${c.id === item.category_id ? 'selected' : ''}>${esc(c.name_ar || c.name_en)}</option>`)
    .join('');

  const switchHtml = (id, label, checked) => `
    <label class="switch"><span>${esc(label)}</span>
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="track"></span>
    </label>`;

  const body = `
    <form id="item-form" novalidate>
      <label class="field"><span class="field-label">الاسم بالعربية</span>
        <input type="text" id="f-name-ar" value="${esc(item.name_ar)}" maxlength="200"></label>
      <label class="field"><span class="field-label">الاسم بالإنكليزية</span>
        <input type="text" id="f-name-en" dir="ltr" value="${esc(item.name_en)}" maxlength="200"></label>
      <label class="field"><span class="field-label">السعر (ل.س)</span>
        <input type="number" id="f-price" min="0" step="1" inputmode="numeric" value="${esc(item.price_syp)}"></label>
      <label class="field"><span class="field-label">القسم</span>
        <select id="f-cat">${catOptions}</select></label>
      <label class="field"><span class="field-label">الوصف بالعربية</span>
        <textarea id="f-desc-ar" maxlength="1000">${esc(item.desc_ar)}</textarea></label>
      <label class="field"><span class="field-label">الوصف بالإنكليزية</span>
        <textarea id="f-desc-en" dir="ltr" maxlength="1000">${esc(item.desc_en)}</textarea></label>
      <div class="field"><span class="field-label">صورة المنتج</span>
        <div class="img-box" id="f-img"></div></div>
      <div class="field"><span class="field-label">خيارات العرض</span>
        <div class="switch-grid">
          ${switchHtml('f-offer', 'عرض اليوم', item.is_offer)}
          ${switchHtml('f-popular', 'الأكثر طلباً', item.is_popular)}
          ${switchHtml('f-avail', 'متوفر', item.is_available)}
          ${switchHtml('f-hidden', 'مخفي', item.is_hidden)}
        </div></div>
      <p class="form-error hidden" id="f-error"></p>
    </form>`;

  const foot = `
    ${!isNew ? `<button type="button" class="btn btn-danger" id="f-delete">حذف المنتج</button>` : ''}
    <button type="button" class="btn btn-ghost" id="f-cancel">إلغاء</button>
    <button type="button" class="btn btn-primary" id="f-save">حفظ</button>`;

  let dirty = false;
  const modal = openModal({
    title: isNew ? 'منتج جديد' : `تعديل: ${item.name_ar || item.name_en}`,
    body, foot,
    onClose: async () => {
      if (!dirty) return true;
      return confirmDialog({
        title: 'تغييرات غير محفوظة',
        text: 'هناك تعديلات على المنتج لم تُحفظ بعد. هل تريد الإغلاق دون حفظ؟',
        confirmLabel: 'إغلاق دون حفظ', cancelLabel: 'متابعة التعديل', danger: true,
      });
    },
  });

  const img = wireImageField($('#f-img', modal.modalEl), item.image);
  const form = $('#item-form', modal.modalEl);
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  $('#f-img', modal.modalEl).addEventListener('imgchange', () => { dirty = true; });

  $('#f-cancel', modal.modalEl).addEventListener('click', () => modal.requestClose());
  $('#f-save', modal.modalEl).addEventListener('click', () => saveItem(modal, item, img, () => { dirty = false; }));
  const delBtn = $('#f-delete', modal.modalEl);
  if (delBtn) delBtn.addEventListener('click', () => deleteItem(item, modal, () => { dirty = false; }));
}

async function saveItem(modal, original, img, onClean) {
  const errBox = $('#f-error');
  const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
  errBox.classList.add('hidden');

  const nameAr = $('#f-name-ar').value.trim();
  const nameEn = $('#f-name-en').value.trim();
  const priceRaw = $('#f-price').value.trim();
  const catId = Number($('#f-cat').value);
  const price = Number(priceRaw);

  if (!nameAr && !nameEn) return showErr('أدخل اسم المنتج بالعربية أو بالإنكليزية على الأقل.');
  if (priceRaw === '' || !Number.isInteger(price) || price < 0) return showErr('أدخل سعراً صحيحاً بالليرة السورية (رقم بدون كسور).');
  if (!catId) return showErr('اختر القسم.');

  const isNew = !original.id;
  const payload = {
    category_id: catId,
    name_ar: nameAr, name_en: nameEn,
    desc_ar: $('#f-desc-ar').value.trim(),
    desc_en: $('#f-desc-en').value.trim(),
    price_syp: price,
    image: img.get(),
    is_offer: $('#f-offer').checked,
    is_popular: $('#f-popular').checked,
    is_available: $('#f-avail').checked,
    is_hidden: $('#f-hidden').checked,
  };
  if (isNew) {
    const siblings = state.items.filter((i) => i.category_id === catId);
    payload.sort_order = siblings.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;
  }

  const saveBtn = $('#f-save');
  saveBtn.disabled = true; saveBtn.textContent = 'جارٍ الحفظ…';
  try {
    const r = isNew
      ? await api('/api/items', { method: 'POST', body: payload })
      : await api(`/api/items/${original.id}`, { method: 'PUT', body: payload });
    const saved = r.item;
    if (isNew) state.items.push(saved);
    else Object.assign(original, saved);
    onClean();
    toast(isNew ? 'تم إضافة المنتج بنجاح' : 'تم حفظ المنتج بنجاح');
    await modal.requestClose();
    paintMenu();
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    showErr(apiMessage(err, 'تعذر حفظ المنتج. حاول مرة أخرى.'));
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'حفظ';
  }
}

async function deleteItem(item, modal, onClean) {
  const ok = await confirmDialog({
    title: 'حذف المنتج',
    text: `سيتم حذف «${item.name_ar || item.name_en}» نهائياً من المينيو.`,
    confirmLabel: 'حذف', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/items/${item.id}`, { method: 'DELETE' });
    state.items = state.items.filter((i) => i.id !== item.id);
    onClean();
    toast('تم حذف المنتج');
    await modal.requestClose();
    paintMenu();
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    toastErr(err, 'تعذر حذف المنتج. حاول مرة أخرى.');
  }
}

async function moveItem(itemId, dir) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  const list = itemsOf(item.category_id);
  const idx = list.findIndex((i) => i.id === itemId);
  const to = idx + (dir === 'up' ? -1 : 1);
  if (to < 0 || to >= list.length) return;
  const swapped = list.slice();
  [swapped[idx], swapped[to]] = [swapped[to], swapped[idx]];
  swapped.forEach((it, i) => { it.sort_order = i + 1; }); // optimistic local order
  paintMenu();
  try {
    await api('/api/items/reorder', {
      method: 'POST',
      body: { category_id: item.category_id, order: swapped.map((i) => i.id) },
    });
    toast('تم تغيير ترتيب المنتجات');
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    toastErr(err, 'تعذر حفظ الترتيب. سنعيد التحميل.');
    viewMenu(); // refetch truth
  }
}

/* =============================== الأقسام ==================================== */

async function viewCategories() {
  const v = $('#view');
  v.innerHTML = spinnerHtml;
  try {
    const c = await api('/api/categories');
    state.categories = (c.categories || []).slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    paintCategories();
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    viewError(err, viewCategories);
  }
}

function paintCategories() {
  const v = $('#view');
  v.innerHTML = `
    <div class="page-head">
      <div><h2>الأقسام</h2><p class="page-sub">تظهر الأقسام في صفحة الزباء بنفس هذا الترتيب</p></div>
      <button type="button" class="btn btn-primary" data-act="add-cat">+ إضافة قسم</button>
    </div>
    ${state.categories.length ? state.categories.map((c, idx) => `
      <div class="item-row">
        <div class="item-thumb">${c.card_image ? `<img src="${esc(adminAsset(c.card_image))}" alt="">` : ICONS.image}</div>
        <div class="item-info">
          <div class="item-name">${esc(c.name_ar || c.name_en)}</div>
          ${c.name_en ? `<div class="item-name-en">${esc(c.name_en)}</div>` : ''}
          <div class="item-badges"><span class="badge-mini">${c.item_count ?? 0} منتج</span></div>
        </div>
        <div class="item-actions">
          <div class="row">
            <button type="button" class="btn-icon" data-act="move-cat" data-id="${c.id}" data-dir="up" title="نقل لأعلى" ${idx === 0 ? 'disabled' : ''}>${ICONS.up}</button>
            <button type="button" class="btn-icon" data-act="move-cat" data-id="${c.id}" data-dir="down" title="نقل لأسفل" ${idx === state.categories.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>
          </div>
          <div class="row">
            <button type="button" class="btn-icon" data-act="edit-cat" data-id="${c.id}" title="تعديل" aria-label="تعديل">${ICONS.edit}</button>
            <button type="button" class="btn-icon danger" data-act="del-cat" data-id="${c.id}" title="حذف" aria-label="حذف">${ICONS.trash}</button>
          </div>
        </div>
      </div>`).join('')
      : `<div class="empty-state"><div class="big">🗂️</div><p>لا توجد أقسام بعد.</p></div>`}`;
}

function openCategoryModal(catId) {
  const isNew = !catId;
  const cat = isNew
    ? { id: null, name_ar: '', name_en: '', card_image: '' }
    : state.categories.find((c) => c.id === catId);
  if (!cat) return;

  const body = `
    <form id="cat-form" novalidate>
      <label class="field"><span class="field-label">اسم القسم بالعربية</span>
        <input type="text" id="c-name-ar" value="${esc(cat.name_ar)}" maxlength="120"></label>
      <label class="field"><span class="field-label">اسم القسم بالإنكليزية</span>
        <input type="text" id="c-name-en" dir="ltr" value="${esc(cat.name_en)}" maxlength="120"></label>
      <div class="field"><span class="field-label">صورة القسم (تظهر للزبون في الصفحة الرئيسية)</span>
        <div class="img-box" id="c-img"></div></div>
      <p class="form-error hidden" id="c-error"></p>
    </form>`;

  const foot = `
    <button type="button" class="btn btn-ghost" id="c-cancel">إلغاء</button>
    <button type="button" class="btn btn-primary" id="c-save">حفظ</button>`;

  let dirty = false;
  const modal = openModal({
    title: isNew ? 'قسم جديد' : `تعديل القسم: ${cat.name_ar || cat.name_en}`,
    body, foot,
    onClose: async () => {
      if (!dirty) return true;
      return confirmDialog({
        title: 'تغييرات غير محفوظة',
        text: 'هناك تعديلات على القسم لم تُحفظ بعد. هل تريد الإغلاق دون حفظ؟',
        confirmLabel: 'إغلاق دون حفظ', cancelLabel: 'متابعة التعديل', danger: true,
      });
    },
  });

  const img = wireImageField($('#c-img', modal.modalEl), cat.card_image);
  const form = $('#cat-form', modal.modalEl);
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  $('#c-img', modal.modalEl).addEventListener('imgchange', () => { dirty = true; });

  $('#c-cancel', modal.modalEl).addEventListener('click', () => modal.requestClose());
  $('#c-save', modal.modalEl).addEventListener('click', async () => {
    const errBox = $('#c-error');
    const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    errBox.classList.add('hidden');
    const nameAr = $('#c-name-ar').value.trim();
    const nameEn = $('#c-name-en').value.trim();
    if (!nameAr && !nameEn) return showErr('أدخل اسم القسم بالعربية أو بالإنكليزية على الأقل.');
    const payload = { name_ar: nameAr, name_en: nameEn, card_image: img.get() };
    const saveBtn = $('#c-save');
    saveBtn.disabled = true; saveBtn.textContent = 'جارٍ الحفظ…';
    try {
      const r = isNew
        ? await api('/api/categories', { method: 'POST', body: payload })
        : await api(`/api/categories/${cat.id}`, { method: 'PUT', body: payload });
      if (isNew) state.categories.push(r.category);
      else Object.assign(cat, r.category);
      state.categories.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      dirty = false;
      toast(isNew ? 'تم إضافة القسم بنجاح' : 'تم حفظ القسم بنجاح');
      await modal.requestClose();
      paintCategories();
      if (renderedRoute === 'categories') { /* view already repainted */ }
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      showErr(apiMessage(err, 'تعذر حفظ القسم. حاول مرة أخرى.'));
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'حفظ';
    }
  });
}

async function deleteCategory(cat) {
  const ok = await confirmDialog({
    title: 'حذف القسم',
    text: `سيتم حذف القسم «${cat.name_ar || cat.name_en}» نهائياً.`,
    confirmLabel: 'حذف', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
    state.categories = state.categories.filter((c) => c.id !== cat.id);
    toast('تم حذف القسم');
    paintCategories();
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    if (err.status === 409) {
      const cascade = await confirmDialog({
        title: 'القسم يحتوي على منتجات',
        text: 'لا يمكن حذف قسم فيه منتجات. هل تريد حذف القسم مع كل منتجاته؟ لا يمكن التراجع عن ذلك.',
        confirmLabel: 'حذف القسم ومنتجاته', danger: true,
      });
      if (!cascade) return;
      try {
        await api(`/api/categories/${cat.id}?cascade=true`, { method: 'DELETE' });
        state.categories = state.categories.filter((c) => c.id !== cat.id);
        state.items = state.items.filter((i) => i.category_id !== cat.id);
        toast('تم حذف القسم ومنتجاته');
        paintCategories();
      } catch (e2) {
        if (e2.status === 401) return sessionExpired();
        toastErr(e2, 'تعذر حذف القسم. حاول مرة أخرى.');
      }
      return;
    }
    toastErr(err, 'تعذر حذف القسم. حاول مرة أخرى.');
  }
}

async function moveCategory(catId, dir) {
  const idx = state.categories.findIndex((c) => c.id === catId);
  const to = idx + (dir === 'up' ? -1 : 1);
  if (idx < 0 || to < 0 || to >= state.categories.length) return;
  const list = state.categories.slice();
  [list[idx], list[to]] = [list[to], list[idx]];
  list.forEach((c, i) => { c.sort_order = i; }); // optimistic
  paintCategories();
  try {
    await api('/api/categories/reorder', { method: 'POST', body: { order: list.map((c) => c.id) } });
    toast('تم تغيير ترتيب الأقسام');
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    toastErr(err, 'تعذر حفظ الترتيب. سنعيد التحميل.');
    viewCategories();
  }
}

/* =============================== الرئيسية =================================== */

async function viewHome() {
  const v = $('#view');
  v.innerHTML = spinnerHtml;
  let settings;
  try {
    settings = (await api('/api/settings')).settings;
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    return viewError(err, viewHome);
  }

  const F = (key, label, isEn) => `
    <label class="field"><span class="field-label">${esc(label)}</span>
      <input type="text" data-h="${key}" dir="${isEn ? 'ltr' : 'rtl'}" value="${esc(settings[key] || '')}"></label>`;

  v.innerHTML = `
    <div class="page-head"><div><h2>الرئيسية</h2>
      <p class="page-sub">محتوى الصفحة الأولى التي يراها الزبون في التطبيق</p></div></div>
    <form id="home-form" novalidate>
      <div class="card form-card">
        <h3>الصورة الرئيسية</h3>
        <div class="img-box" id="f-hero-img"></div>
      </div>
      <div class="card form-card">
        <h3>العنوان والوصف</h3>
        ${F('hero_title_ar', 'العنوان بالعربية', false)}
        ${F('hero_title_en', 'العنوان بالإنكليزية', true)}
        <label class="field"><span class="field-label">الوصف بالعربية</span>
          <textarea data-h="hero_subtitle_ar">${esc(settings.hero_subtitle_ar || '')}</textarea></label>
        <label class="field"><span class="field-label">الوصف بالإنكليزية</span>
          <textarea data-h="hero_subtitle_en" dir="ltr">${esc(settings.hero_subtitle_en || '')}</textarea></label>
      </div>
      <div class="card form-card">
        <h3>الخصائص والأزرار</h3>
        ${F('hero_chips_ar', 'الخصائص بالعربية (افصل بينها بفاصلة ,)', false)}
        ${F('hero_chips_en', 'الخصائص بالإنكليزية (افصل بينها بفاصلة ,)', true)}
        ${F('hero_cta_ar', 'نص زر الطلب بالعربية', false)}
        ${F('hero_cta_en', 'نص زر الطلب بالإنكليزية', true)}
        <p class="form-error hidden" id="h-error"></p>
      </div>
      <button type="submit" class="btn btn-primary btn-block">حفظ التغييرات</button>
    </form>`;

  const img = wireImageField($('#f-hero-img'), settings.hero_image);
  const form = $('#home-form');
  watchDirty(form, 'home');
  $('#f-hero-img').addEventListener('imgchange', () => markUnsaved('home'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#h-error');
    errBox.classList.add('hidden');
    const payload = { hero_image: img.get() };
    $$('[data-h]', form).forEach((inp) => { payload[inp.dataset.h] = inp.value.trim(); });
    const btn = $('button[type="submit"]', form);
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    try {
      const r = await api('/api/settings', { method: 'PUT', body: payload });
      Object.assign(settings, r.settings);
      clearUnsaved('home');
      toast('تم حفظ صفحة الرئيسية بنجاح');
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      console.error('[admin] home save failed:', err);
      errBox.textContent = apiMessage(err, 'تعذر حفظ الصفحة. حاول مرة أخرى.');
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'حفظ التغييرات';
    }
  });
}

/* =============================== الإعدادات ================================== */

async function viewSettings() {
  const v = $('#view');
  v.innerHTML = spinnerHtml;
  let settings;
  try {
    settings = (await api('/api/settings')).settings;
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    return viewError(err, viewSettings);
  }

  v.innerHTML = `
    <div class="page-head"><div><h2>الإعدادات</h2>
      <p class="page-sub">إعدادات المطعم العامة</p></div></div>

    <form id="conf-form" novalidate>
      <div class="card form-card">
        <h3>إعدادات المطعم</h3>
        <label class="field"><span class="field-label">سعر الصرف (كم ل.س بالدولار الواحد؟)</span>
          <input type="number" id="s-rate" min="1" step="1" inputmode="numeric" value="${esc(settings.exchange_rate_syp_per_usd || '')}">
          <span class="field-help">يُستخدم لإظهار الأسعار بالدولار للزبون</span></label>
        <label class="field"><span class="field-label">رقم هاتف المطعم</span>
          <input type="tel" id="s-phone" dir="ltr" value="${esc(settings.phone || '')}"></label>
        <label class="field"><span class="field-label">ساعات العمل بالعربية</span>
          <input type="text" id="s-hours-ar" value="${esc(settings.opening_hours_ar || '')}" placeholder="مثال: من 9 صباحاً حتى 12 منتصف الليل"></label>
        <label class="field"><span class="field-label">ساعات العمل بالإنكليزية</span>
          <input type="text" id="s-hours-en" dir="ltr" value="${esc(settings.opening_hours_en || '')}"></label>
        <p class="form-error hidden" id="s-error"></p>
        <button type="submit" class="btn btn-primary btn-block">حفظ الإعدادات</button>
      </div>
    </form>

    <form id="pw-form" novalidate>
      <div class="card form-card">
        <h3>تغيير كلمة المرور</h3>
        <label class="field"><span class="field-label">كلمة المرور الحالية</span>
          <input type="password" id="p-current" autocomplete="current-password"></label>
        <label class="field"><span class="field-label">كلمة المرور الجديدة (8 أحرف على الأقل)</span>
          <input type="password" id="p-new" autocomplete="new-password"></label>
        <label class="field"><span class="field-label">تأكيد كلمة المرور الجديدة</span>
          <input type="password" id="p-confirm" autocomplete="new-password"></label>
        <p class="form-error hidden" id="p-error"></p>
        <button type="submit" class="btn btn-primary btn-block">تغيير كلمة المرور</button>
      </div>
    </form>`;

  const confForm = $('#conf-form');
  watchDirty(confForm, 'settings');
  confForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#s-error');
    errBox.classList.add('hidden');
    const rate = $('#s-rate').value.trim();
    if (rate === '' || Number(rate) <= 0) {
      errBox.textContent = 'أدخل سعر صرف صحيحاً (رقم أكبر من صفر).';
      errBox.classList.remove('hidden'); return;
    }
    const payload = {
      exchange_rate_syp_per_usd: String(Math.round(Number(rate))),
      phone: $('#s-phone').value.trim(),
      opening_hours_ar: $('#s-hours-ar').value.trim(),
      opening_hours_en: $('#s-hours-en').value.trim(),
    };
    const btn = $('button[type="submit"]', confForm);
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    try {
      const r = await api('/api/settings', { method: 'PUT', body: payload });
      Object.assign(settings, r.settings);
      clearUnsaved('settings');
      toast('تم حفظ الإعدادات بنجاح');
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      console.error('[admin] settings save failed:', err);
      errBox.textContent = apiMessage(err, 'تعذر حفظ الإعدادات. حاول مرة أخرى.');
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'حفظ الإعدادات';
    }
  });

  const pwForm = $('#pw-form');
  watchDirty(pwForm, 'pw');
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#p-error');
    errBox.classList.add('hidden');
    const current = $('#p-current').value;
    const next = $('#p-new').value;
    const confirm = $('#p-confirm').value;
    if (!current) { errBox.textContent = 'أدخل كلمة المرور الحالية.'; errBox.classList.remove('hidden'); return; }
    if (next.length < 8) { errBox.textContent = 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'; errBox.classList.remove('hidden'); return; }
    if (next !== confirm) { errBox.textContent = 'كلمتا المرور غير متطابقتين.'; errBox.classList.remove('hidden'); return; }
    const btn = $('button[type="submit"]', pwForm);
    btn.disabled = true; btn.textContent = 'جارٍ التغيير…';
    try {
      await api('/api/account/password', { method: 'POST', body: { current_password: current, new_password: next } });
      clearUnsaved('pw');
      pwForm.reset();
      toast('تم تغيير كلمة المرور بنجاح');
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      console.error('[admin] password change failed:', err);
      errBox.textContent = apiMessage(err, 'تعذر تغيير كلمة المرور. حاول مرة أخرى.');
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'تغيير كلمة المرور';
    }
  });
}

/* ============================ global delegation ============================= */

$('#view').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id ? Number(btn.dataset.id) : null;
  if (act === 'add-item') openItemModal(null, Number(btn.dataset.cat));
  else if (act === 'edit-item') openItemModal(id);
  else if (act === 'del-item') { const it = state.items.find((i) => i.id === id); if (it) deleteItem(it, { requestClose: async () => true }, () => {}); }
  else if (act === 'move-item') moveItem(id, btn.dataset.dir);
  else if (act === 'add-cat') openCategoryModal(null);
  else if (act === 'edit-cat') openCategoryModal(id);
  else if (act === 'del-cat') { const c = state.categories.find((x) => x.id === id); if (c) deleteCategory(c); }
  else if (act === 'move-cat') moveCategory(id, btn.dataset.dir);
});

$('#logout-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'تسجيل الخروج', text: 'هل تريد تسجيل الخروج من اللوحة؟', confirmLabel: 'خروج' });
  if (!ok) return;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) { console.warn('[admin] logout call failed (session will expire on its own):', e); }
  setStoredToken('');
  state.user = null;
  unsaved.clear();
  showLogin();
  toast('تم تسجيل الخروج');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.user && renderedRoute === 'orders') refreshOrders();
});

/* ================================ login ===================================== */

$('#pw-toggle').addEventListener('click', () => {
  const inp = $('#login-password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#pw-toggle').textContent = show ? 'إخفاء' : 'إظهار';
  inp.focus();
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-submit');
  const errBox = $('#login-error');
  errBox.classList.add('hidden');
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  if (!username || !password) {
    errBox.textContent = 'الرجاء إدخال اسم المستخدم وكلمة المرور.';
    errBox.classList.remove('hidden'); return;
  }
  btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    setStoredToken(r.token || '');
    state.user = r.user;
    initAudio(); // user gesture → audio now allowed for later beeps
    enterApp(true);
    toast('أهلاً بك في لوحة الفريق');
  } catch (err) {
    console.error('[admin] login failed:', err);
    errBox.textContent = apiMessage(err, 'تعذر تسجيل الدخول. حاول مرة أخرى.');
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'دخول';
  }
});

/* ================================= boot ===================================== */

(async function boot() {
  try {
    const r = await api('/api/auth/me');
    state.user = r.user;
    enterApp(false);
  } catch {
    showLogin();
  }
})();
