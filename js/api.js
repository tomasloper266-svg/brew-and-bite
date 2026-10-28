/* Brew & Bite — storefront API client. Same-origin; no auth needed on public endpoints. */
'use strict';

/**
 * On the hosted backend everything is same-origin and BB_BASE stays ''.
 * When the storefront is served from GitHub Pages (different origin), all
 * API calls and uploaded images point at the live backend instead.
 */
const BB_BASE = /(^|\.)github\.io$/.test(location.hostname)
  ? 'https://18npv6obi8-8820.hosted.obvious.ai'
  : '';

const BB_API = {
  /**
   * Absolute URL for static assets served by the backend (uploads, images).
   * Only matters when the storefront runs on GitHub Pages (different origin).
   */
  asset(path) {
    const p = String(path || '').trim();
    return BB_BASE && p.startsWith('/') ? BB_BASE + p : p;
  },

  /** GET JSON with friendly network-failure typing (err.kind === 'network'). */
  async getJSON(url) {
    let res;
    try {
      res = await fetch(BB_BASE + url, { headers: { 'Accept': 'application/json' } });
    } catch (e) {
      const err = new Error('network failure');
      err.kind = 'network';
      throw err;
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error || ''; } catch (e) { /* non-JSON error body */ }
      const err = new Error(msg || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return res.json();
  },

  getMenu() { return this.getJSON('/api/menu'); },
  getSettings() { return this.getJSON('/api/settings'); },

  /** POST /api/orders — server computes the total; client payload has ids + qty only. */
  async postOrder(payload) {
    let res;
    try {
      res = await fetch(BB_BASE + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      const err = new Error('network failure');
      err.kind = 'network';
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || ('HTTP ' + res.status));
      err.status = res.status;
      err.details = body.details;
      throw err;
    }
    return body;
  }
};
