'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');
const { openStore } = require('./store');
const { formatAmount } = require('./moonetix');
const { handlePostback } = require('./postback');
const { createSession } = require('./session');
const { send, sendText, readBody, bearerToken, ageConfirmed, defaultLog } = require('./http');

function createApp({ config, store, log = defaultLog }) {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res, { config, store, log });
    } catch (err) {
      if (err && err.statusCode) return send(res, err.statusCode, { error: err.message });
      log('unhandled error', { error: err && err.message });
      send(res, 500, { error: 'server_error' });
    }
  });
}

async function route(req, res, { config, store, log }) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/moonetix/postback') {
    const { code, body } = handlePostback(url.searchParams, { postbackKey: config.postbackKey, store, log });
    return sendText(res, code, body);
  }

  // Demo sign-in. The player confirms they are 16 or older, and gets a random token.
  if (req.method === 'POST' && url.pathname === '/api/players') {
    const body = await readBody(req);
    if (!ageConfirmed(body)) return send(res, 400, { error: 'age_confirmation_required' });
    const player = store.createPlayer();
    log('player created', { id: player.id });
    return send(res, 201, { token: player.token, player_id: player.id });
  }

  if (url.pathname === '/api/balance' || url.pathname === '/api/moonetix/session') {
    // The player comes only from the sign-in token, never from a user ID the game sends.
    const player = store.findPlayerByToken(bearerToken(req));

    if (url.pathname === '/api/balance') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
      if (!player) return send(res, 401, { error: 'sign_in_required' });
      return send(res, 200, {
        player_id: player.id,
        balance: formatAmount(player.balance_micro),
        currency: config.currencyName,
      });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!player) return send(res, 401, { error: 'sign_in_required' });
    await readBody(req);
    const session = await createSession({
      apiBase: config.apiBase,
      apiKey: config.apiKey,
      userId: String(player.id),
      subs: { sub1: 'unity' },
    });
    if (session.ok) return send(res, 200, { token: session.token });
    log('Moonetix session failed', { player: player.id, status: session.status, error: session.error });
    // 403 (app_not_live, user_blocked): do not show the offerwall. Anything else: try again later.
    return send(res, session.status === 403 ? 403 : 503, { error: 'offerwall_unavailable' });
  }

  if (req.method === 'GET' && url.pathname === '/health') return sendText(res, 200, 'ok');

  send(res, 404, { error: 'not_found' });
}

if (require.main === module) {
  const config = loadConfig();
  const store = openStore(config.databasePath);
  createApp({ config, store }).listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
  });
}

module.exports = { createApp };
