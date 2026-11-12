'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../src/server');
const { openStore } = require('../src/store');
const vectors = require('./fixtures/moonetix-vectors.json');

const API_KEY = 'test_api_key_not_secret';

// A stand-in for POST https://api.moonetix.com/v1/session that answers like the docs say.
async function startFakeMoonetix() {
  const calls = [];
  const blocked = new Set();
  let failNext = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
      const reply = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (failNext > 0) {
        failNext -= 1;
        return reply(429, { ok: false, error: 'rate_limited' });
      }
      if (req.method !== 'POST' || req.url !== '/v1/session') return reply(405, { ok: false, error: 'method_not_allowed' });
      if (req.headers.authorization !== `Bearer ${API_KEY}`) return reply(401, { ok: false, error: 'invalid_api_key' });
      if (!/^[A-Za-z0-9._@:+-]{1,100}$/.test(String(body.user_id || ''))) return reply(400, { ok: false, error: 'invalid_user_id' });
      if (blocked.has(body.user_id)) return reply(403, { ok: false, error: 'user_blocked' });
      reply(201, {
        ok: true,
        token: 'sst_' + crypto.randomBytes(32).toString('base64url').slice(0, 43),
        expires_in: 600,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls,
    block: (userId) => blocked.add(userId),
    failOnce: () => { failNext = 1; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startServer() {
  const moonetix = await startFakeMoonetix();
  const config = {
    port: 0,
    databasePath: ':memory:',
    currencyName: 'Coins',
    apiBase: moonetix.base,
    apiKey: API_KEY,
    postbackKey: vectors.postback_key,
  };
  const store = openStore(':memory:');
  const server = createApp({ config, store, log: () => {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
  return {
    base,
    store,
    config,
    moonetix,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await moonetix.close();
      store.close();
    },
    get(path, token) {
      return fetch(base + path, { headers: auth(token) });
    },
    // UnityWebRequest.Post with a WWWForm sends a form body.
    postForm(path, fields, token) {
      return fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...auth(token) },
        body: new URLSearchParams(fields).toString(),
      });
    },
    async balance(token) {
      return (await (await this.get('/api/balance', token)).json()).balance;
    },
    postback(url) {
      const u = new URL(url);
      return fetch(base + u.pathname + u.search);
    },
  };
}

module.exports = { API_KEY, vectors, startServer };
