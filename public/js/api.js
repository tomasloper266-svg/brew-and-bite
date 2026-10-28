/* Brew & Bite — storefront API client. Same-origin; no auth needed on public endpoints. */
'use strict';

const BB_API = {
  /** GET JSON with friendly network-failure typing (err.kind === 'network'). */
  async getJSON(url) {
    let res;
    try {
      res = await fetch(url, { headers: { 'Accept': 'application/json' } });
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
      res = await fetch('/api/orders', {
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
