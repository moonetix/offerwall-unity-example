'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const TOKEN_RE = /^pl_[A-Za-z0-9_-]{43}$/;

// Only a hash of each sign-in token is stored, so a database leak does not leak sign-ins.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      balance_micro INTEGER NOT NULL DEFAULT 0,
      age_confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS moonetix_transactions (
      transaction_id TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      reward_micro INTEGER NOT NULL,
      status INTEGER NOT NULL CHECK (status IN (1, 2)),
      offer_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const q = {
    insertPlayer: db.prepare('INSERT INTO players (token_hash, age_confirmed_at) VALUES (?, CURRENT_TIMESTAMP)'),
    byTokenHash: db.prepare('SELECT * FROM players WHERE token_hash = ?'),
    byId: db.prepare('SELECT * FROM players WHERE id = ?'),
    addBalance: db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?'),
    getTx: db.prepare('SELECT * FROM moonetix_transactions WHERE transaction_id = ?'),
    insertTx: db.prepare(`INSERT INTO moonetix_transactions (transaction_id, player_id, reward_micro, status, offer_name)
      VALUES (?, ?, ?, 1, ?) ON CONFLICT (transaction_id) DO NOTHING`),
    reverseTx: db.prepare('UPDATE moonetix_transactions SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ? AND status = 1'),
  };

  function inTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    // Demo sign-in: a new guest player and a random token for it. Replace with your own accounts.
    createPlayer() {
      const token = 'pl_' + crypto.randomBytes(32).toString('base64url');
      const res = q.insertPlayer.run(hashToken(token));
      return { id: Number(res.lastInsertRowid), token };
    },

    findPlayerByToken(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      return q.byTokenHash.get(hashToken(token)) || null;
    },

    getPlayer(id) {
      return q.byId.get(id) || null;
    },

    applyPostback({ transactionId, playerId, rewardMicro, status, offerName }) {
      return inTransaction(() => {
        if (status === 1) {
          if (q.getTx.get(transactionId)) return 'duplicate';
          if (!q.byId.get(playerId)) return 'unknown_user';
          const res = q.insertTx.run(transactionId, playerId, rewardMicro, offerName || null);
          if (res.changes !== 1) return 'duplicate';
          q.addBalance.run(rewardMicro, playerId);
          return 'credited';
        }
        const tx = q.getTx.get(transactionId);
        if (!tx) return 'not_credited';
        if (tx.status === 2) return 'duplicate';
        if (tx.player_id !== playerId) return 'user_mismatch';
        q.reverseTx.run(transactionId);
        // Take back exactly what was credited, never more.
        q.addBalance.run(-tx.reward_micro, tx.player_id);
        return 'reversed';
      });
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openStore };
