'use strict';

const { postbackHash, safeEqual, parseAmount } = require('./moonetix');

// Returns { code, body }. Only a stored change, or an event we deliberately skip, gets a 2xx.
function handlePostback(params, { postbackKey, store, log = () => {} }) {
  const tx = params.get('tx') ?? '';
  const user = params.get('user') ?? '';
  const reward = params.get('reward') ?? '';
  const status = params.get('status') ?? '';
  const hash = params.get('hash') ?? '';

  // Nothing runs before the hash check. Values are hashed exactly as received.
  if (hash === '') return { code: 400, body: 'missing hash' };
  if (!safeEqual(hash, postbackHash(postbackKey, tx, user, reward, status))) {
    return { code: 403, body: 'invalid hash' };
  }

  const rewardMicro = parseAmount(reward);
  if (tx === '' || tx.length > 191 || (status !== '1' && status !== '2') || rewardMicro === null) {
    return { code: 400, body: 'bad request' };
  }

  // Our user IDs are numeric player IDs. Dashboard tests may use names like test_user.
  if (!/^[1-9]\d{0,14}$/.test(user)) {
    log('postback ignored, unknown user', { tx, user });
    return { code: 200, body: 'ignored: unknown user' };
  }

  let result;
  try {
    result = store.applyPostback({
      transactionId: tx,
      playerId: Number(user),
      rewardMicro,
      status: Number(status),
      offerName: (params.get('offer') || '').slice(0, 200),
    });
  } catch (err) {
    log('postback store error', { tx, error: err.message });
    return { code: 500, body: 'try again' };
  }

  log('postback', { tx, user, status, reward, result });
  return { code: 200, body: result };
}

module.exports = { handlePostback };
