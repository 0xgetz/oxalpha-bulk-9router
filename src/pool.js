"use strict";
// Account pool.
//
// Persists harvested sessions to accounts.json and provides round-robin
// selection with automatic failover. Because each session has its own 30-request
// rate-limit window, pooling N sessions multiplies the aggregate free quota.
//
// A session is marked unhealthy when Ox Alpha returns 428 (Turnstile checkpoint)
// or when the remaining quota hits zero; the pool transparently moves on to the
// next healthy session.

const fs = require("fs");
const path = require("path");

function atomicWrite(file, text) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, ".tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

class Pool {
  constructor({ file, sessions = [] } = {}) {
    this.file = file;
    this.sessions = sessions;
    this.cursor = 0;
  }

  static load(file) {
    let sessions = [];
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const list = Array.isArray(raw) ? raw : (raw.sessions || []);
        sessions = list.map((s) => Object.assign(s));
      } catch { sessions = []; }
    }
    return new Pool({ file, sessions });
  }

  save() {
    if (!this.file) return;
    atomicWrite(this.file, JSON.stringify({ savedAt: new Date().toISOString(), sessions: this.sessions }, null, 2));
  }

  add(session) {
    this.sessions.push(typeof session.toJSON === "function" ? session.toJSON() : session);
  }

  // Register a live Session (or a plain record) into the working pool, keeping
  // any existing counters. Idempotent by id.
  register(session) {
    const rec = typeof session.toJSON === "function" ? session.toJSON() : session;
    const existing = this.sessions.find((s) => s.id === rec.id);
    if (existing) {
      existing.remaining = rec.remaining ?? existing.remaining;
      existing.disabled = rec.disabled || existing.disabled;
      existing.cdpSessionId = rec.cdpSessionId ?? existing.cdpSessionId;
      existing.targetId = rec.targetId ?? existing.targetId;
      existing.browserContextId = rec.browserContextId ?? existing.browserContextId;
      existing.csrf = rec.csrf ?? existing.csrf;
      existing.cookies = rec.cookies ?? existing.cookies;
      return existing;
    }
    this.sessions.push(rec);
    return rec;
  }

  addFresh(rec) { return this.register(rec); }

  get size() { return this.sessions.length; }

  isHealthy(s) {
    if (s.disabled) return false;
    if (s.cooldownUntil && Date.now() < s.cooldownUntil) return false;
    if (s.remaining != null && s.remaining <= 0) return false;
    return true;
  }

  healthy() { return this.sessions.filter((s) => this.isHealthy(s)); }

  // Round-robin over healthy sessions.
  next(exclude = new Set()) {
    const list = this.healthy();
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      this.cursor = (this.cursor + 1) % list.length;
      const s = list[this.cursor];
      if (!exclude.has(s.id)) return s;
    }
    return list[0];
  }

  markUsed(s, remaining) {
    if (remaining != null) s.remaining = Number(remaining);
    s.used = (s.used || 0) + 1;
    if (s.remaining != null && s.remaining <= 0) s.disabled = true;
    this.save();
  }

  markTurnstile(s, cooldownMs = 10 * 60 * 1000) {
    s.cooldownUntil = Date.now() + cooldownMs;
    s.lastError = "turnstile_required";
    this.save();
  }

  stats() {
    const total = this.sessions.length;
    const healthy = this.healthy().length;
    return { total, healthy, unhealthy: total - healthy };
  }
}

module.exports = { Pool };
