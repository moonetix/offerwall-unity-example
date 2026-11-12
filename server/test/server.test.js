'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { API_KEY, vectors, startServer } = require('./helpers');

test('Unity example server end to end', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const pb = vectors.postbacks;
  let ana;
  let ben;

  await t.test('a player is created only after the 16+ confirmation', async () => {
    let res = await app.postForm('/api/players', {});
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'age_confirmation_required' });
    res = await app.postForm('/api/players', { age_confirmed: 'true' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.player_id, 1);
    assert.match(body.token, /^pl_[A-Za-z0-9_-]{43}$/);
    ana = body.token;
    res = await fetch(app.base + '/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age_confirmed: true }),
    });
    assert.equal(res.status, 201);
    ben = (await res.json()).token;
  });

  await t.test('only a hash of the token is stored', () => {
    const row = app.store.getPlayer(1);
    assert.notEqual(row.token_hash, ana);
    assert.equal(row.token_hash.length, 64);
  });

  await t.test('balance and session need a valid sign-in token', async () => {
    for (const token of [null, 'pl_wrong', 'pl_' + 'A'.repeat(43)]) {
      assert.equal((await app.get('/api/balance', token)).status, 401);
      assert.equal((await app.postForm('/api/moonetix/session', {}, token)).status, 401);
    }
    assert.equal(app.moonetix.calls.length, 0);
  });

  await t.test('session: token for the signed-in player, API key stays on the server', async () => {
    const res = await app.postForm('/api/moonetix/session', { user_id: '2' }, ana);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body), ['token']);
    assert.match(body.token, /^sst_[A-Za-z0-9_-]{43}$/);
    assert.ok(!text.includes(API_KEY));
    const call = app.moonetix.calls.at(-1);
    assert.equal(call.path, '/v1/session');
    assert.equal(call.auth, `Bearer ${API_KEY}`);
    assert.deepEqual(call.body, { user_id: '1', sub1: 'unity' });
  });

  await t.test('session: a new token for every open', async () => {
    const a = await (await app.postForm('/api/moonetix/session', {}, ana)).json();
    const b = await (await app.postForm('/api/moonetix/session', {}, ana)).json();
    assert.notEqual(a.token, b.token);
  });

  await t.test('session: blocked player gets 403, other failures 503', async () => {
    app.moonetix.block('2');
    let res = await app.postForm('/api/moonetix/session', {}, ben);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'offerwall_unavailable' });
    app.moonetix.failOnce();
    res = await app.postForm('/api/moonetix/session', {}, ana);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'offerwall_unavailable' });
    assert.equal((await app.get('/api/moonetix/session', ana)).status, 405);
  });

  await t.test('session: Moonetix unreachable gives 503', async () => {
    const saved = app.config.apiBase;
    app.config.apiBase = 'http://127.0.0.1:9';
    try {
      const res = await app.postForm('/api/moonetix/session', {}, ana);
      assert.equal(res.status, 503);
    } finally {
      app.config.apiBase = saved;
    }
  });

  await t.test('new players start at zero', async () => {
    const res = await app.get('/api/balance', ana);
    assert.deepEqual(await res.json(), { player_id: 1, balance: '0', currency: 'Coins' });
  });

  await t.test('real postbacks: credit once, decimals stay exact', async () => {
    let res = await app.postback(pb.credit_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'credited');
    assert.equal(await app.balance(ana), '150');
    res = await app.postback(pb.credit_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '150');
    assert.equal(await (await app.postback(pb.credit_decimal)).text(), 'credited');
    assert.equal(await (await app.postback(pb.credit_five_decimals)).text(), 'credited');
    assert.equal(await app.balance(ana), '151.98456');
  });

  await t.test('the same credit sent 10 times at once is paid once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => app.postback(pb.credit_before_reversed).then((r) => r.text())));
    assert.equal(results.filter((r) => r === 'credited').length, 1);
    assert.equal(results.filter((r) => r === 'duplicate').length, 9);
    assert.equal(await app.balance(ben), '25');
  });

  await t.test('reversal takes back exactly the credit, once', async () => {
    let res = await app.postback(pb.reverse_150);
    assert.equal(await res.text(), 'reversed');
    assert.equal(await app.balance(ana), '1.98456');
    res = await app.postback(pb.reverse_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('a credit after its reversal is not paid again', async () => {
    const res = await app.postback(pb.credit_150);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('reversal for another player than the credit changes nothing', async () => {
    const res = await app.postback(pb.reverse_other_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'user_mismatch');
    assert.equal(await app.balance(ana), '1.98456');
    assert.equal(await app.balance(ben), '25');
  });

  await t.test('reversal of a test_ transaction that was never credited changes nothing', async () => {
    const res = await app.postback(pb.reverse_uncredited_test);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'not_credited');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('unknown players get 200 and no credit', async () => {
    let res = await app.postback(pb.credit_unknown_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'unknown_user');
    res = await app.postback(pb.credit_test_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ignored: unknown user');
  });

  await t.test('tampered, wrongly signed and unsigned postbacks are refused', async () => {
    const tampered = new URL(pb.credit_user2);
    tampered.searchParams.set('reward', '4000');
    let res = await app.postback(tampered.toString());
    assert.equal(res.status, 403);
    const otherUser = new URL(pb.credit_user2);
    otherUser.searchParams.set('user', '1');
    assert.equal((await app.postback(otherUser.toString())).status, 403);
    assert.equal((await app.postback(pb.wrong_key)).status, 403);
    const unsigned = new URL(pb.credit_user2);
    unsigned.searchParams.delete('hash');
    assert.equal((await app.postback(unsigned.toString())).status, 400);
    assert.equal(await app.balance(ben), '25');
    // The untouched postback still works afterwards.
    assert.equal(await (await app.postback(pb.credit_user2)).text(), 'credited');
    assert.equal(await app.balance(ben), '65');
  });

  await t.test('a storage failure answers 500 so Moonetix retries', async () => {
    const original = app.store.applyPostback;
    app.store.applyPostback = () => { throw new Error('disk full'); };
    try {
      const res = await app.postback(pb.credit_unknown_user);
      assert.equal(res.status, 500);
    } finally {
      app.store.applyPostback = original;
    }
  });

});
