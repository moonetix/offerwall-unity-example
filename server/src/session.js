'use strict';

const TOKEN_RE = /^sst_[A-Za-z0-9_-]{43}$/;

// Asks Moonetix for a single-use offerwall session (POST /v1/session). Server side only:
// it needs the API key. A token works once and for 10 minutes, so create one per Open.
async function createSession({ apiBase, apiKey, userId, subs = {}, timeoutMs = 10000 }) {
  let res;
  let data = {};
  try {
    res = await fetch(`${apiBase}/v1/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: String(userId), ...subs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, status: 0, error: 'network' };
  }
  if (res.status === 201 && typeof data.token === 'string' && TOKEN_RE.test(data.token)) {
    return { ok: true, token: data.token };
  }
  return { ok: false, status: res.status, error: typeof data.error === 'string' ? data.error : 'unknown' };
}

module.exports = { createSession };
