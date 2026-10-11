'use strict';

const session = require('express-session');

/**
 * express-session store backed by the app's SQLite database.
 * Sessions live server-side; the browser only holds a signed, opaque id.
 * Keeping user_id in its own column lets us list and revoke a user's devices.
 */
class SqliteStore extends session.Store {
  constructor(db, { ttlMs }) {
    super();
    this.ttlMs = ttlMs;
    this.q = {
      get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      upsert: db.prepare(`
        INSERT INTO sessions (sid, user_id, data, expires, created_at, user_agent)
        VALUES (@sid, @user_id, @data, @expires, @now, @ua)
        ON CONFLICT(sid) DO UPDATE SET
          user_id = excluded.user_id,
          data = excluded.data,
          expires = excluded.expires,
          user_agent = excluded.user_agent
      `),
      del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };

    this.timer = setInterval(() => this.prune(), 15 * 60 * 1000);
    this.timer.unref();
  }

  expiryOf(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    let result = null;
    try {
      const row = this.q.get.get(sid);
      if (row) {
        if (row.expires <= Date.now()) {
          this.q.del.run(sid);
        } else {
          result = JSON.parse(row.data);
        }
      }
    } catch (err) {
      return cb(err);
    }
    cb(null, result);
  }

  set(sid, sess, cb) {
    try {
      this.q.upsert.run({
        sid,
        user_id: sess.userId || null,
        data: JSON.stringify(sess),
        expires: this.expiryOf(sess),
        now: Date.now(),
        ua: sess.ua || null,
      });
    } catch (err) {
      return cb && cb(err);
    }
    cb && cb(null);
  }

  touch(sid, sess, cb) {
    try {
      this.q.touch.run(this.expiryOf(sess), sid);
    } catch (err) {
      return cb && cb(err);
    }
    cb && cb(null);
  }

  destroy(sid, cb) {
    try {
      this.q.del.run(sid);
    } catch (err) {
      return cb && cb(err);
    }
    cb && cb(null);
  }

  prune() {
    try {
      this.q.prune.run(Date.now());
    } catch (err) {
      console.error('[forma] session prune failed:', err.message);
    }
  }
}

module.exports = { SqliteStore };
