"use strict";
// OpenAI-compatible pool adapter for Ox Alpha.
//
//   POST /v1/chat/completions   (stream + non-stream)
//   GET  /v1/models
//   GET  /health
//   GET  /pool                  pool stats + per-session remaining
//   POST /pool/reload           rehydrate from accounts.json (or harvest if empty)
//
// Every request is relayed from inside a live oxalpha.com page belonging to a
// pooled session, so it rides the browser's residential IP and cookie jar. On a
// 428 (Turnstile) or exhausted quota the adapter fails over to the next healthy
// session automatically.
//
// Saved sessions are hydrated lazily: on first use the adapter opens an isolated
// browser context, injects the session cookies, loads /chat and keeps the page
// open for relaying.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { BrowserManager } = require("./browser");
const { hydrateSession, chatViaPage, MODEL } = require("./oxalpha");
const { Pool } = require("./pool");

function json(res, cors, code, obj) {
  res.writeHead(code, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function makeAdapter({ configFile, cdpUrl, chromePath, log = console.log } = {}) {
  const cfgPath = configFile || path.join(process.cwd(), "config.json");
  let cfg = {};
  if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

  const prefix = process.env.OXALPHA_PREFIX || cfg.modelPrefix || "oxalpha";
  const port = Number(process.env.PORT || cfg.port || 8790);
  const host = process.env.HOST || cfg.host || "127.0.0.1";
  const accountsFile = path.resolve(
    path.dirname(cfgPath),
    process.env.OXALPHA_ACCOUNTS || cfg.accountsFile || "accounts.json"
  );

  const browser = new BrowserManager({
    cdpUrl: cdpUrl || process.env.CDP_URL || cfg.cdpUrl,
    chromePath: chromePath || process.env.CHROME_PATH || cfg.chromePath,
    headless: cfg.headless !== false,
  });
  await browser.connect();
  const cdp = browser.cdp;

  const saved = Pool.load(accountsFile);
  const pool = new Pool({ file: accountsFile });
  // live = id -> hydrated Session (with an open page)
  const live = new Map();

  // Hydrate a saved record into a live session, memoised.
  async function ensureLive(rec) {
    if (live.has(rec.id)) return live.get(rec.id);
    const s = await hydrateSession(cdp, rec);
    live.set(rec.id, s);
    return s;
  }

  // Build the working set from saved records whose pages we can open.
  async function hydrateAll() {
    for (const rec of saved.sessions) {
      if (rec.disabled) { pool.addFresh(rec); continue; }
      try {
        const s = await ensureLive(rec);
        pool.register(s);
      } catch (e) {
        log(`  hydrate failed for ${rec.id}: ${e.message}`);
        rec.disabled = true;
        pool.register(Object.assign({ disabled: true }, rec));
      }
    }
    pool.save();
    log(`  pool ready: ${pool.stats().healthy}/${pool.stats().total} healthy, ${live.size} live`);
  }

  // Start listening immediately, then hydrate in the background so the HTTP API
  // is reachable while sessions are still being brought up.
  const server = http.createServer(handler);
  server.hydration = (async () => { try { await hydrateAll(); } catch (e) { log("hydrateAll error: " + e.message); } })();

  // Lazily hydrate on demand (a session may have been added after start).
  async function acquire() {
    const cand = pool.next();
    if (cand) {
      const rec = saved.sessions.find((r) => r.id === cand.id) || cand;
      try { return await ensureLive(rec); } catch { return null; }
    }
    return null;
  }

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    if (url.pathname === "/health") {
      return json(res, cors, 200, {
        status: "ok", prefix, model: `${prefix}/${MODEL}`,
        pool: pool.stats(), live: live.size,
      });
    }
    if (url.pathname === "/pool" && req.method === "GET") {
      return json(res, cors, 200, {
        stats: pool.stats(), live: live.size,
        sessions: pool.sessions.map((s) => ({
          id: s.id, used: s.used || 0, remaining: s.remaining ?? null,
          disabled: !!s.disabled, cooldownUntil: s.cooldownUntil || 0, lastError: s.lastError || null,
        })),
      });
    }
    if (url.pathname === "/pool/reload" && req.method === "POST") {
      const fresh = Pool.load(accountsFile);
      saved.sessions = fresh.sessions;
      pool.sessions = [];
      live.clear();
      await hydrateAll();
      return json(res, cors, 200, { reloaded: true, stats: pool.stats(), live: live.size });
    }
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return json(res, cors, 200, {
        object: "list",
        data: [{ id: `${prefix}/${MODEL}`, object: "model", owned_by: "oxalpha", created: Math.floor(Date.now() / 1000) }],
      });
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let payload;
        try { payload = JSON.parse(body); } catch { return json(res, cors, 400, { error: { message: "invalid JSON" } }); }
        const messages = (payload.messages || []).map((m) => ({
          role: m.role === "developer" ? "system" : m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        const wantStream = !!payload.stream || String(req.headers["accept"] || "").includes("text/event-stream");
        const id = "chatcmpl-" + Math.random().toString(36).slice(2, 12);
        const created = Math.floor(Date.now() / 1000);
        const modelName = `${prefix}/${MODEL}`;

        const tried = new Set();
        let text = null, lastErr = null, session = null;
        const attempts = Math.max(1, pool.size || saved.sessions.length);
        for (let attempt = 0; attempt < attempts; attempt++) {
          const s = await acquire();
          if (!s) break;
          if (tried.has(s.id)) { pool.markUsed(s, s.remaining); continue; }
          tried.add(s.id);
          try {
            const out = await chatViaPage(cdp, s, messages);
            pool.markUsed(s, s.remaining);
            text = out; session = s;
            break;
          } catch (e) {
            lastErr = e;
            if (e.turnstile) pool.markTurnstile(s);
            else pool.markUsed(s, s.remaining);
          }
        }

        if (text == null) {
          const code = lastErr && lastErr.turnstile ? 503 : 502;
          return json(res, cors, code, {
            error: {
              message: (lastErr && lastErr.message) || "no healthy session in pool",
              type: lastErr && lastErr.turnstile ? "turnstile_required" : "upstream_error",
            },
          });
        }

        if (wantStream) {
          res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
          const chunk = (delta, finish = null) => ({
            id, object: "chat.completion.chunk", created, model: modelName,
            choices: [{ index: 0, delta, finish_reason: finish }],
          });
          res.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: "" }))}\n\n`);
          if (text) res.write(`data: ${JSON.stringify(chunk({ content: text }))}\n\n`);
          res.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
          res.write("data: [DONE]\n\n");
          return res.end();
        }

        return json(res, cors, 200, {
          id, object: "chat.completion", created, model: modelName,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          _session: session ? session.id : undefined,
        });
      });
      return;
    }

    return json(res, cors, 404, { error: { message: "not found" } });
  }

  return { server, port, host, prefix, pool, live, browser, cdp, accountsFile };
}

module.exports = { makeAdapter, MODEL };
