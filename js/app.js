/* Brew & Bite — storefront app: state, hash router, views. Vanilla JS, no build step. */
'use strict';

(() => {

  // ---------------------------------------------------------------- helpers

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)));

  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v == null ? fallback : v; }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode — prefs just won't persist */ } }
  };

  // ------------------------------------------------------------------ state

  const state = {
    lang: (store.get('bb_lang', 'ar') === 'en') ? 'en' : 'ar',
    currency: (store.get('bb_currency', 'SYP') === 'USD') ? 'USD' : 'SYP',
    loaded: false,
    loadError: false,
    settings: {},
    categories: [],
    itemsIndex: {},          // id -> item (+ category names)
    cart: loadCart(),        // [{id, qty}]
    menuUI: { tab: 'all', q: '', sort: 'featured' },
    checkout: { name: '', phone: '', address: '', note: '' },
    itemQty: {}              // per item-page quantity selection
  };

  window.BB_STATE = state; // read by i18n helper

  function loadCart() {
    try {
      const raw = JSON.parse(store.get('bb_cart', '[]'));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((l) => l && Number.isInteger(l.id) && l.id >= 1 && Number.isInteger(l.qty))
        .map((l) => ({ id: l.id, qty: clampInt(l.qty, 1, 500) }));
    } catch (e) { return []; }
  }

  function saveCart() { store.set('bb_cart', JSON.stringify(state.cart)); }

  function T() { return BB_STRINGS[state.lang]; }

  // ---------------------------------------------------------------- prices

  const exchangeRate = () => {
    const r = parseFloat(state.settings.exchange_rate_syp_per_usd);
    return (Number.isFinite(r) && r > 0) ? r : 0;
  };

  const fmtSYP = (n) => n.toLocaleString('en-US') + ' ' + (state.lang === 'ar' ? 'ل.س' : 'SYP');
  const fmtUSD = (n) => {
    const r = exchangeRate();
    if (!r) return '';
    return '$' + (n / r).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /** Main price in the selected currency + small equivalent in the other. */
  function priceHTML(syp, { withEquivalent = false } = {}) {
    const usd = fmtUSD(syp);
    const sypS = fmtSYP(syp);
    const main = state.currency === 'USD' && usd ? usd : sypS;
    let html = `<strong class="price-main">${esc(main)}</strong>`;
    if (withEquivalent && usd) {
      const sub = state.currency === 'USD' ? sypS : usd;
      html += `<span class="price-sub"> ≈ ${esc(sub)}</span>`;
    }
    return html;
  }

  // ---------------------------------------------------------------- phones

  /**
   * tel: href from the stored number. Old site dialled a Saudi (+966) code by
   * mistake — we always dial +963 + stored digits with leading zeros stripped.
   * Display still shows the number exactly as stored.
   */
  function telHref(stored) {
    const s = String(stored || '').trim();
    if (!s) return '';
    if (s.startsWith('+')) {
      const intl = s.replace(/[^\d+]/g, '');
      return intl.length > 1 ? 'tel:' + intl : '';
    }
    const digits = s.replace(/\D/g, '');
    if (!digits) return '';
    return 'tel:+963' + digits.replace(/^0+/, '');
  }

  // ----------------------------------------------------------------- icons

  const ICONS = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    back: '<svg class="icon-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4-2 5.5-2 8.5a2.5 2.5 0 0 0 5 .2C16.5 12 19 13.7 19 16.5A7 7 0 0 1 5 17c0-3 2-4.5 2.5-7C8 7 9 4 12 2z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4m0 4h.01"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 3v18M17 3c-1.5 1.5-2.5 3.5-2.5 6 0 2 1 3 2.5 3v9"/></svg>'
  };

  // ---------------------------------------------------------------- images

  /** Broken/missing images collapse into a warm branded placeholder. */
  window.bbImgFail = function (img) {
    const wrap = img && img.parentElement;
    if (!wrap || !wrap.classList.contains('img-wrap')) return;
    wrap.classList.add('img-fallback');
    img.remove();
  };

  function imgWrapHTML(src, alt, cls = '') {
    const s = String(src || '').trim();
    if (!s) return `<div class="img-wrap img-fallback ${cls}" role="img" aria-label="${esc(alt)}"></div>`;
    return `<div class="img-wrap ${cls}"><img src="${esc(BB_API.asset(s))}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="bbImgFail(this)"></div>`;
  }

  // ----------------------------------------------------------------- cart

  const cartCount = () => state.cart.reduce((n, l) => n + l.qty, 0);
  const cartTotalSYP = () => state.cart.reduce((n, l) => {
    const it = state.itemsIndex[l.id];
    return it ? n + it.price_syp * l.qty : n;
  }, 0);

  function cartAdd(id, qty) {
    const line = state.cart.find((l) => l.id === id);
    if (line) line.qty = clampInt(line.qty + qty, 1, 500);
    else state.cart.push({ id, qty: clampInt(qty, 1, 500) });
    saveCart(); updateFab();
  }

  function cartSet(id, qty) {
    const i = state.cart.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (qty <= 0) state.cart.splice(i, 1);
    else state.cart[i].qty = clampInt(qty, 1, 500);
    saveCart(); updateFab();
  }

  function updateFab() {
    const fab = $('#cartFab');
    const badge = $('#fabBadge');
    const n = cartCount();
    const route = parseRoute();
    const hideFab = !state.loaded || route.name === 'cart' || route.name === 'success';
    fab.hidden = hideFab;
    badge.hidden = n === 0;
    badge.textContent = String(n);
    $('.fab-icon', fab).innerHTML = ICONS.cart;
  }

  // ---------------------------------------------------------------- toast

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.hidden = true; }, 300);
    }, 1900);
  }

  // ---------------------------------------------------------------- header

  function goBack() {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  }

  function renderHeader(route) {
    const t = T();
    const showBack = route.name !== 'home';
    // On home the brand already identifies the page — a centered title would duplicate it.
    const title = route.name === 'menu' ? t.menuTitle
      : route.name === 'cart' ? t.cartTitle
      : route.name === 'item' ? t.itemTitle
      : '';
    // The pill always offers the OTHER currency — the one this tap switches to.
    const curLabel = state.currency === 'SYP' ? '$' : (state.lang === 'ar' ? 'ل.س' : 'SYP');
    const curHint = state.currency === 'SYP'
      ? (state.lang === 'ar' ? 'عرض بالدولار' : 'Show in USD')
      : (state.lang === 'ar' ? 'عرض بالليرة السورية' : 'Show in SYP');
    const curBtn = `<button class="pill-btn" id="currencyBtn" title="${esc(curHint)}" aria-label="${esc(curHint)}">${esc(curLabel)}</button>`;
    $('#topbar').innerHTML = `
      <div class="topbar-inner">
        ${showBack
          ? `<button class="icon-btn" id="backBtn" aria-label="${esc(t.back)}">${ICONS.back}</button>`
          : `<a class="brand" href="#/" aria-label="Brew &amp; Bite — ${esc(t.homeTitle)}">
               <span class="brand-mark" aria-hidden="true">B</span>
               <span class="brand-name">Brew &amp; Bite</span>
             </a>`}
        <span class="topbar-title">${esc(title)}</span>
        <div class="topbar-actions">
        ${curBtn}
          <button class="pill-btn" id="langBtn" title="${esc(state.lang === 'ar' ? 'English' : 'العربية')}" aria-label="${esc(state.lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية')}">${esc(t.langBtn)}</button>
        </div>
      </div>`;
    $('#langBtn').addEventListener('click', () => {
      state.lang = state.lang === 'ar' ? 'en' : 'ar';
      store.set('bb_lang', state.lang);
      applyLangDir();
      renderRoute(parseRoute());
    });
    $('#currencyBtn').addEventListener('click', () => {
      state.currency = state.currency === 'SYP' ? 'USD' : 'SYP';
      store.set('bb_currency', state.currency);
      renderRoute(parseRoute());
    });
    const back = $('#backBtn');
    if (back) back.addEventListener('click', goBack);
  }

  function applyLangDir() {
    const html = document.documentElement;
    html.lang = state.lang;
    html.dir = T().dir;
  }

  // ---------------------------------------------------------------- footer

  function renderFooter() {
    const t = T();
    const s = state.settings || {};
    const phone = String(s.phone || '').trim();
    const hours = BB_TEXT.pick(s.opening_hours_ar, s.opening_hours_en);
    const tel = telHref(phone);
    $('#foot').innerHTML = `
      <div class="foot-brand">
        <span class="brand-mark" aria-hidden="true">B</span>
        <span class="brand-name">Brew &amp; Bite</span>
        <span class="foot-tag">${esc(t.brandTag)}</span>
      </div>
      ${(tel || hours) ? `
      <div class="foot-info">
        ${tel ? `<a class="foot-line" href="${esc(tel)}">${ICONS.phone}<bdi>${esc(phone)}</bdi></a>` : ''}
        ${hours ? `<span class="foot-line">${ICONS.clock}<bdi>${esc(hours)}</bdi></span>` : ''}
      </div>` : ''}
      <div class="foot-copy">${esc(t.poweredBy)}</div>`;
  }

  // ---------------------------------------------------------------- router

  function parseRoute() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const query = new URLSearchParams(qs || '');
    if (parts.length === 0) return { name: 'home' };
    if (parts[0] === 'menu') {
      const cat = parseInt(query.get('cat'), 10);
      return { name: 'menu', cat: Number.isInteger(cat) ? cat : null };
    }
    if (parts[0] === 'item' && parts[1]) {
      const id = parseInt(parts[1], 10);
      return { name: 'item', id: Number.isInteger(id) ? id : null };
    }
    if (parts[0] === 'cart') return { name: 'cart' };
    if (parts[0] === 'success' && parts[1]) return { name: 'success', id: parts[1] };
    return { name: 'home' };
  }

  // ----------------------------------------------------------------- boot

  async function loadData() {
    const [settingsRes, menuRes] = await Promise.all([BB_API.getSettings(), BB_API.getMenu()]);
    state.settings = settingsRes.settings || {};
    state.categories = menuRes.categories || [];
    state.itemsIndex = {};
    for (const c of state.categories) {
      for (const it of c.items || []) {
        state.itemsIndex[it.id] = Object.assign({}, it, {
          category_id: c.id,
          category_name_ar: c.name_ar,
          category_name_en: c.name_en
        });
      }
    }
    state.loaded = true;
    state.loadError = false;
  }

  async function boot() {
    state.loadError = false;
    $('#view').innerHTML = loadingHTML();
    try {
      await loadData();
      renderRoute(parseRoute());
    } catch (e) {
      state.loadError = true;
      renderFatalError();
    }
  }

  function renderRoute(route) {
    if (!state.loaded) return;
    state.menuUI = { tab: route.name === 'menu' && route.cat ? route.cat : 'all', q: '', sort: 'featured' };
    window.removeEventListener('scroll', onScrollSpy);
    renderHeader(route);
    renderFooter();
    if (route.name === 'home') renderHome();
    else if (route.name === 'menu') renderMenu(route);
    else if (route.name === 'item') renderItemPage(route);
    else if (route.name === 'cart') renderCart();
    else if (route.name === 'success') renderSuccess(route);
    updateFab();
    document.title = 'Brew & Bite' + (route.name === 'home' ? '' : ' — ' + T().menuTitle);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => renderRoute(parseRoute()));

  // ----------------------------------------------------------- view shells

  function loadingHTML() {
    return `
      <div class="skeleton-hero"></div>
      <div class="container">
        <div class="skel-grid">
          ${'<div class="skel-card"></div>'.repeat(6)}
        </div>
      </div>`;
  }

  function renderFatalError() {
    const t = T();
    renderHeader({ name: 'home' });
    renderFooter();
    updateFab();
    $('#view').innerHTML = `
      <div class="container">
        <div class="state-box">
          <span class="state-icon err">${ICONS.alert}</span>
          <h2>${esc(t.errNetwork)}</h2>
          <button class="btn btn-primary" id="retryBtn">${esc(t.retry)}</button>
        </div>
      </div>`;
    $('#retryBtn').addEventListener('click', boot);
  }

  // ------------------------------------------------------------------ home

  function renderHome() {
    const t = T();
    const s = state.settings || {};
    const img = String(s.hero_image || '').trim();
    const title = BB_TEXT.pick(s.hero_title_ar, s.hero_title_en) || t.defaultHeroTitle;
    const subtitle = BB_TEXT.pick(s.hero_subtitle_ar, s.hero_subtitle_en) || t.defaultHeroSubtitle;
    const chips = BB_TEXT.splitList(BB_TEXT.pick(s.hero_chips_ar, s.hero_chips_en));
    const chipList = (chips.length ? chips : t.defaultChips)
      .map((c) => `<span class="hero-chip">${esc(c)}</span>`).join('');
    const cta = BB_TEXT.pick(s.hero_cta_ar, s.hero_cta_en) || t.defaultCta;

    const cats = state.categories.filter((c) => (c.items || []).length > 0);
    const cards = cats.map((c) => `
      <a class="cat-card" href="#/menu?cat=${c.id}">
        ${imgWrapHTML(c.card_image, BB_TEXT.pick(c.name_ar, c.name_en), 'cat-card-img')}
        <span class="cat-card-name">${esc(BB_TEXT.pick(c.name_ar, c.name_en))}</span>
        <span class="cat-card-count">${esc((c.items || []).length)}</span>
      </a>`).join('');

    $('#view').innerHTML = `
      <section class="hero" ${img ? `style="background-image:linear-gradient(180deg, rgba(247,241,230,0.35) 0%, rgba(247,241,230,0.72) 55%, var(--bg) 100%), url('${esc(img)}')"` : ''}>
        <div class="container">
          <div class="hero-mark" aria-hidden="true">B</div>
          <h1 class="hero-title">${esc(title)}</h1>
          <p class="hero-subtitle">${esc(subtitle)}</p>
          ${chipList ? `<div class="hero-chips">${chipList}</div>` : ''}
          <a class="btn btn-primary hero-cta" href="#/menu">${esc(cta)}</a>
        </div>
      </section>
      <section class="container">
        <h2 class="section-title">${esc(t.categoriesTitle)}</h2>
        ${cats.length ? `<div class="cat-grid">${cards}</div>` : `
        <div class="state-box">
          <span class="state-icon">${ICONS.food}</span>
          <h2>${esc(t.menuEmpty)}</h2>
          <p>${esc(t.menuEmptyHint)}</p>
        </div>`}
      </section>`;
  }

  // ------------------------------------------------------------------ menu

  const SORTS = [
    { key: 'featured' }, { key: 'newest' }, { key: 'price-asc' },
    { key: 'price-desc' }, { key: 'popular' }, { key: 'offers' }
  ];

  function sortItems(items, sort) {
    const arr = [...items];
    switch (sort) {
      case 'newest': arr.sort((a, b) => b.id - a.id); break;
      case 'price-asc': arr.sort((a, b) => a.price_syp - b.price_syp); break;
      case 'price-desc': arr.sort((a, b) => b.price_syp - a.price_syp); break;
      case 'popular': arr.sort((a, b) => (b.is_popular ? 1 : 0) - (a.is_popular ? 1 : 0)); break;
      case 'offers': return arr.filter((i) => i.is_offer);
      default: break; // featured — keep server (sort_order) order
    }
    return arr;
  }

  function itemMatches(item, q) {
    const needle = q.toLowerCase();
    return String(item.name_ar || '').toLowerCase().includes(needle)
        || String(item.name_en || '').toLowerCase().includes(needle);
  }

  function badgesHTML(item) {
    const t = T();
    let html = '';
    if (item.is_offer) html += `<span class="badge badge-offer">${ICONS.flame}${esc(t.badgeOffer)}</span>`;
    if (item.is_popular) html += `<span class="badge badge-popular">${ICONS.star}${esc(t.badgePopular)}</span>`;
    return html ? `<span class="badges">${html}</span>` : '';
  }

  function itemCardHTML(item) {
    const sold = item.is_available === false;
    return `
      <a class="item-card ${sold ? 'sold-out' : ''}" href="#/item/${item.id}">
        ${imgWrapHTML(item.image, BB_TEXT.pick(item.name_ar, item.name_en), 'item-card-img')}
        <div class="item-card-body">
          <h3 class="item-card-name">${esc(BB_TEXT.pick(item.name_ar, item.name_en))}</h3>
          ${sold ? `<span class="badge badge-soldout">${esc(T().soldOut)}</span>` : badgesHTML(item)}
          ${priceHTML(item.price_syp)}
        </div>
      </a>`;
  }

  function menuResultsHTML() {
    const t = T();
    const { tab, q, sort } = state.menuUI;
    const searching = q.trim().length > 0;

    let cats = state.categories;
    if (!searching && tab !== 'all') cats = cats.filter((c) => c.id === tab);

    const sections = cats
      .map((c) => {
        let items = searching ? (c.items || []).filter((i) => itemMatches(i, q.trim())) : (c.items || []);
        items = sortItems(items, sort);
        return { cat: c, items };
      })
      .filter((sec) => sec.items.length > 0);

    if (!sections.length) {
      return `
        <div class="state-box">
          <span class="state-icon">${ICONS.search}</span>
          <h2>${esc(searching ? t.noResults : t.menuEmpty)}</h2>
          <p>${esc(searching ? t.noResultsHint : t.menuEmptyHint)}</p>
        </div>`;
    }

    return sections.map((sec) => `
      <section class="menu-section" id="sec-${sec.cat.id}" data-sec="${sec.cat.id}">
        <h2 class="menu-sec-title">${esc(BB_TEXT.pick(sec.cat.name_ar, sec.cat.name_en))}</h2>
        <div class="item-grid">${sec.items.map(itemCardHTML).join('')}</div>
      </section>`).join('');
  }

  function refreshMenuResults() {
    const box = $('#menuResults');
    if (box) box.innerHTML = menuResultsHTML();
    const tabs = $('#catTabs');
    if (tabs) {
      $$('.cat-tab', tabs).forEach((b) => {
        const active = String(state.menuUI.tab) === b.dataset.cat;
        b.classList.toggle('active', active);
        if (active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    }
  }

  /** Highlight the category tab whose section is nearest the top while scrolling. */
  function onScrollSpy() {
    if (state.menuUI.tab !== 'all' || state.menuUI.q.trim()) return;
    const secs = $$('.menu-section');
    if (!secs.length) return;
    const probe = 132; // sticky header + tab bar + margin
    let current = secs[0].dataset.sec;
    for (const sec of secs) {
      if (sec.getBoundingClientRect().top - probe <= 0) current = sec.dataset.sec;
    }
    const tabs = $('#catTabs');
    if (!tabs) return;
    $$('.cat-tab', tabs).forEach((b) => {
      const active = b.dataset.cat === String(current);
      b.classList.toggle('active', active);
      if (active) {
        b.setAttribute('aria-current', 'true');
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else b.removeAttribute('aria-current');
    });
  }

  let spyRaf = null;
  function bindScrollSpy() {
    window.removeEventListener('scroll', onScrollSpy);
    if (state.menuUI.tab === 'all') {
      window.addEventListener('scroll', () => {
        if (!spyRaf) spyRaf = requestAnimationFrame(() => { spyRaf = null; onScrollSpy(); });
      }, { passive: true });
    }
  }

  function renderMenu(route) {
    const t = T();
    state.menuUI = {
      tab: route.cat || 'all',
      q: '',
      sort: 'featured'
    };
    const tabs = [{ id: 'all', label: t.all }].concat(
      state.categories.filter((c) => (c.items || []).length > 0)
        .map((c) => ({ id: c.id, label: BB_TEXT.pick(c.name_ar, c.name_en) }))
    );

    $('#view').innerHTML = `
      <div class="menu-controls">
        <div class="container">
          <div class="search-wrap">
            ${ICONS.search}
            <input id="menuSearch" type="search" placeholder="${esc(t.searchPh)}"
                   aria-label="${esc(t.searchLabel)}" autocomplete="off" inputmode="search">
          </div>
          <div class="cat-tabs" id="catTabs" role="tablist" aria-label="${esc(t.categoriesTitle)}">
            ${tabs.map((tb) => `
              <button class="cat-tab ${String(state.menuUI.tab) === String(tb.id) ? 'active' : ''}"
                      data-cat="${esc(tb.id)}" role="tab"
                      ${String(state.menuUI.tab) === String(tb.id) ? 'aria-current="true"' : ''}>${esc(tb.label)}</button>`).join('')}
          </div>
          <div class="sort-chips" id="sortChips">
            ${SORTS.map((s) => {
              const labels = {
                'featured': t.sortFeatured, 'newest': t.sortNewest,
                'price-asc': t.sortPriceAsc, 'price-desc': t.sortPriceDesc,
                'popular': t.sortPopular, 'offers': t.sortOffers
              };
              return `<button class="sort-chip ${state.menuUI.sort === s.key ? 'active' : ''}" data-sort="${s.key}">${esc(labels[s.key])}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="container" id="menuResults"></div>`;

    refreshMenuResults();
    bindScrollSpy();

    $('#menuSearch').addEventListener('input', (e) => {
      state.menuUI.q = e.target.value;
      refreshMenuResults();
      bindScrollSpy();
    });
    $$('.cat-tab').forEach((b) => b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      state.menuUI.tab = cat === 'all' ? 'all' : parseInt(cat, 10);
      history.replaceState(null, '', cat === 'all' ? '#/menu' : `#/menu?cat=${cat}`);
      refreshMenuResults();
      bindScrollSpy();
      const first = $('.menu-section');
      if (first && state.menuUI.tab !== 'all') first.scrollIntoView({ block: 'start' });
    }));
    $$('.sort-chip').forEach((b) => b.addEventListener('click', () => {
      state.menuUI.sort = b.dataset.sort;
      $$('.sort-chip').forEach((x) => x.classList.toggle('active', x === b));
      refreshMenuResults();
    }));
  }

  // ------------------------------------------------------------- item page

  function renderItemPage(route) {
    const t = T();
    const item = route.id ? state.itemsIndex[route.id] : null;

    if (!item || item.is_available === false) {
      $('#view').innerHTML = `
        <div class="container">
          <div class="state-box">
            <span class="state-icon">${ICONS.alert}</span>
            <h2>${esc(t.itemUnavailable)}</h2>
            <p>${esc(t.itemUnavailableHint)}</p>
            <a class="btn btn-primary" href="#/menu">${esc(t.backToMenu)}</a>
          </div>
        </div>`;
      return;
    }

    state.itemQty = state.itemQty || {};
    state.itemQty[route.id] = state.itemQty[route.id] || 1;
    const qty = () => state.itemQty[route.id];

    const desc = BB_TEXT.pick(item.desc_ar, item.desc_en);

    $('#view').innerHTML = `
      <article class="container item-page">
        ${imgWrapHTML(item.image, BB_TEXT.pick(item.name_ar, item.name_en), 'item-hero')}
        <div class="item-head">
          <h1 class="item-name">${esc(BB_TEXT.pick(item.name_ar, item.name_en))}</h1>
          ${badgesHTML(item)}
        </div>
        <div class="item-price">${priceHTML(item.price_syp, { withEquivalent: true })}</div>
        ${desc ? `<p class="item-desc">${esc(desc)}</p>` : ''}
        <p class="item-cat">${esc(BB_TEXT.pick(item.category_name_ar, item.category_name_en))}</p>
        <div class="item-actionbar">
          <div class="qty-stepper" role="group" aria-label="${esc(t.qtyLabel)}">
            <button id="qtyMinus" aria-label="${esc(t.decrease)}">${ICONS.minus}</button>
            <span id="qtyVal" aria-live="polite">${qty()}</span>
            <button id="qtyPlus" aria-label="${esc(t.increase)}">${ICONS.plus}</button>
          </div>
          <button class="btn btn-primary" id="addBtn">
            ${esc(t.addToCart)} · <span id="addPrice">${esc(state.currency === 'USD' && fmtUSD(item.price_syp) ? fmtUSD(item.price_syp * qty()) : fmtSYP(item.price_syp * qty()))}</span>
          </button>
        </div>
        <div class="actionbar-spacer"></div>
      </article>`;

    const updateAddLabel = () => {
      $('#qtyVal').textContent = String(qty());
      const total = item.price_syp * qty();
      $('#addPrice').textContent = (state.currency === 'USD' && fmtUSD(total)) ? fmtUSD(total) : fmtSYP(total);
    };
    $('#qtyPlus').addEventListener('click', () => { state.itemQty[route.id] = clampInt(qty() + 1, 1, 99); updateAddLabel(); });
    $('#qtyMinus').addEventListener('click', () => { state.itemQty[route.id] = clampInt(qty() - 1, 1, 99); updateAddLabel(); });
    $('#addBtn').addEventListener('click', () => {
      cartAdd(item.id, qty());
      toast(t.addedToast);
    });
  }

  // ------------------------------------------------------------------ cart

  function renderCart() {
    const t = T();
    const lines = state.cart.map((l) => ({ line: l, item: state.itemsIndex[l.id] }));
    const live = lines.filter((x) => x.item && x.item.is_available !== false);

    if (!live.length) {
      $('#view').innerHTML = `
        <div class="container">
          <div class="state-box">
            <span class="state-icon">${ICONS.cart}</span>
            <h2>${esc(t.cartEmpty)}</h2>
            <p>${esc(t.cartEmptyHint)}</p>
            <a class="btn btn-primary" href="#/menu">${esc(t.browseMenu)}</a>
          </div>
        </div>`;
      return;
    }

    const total = live.reduce((n, x) => n + x.item.price_syp * x.line.qty, 0);

    const linesHTML = lines.map(({ line, item }) => {
      if (!item || item.is_available === false) {
        return `
          <div class="cart-line gone">
            <span class="gone-name">${esc(t.soldOut)}</span>
            <button class="icon-btn sm" data-remove="${line.id}" aria-label="${esc(t.remove)}">${ICONS.trash}</button>
          </div>`;
      }
      return `
        <div class="cart-line">
          ${imgWrapHTML(item.image, BB_TEXT.pick(item.name_ar, item.name_en), 'cart-line-img')}
          <div class="cart-line-body">
            <h3>${esc(BB_TEXT.pick(item.name_ar, item.name_en))}</h3>
            ${priceHTML(item.price_syp * line.qty)}
          </div>
          <div class="cart-line-actions">
            <div class="qty-stepper sm">
              <button data-dec="${line.id}" aria-label="${esc(t.decrease)}">${ICONS.minus}</button>
              <span>${line.qty}</span>
              <button data-inc="${line.id}" aria-label="${esc(t.increase)}">${ICONS.plus}</button>
            </div>
            <button class="icon-btn sm" data-remove="${line.id}" aria-label="${esc(t.remove)}">${ICONS.trash}</button>
          </div>
        </div>`;
    }).join('');

    $('#view').innerHTML = `
      <div class="container">
        <section class="cart-lines">${linesHTML}</section>
        <section class="cart-total">
          <span>${esc(t.subtotal)}</span>
          <span class="cart-total-price">${priceHTML(total, { withEquivalent: true })}</span>
        </section>
        <section class="checkout">
          <h2 class="section-title">${esc(t.checkoutTitle)}</h2>
          <form id="checkoutForm" novalidate>
            <div class="field">
              <label for="f-name">${esc(t.fName)} <em>*</em></label>
              <input id="f-name" name="name" type="text" required maxlength="60" placeholder="${esc(t.fNamePh)}" value="${esc(state.checkout.name)}">
            </div>
            <div class="field">
              <label for="f-phone">${esc(t.fPhone)} <em>*</em></label>
              <input id="f-phone" name="phone" type="tel" required maxlength="40" placeholder="${esc(t.fPhonePh)}" value="${esc(state.checkout.phone)}" inputmode="tel">
            </div>
            <div class="field">
              <label for="f-address">${esc(t.fAddress)} <span class="opt">${esc(t.optional)}</span></label>
              <input id="f-address" name="address" type="text" maxlength="200" placeholder="${esc(t.fAddressPh)}" value="${esc(state.checkout.address)}">
            </div>
            <div class="field">
              <label for="f-note">${esc(t.fNote)} <span class="opt">${esc(t.optional)}</span></label>
              <textarea id="f-note" name="note" rows="2" maxlength="500" placeholder="${esc(t.fNotePh)}">${esc(state.checkout.note)}</textarea>
            </div>
            <div id="formError" class="form-error" hidden></div>
            <button class="btn btn-primary btn-block" id="submitBtn" type="submit">${esc(t.placeOrder)}</button>
          </form>
        </section>
      </div>`;

    const saveField = (id, key) => {
      $(id).addEventListener('input', (e) => { state.checkout[key] = e.target.value; });
    };
    saveField('#f-name', 'name');
    saveField('#f-phone', 'phone');
    saveField('#f-address', 'address');
    saveField('#f-note', 'note');

    $$('.cart-line [data-inc]').forEach((b) => b.addEventListener('click', () => {
      const id = parseInt(b.dataset.inc, 10);
      const l = state.cart.find((x) => x.id === id);
      cartSet(id, (l ? l.qty : 0) + 1);
      renderRoute({ name: 'cart' });
    }));
    $$('.cart-line [data-dec]').forEach((b) => b.addEventListener('click', () => {
      const id = parseInt(b.dataset.dec, 10);
      const l = state.cart.find((x) => x.id === id);
      cartSet(id, l ? l.qty - 1 : 0);
      renderRoute({ name: 'cart' });
    }));
    $$('.cart-line [data-remove]').forEach((b) => b.addEventListener('click', () => {
      cartSet(parseInt(b.dataset.remove, 10), 0);
      renderRoute({ name: 'cart' });
    }));

    $('#checkoutForm').addEventListener('submit', submitOrder);
  }

  function showFormError(msg) {
    const box = $('#formError');
    box.textContent = msg;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  function orderErrorMessage(err) {
    const t = T();
    const m = String(err.message || '');
    if (m.includes('cannot be ordered')) return t.errUnavailable;
    if (m.includes('customer_name')) return t.errName;
    if (m.includes('customer_phone')) return t.errPhone;
    if (m.includes('items')) return t.errEmptyCart;
    return t.errGeneric;
  }

  async function submitOrder(e) {
    e.preventDefault();
    const t = T();
    const errBox = $('#formError');
    errBox.hidden = true;

    const name = state.checkout.name.trim();
    const phone = state.checkout.phone.trim();
    const address = state.checkout.address.trim();
    const note = state.checkout.note.trim();

    if (name.length < 2 || name.length > 60) return showFormError(t.errName);
    if (!/^[0-9+\-() ][0-9+\-() ]{4,39}$/.test(phone)) return showFormError(t.errPhone);
    const orderable = state.cart.filter((l) => state.itemsIndex[l.id]);
    if (!orderable.length) return showFormError(t.errEmptyCart);

    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = t.placing;

    try {
      const res = await BB_API.postOrder({
        customer_name: name,
        customer_phone: phone,
        address: address || undefined,
        note: note || undefined,
        items: orderable.map((l) => ({ item_id: l.id, qty: l.qty }))
      });
      try { sessionStorage.setItem('bb_last_order', JSON.stringify(res.order)); } catch (e2) { /* non-fatal */ }
      state.cart = [];
      saveCart();
      updateFab();
      location.hash = '#/success/' + res.order.id;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t.placeOrder;
      if (err.kind === 'network') return showFormError(t.errNetwork);
      if (err.status === 400 && /cannot be ordered/.test(String(err.message))) {
        // Drop lines the server refused, refresh menu data, let the customer retry.
        try {
          await loadData();
          state.cart = state.cart.filter((l) => state.itemsIndex[l.id]);
          saveCart();
          updateFab();
        } catch (e2) { /* keep the cart as-is; message still shown */ }
        return showFormError(t.errUnavailable);
      }
      showFormError(orderErrorMessage(err));
    }
  }

  // --------------------------------------------------------------- success

  function renderSuccess(route) {
    const t = T();
    let order = null;
    try { order = JSON.parse(sessionStorage.getItem('bb_last_order') || 'null'); } catch (e) { order = null; }
    if (!order || String(order.id) !== String(route.id)) order = null;

    const lines = order ? (order.items || []) : [];
    $('#view').innerHTML = `
      <div class="container">
        <div class="state-box success-box">
          <span class="state-icon ok">${ICONS.check}</span>
          <h2>${esc(t.successTitle)}</h2>
          <p>${esc(t.successHint)}</p>
          <div class="order-no">
            <span>${esc(t.orderNo)}</span>
            <strong>#${esc(route.id)}</strong>
          </div>
          ${lines.length ? `
          <div class="success-lines">
            ${lines.map((l) => `
              <div class="success-line">
                <span>${esc(l.qty)} × ${esc(state.lang === 'ar' ? l.name_ar : (l.name_en || l.name_ar))}</span>
                <bdi>${esc(fmtSYP(l.unit_price_syp * l.qty))}</bdi>
              </div>`).join('')}
            <div class="success-line total">
              <span>${esc(t.subtotal)}</span>
              <bdi>${esc(fmtSYP(order.total_syp))}</bdi>
            </div>
          </div>` : ''}
          <p class="cod-line">${ICONS.check}${esc(t.cod)}</p>
          <a class="btn btn-primary" href="#/menu">${esc(t.backToMenu)}</a>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ init

  applyLangDir();
  boot();

})();
