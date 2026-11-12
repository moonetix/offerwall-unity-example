'use strict';

const crypto = require('node:crypto');

const AMOUNT_RE = /^(\d{1,9})(?:\.(\d{1,6}))?$/;

// Units of 1/1,000,000 coin. Integers keep balances exact.
const MICRO = 1000000;

function postbackHash(postbackKey, tx, userId, reward, status) {
  return crypto.createHmac('sha256', postbackKey).update(`${tx}:${userId}:${reward}:${status}`).digest('hex');
}

function safeEqual(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseAmount(value) {
  const m = AMOUNT_RE.exec(String(value));
  if (!m) return null;
  return Number(m[1]) * MICRO + Number((m[2] || '').padEnd(6, '0'));
}

function formatAmount(micro) {
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO).padStart(6, '0').replace(/0+$/, '');
  return sign + whole + (frac ? '.' + frac : '');
}

module.exports = { postbackHash, safeEqual, parseAmount, formatAmount };
