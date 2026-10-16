"use strict";
// Ox Alpha client + session harvester.
//
// There is no account and no API key. A "session" is the anonymous Laravel
// session the site hands out on first load of /chat:
//   - cookies: `XSRF-TOKEN` (readable) and `ox_alpha_session` (httpOnly)
//   - a per-page CSRF token in <meta name="csrf-token">
// Each session gets its own rate-limit window (X-RateLimit-Limit: 30). Chat is
// served as OpenAI-style SSE from POST /api/chat.
//
// Only one model is accepted: z-ai/glm-5.3-flash (branded "Ox Alpha").

const MODEL = "z-ai/glm-5.3-flash";
const BASE = "https://oxalpha.com";
const CHAT_URL = `${BASE}/chat`;

const { sleep } = require("./browser");

// One harvested anonymous session.
class Session {
  constructor({ cookies, csrf, browserContextId, targetId, cdpSessionId }) {
    this.cookies = cookies;           // { name: value }
    this.csrf = csrf;                 // string
    this.browserContextId = browserContextId || null;
    this.targetId = targetId || null;
    this.cdpSessionId = cdpSessionId || null; // live page session (for relay)
    this.createdAt = Date.now();
    this.used = 0;
    this.remaining = null;             // last seen X-RateLimit-Remaining
    this.cooldownUntil = 0;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get id() {
    if (!this.cookies.ox_alpha_session) return "sess_unknown";
    const h = require("crypto").createHash("sha1")
      .update(this.cookies.ox_alpha_session + "|" + (this.csrf || ""))
      .digest("hex");
    return "sess_" + h.slice(0, 10);
  }

  toJSON() {
    return {
      id: this.id, cookies: this.cookies, csrf: this.csrf, createdAt: this.createdAt,
      used: this.used, remaining: this.remaining,
      browserContextId: this.browserContextId, targetId: this.targetId, cdpSessionId: this.cdpSessionId,
    };
  }
}

// Harvest one fresh anonymous session inside its own isolated browser context.
async function harvestSession(cdp, { timeoutMs = 20000, keepOpen = true, base = BASE } = {}) {
  const browserContextId = await cdp.createBrowserContext();
  const targetId = await cdp.createTarget(`${base}/chat`, browserContextId);
  await sleep(2500);

  const cdpSessionId = await cdp.attach(targetId);
  // Wait until the CSRF meta and both cookies are present.
  const deadline = Date.now() + timeoutMs;
  let csrf = "";
  let cookies = {};
  while (Date.now() < deadline) {
    csrf = await cdp
      .evaluate(cdpSessionId, `(document.querySelector('meta[name="csrf-token"]')||{}).content || ""`)
      .catch(() => "");
    cookies = await cdp.getCookies(cdpSessionId, [`${base}/chat`]).catch(() => ({}));
    if (csrf && cookies.ox_alpha_session) break;
    await sleep(700);
  }
  if (!csrf || !cookies.ox_alpha_session) {
    if (!keepOpen) { await cdp.closeTarget(targetId); await cdp.disposeBrowserContext(browserContextId); }
    throw new Error("harvestSession: session not ready (csrf/cookie missing)");
  }

  const session = new Session({
    cookies: { "XSRF-TOKEN": cookies["XSRF-TOKEN"], ox_alpha_session: cookies.ox_alpha_session },
    csrf, browserContextId, targetId, cdpSessionId,
  });
  if (!keepOpen) {
    await cdp.closeTarget(targetId);
    await cdp.disposeBrowserContext(browserContextId);
    session.targetId = null; session.cdpSessionId = null; session.browserContextId = null;
  }
  return session;
}

// Hydrate a saved session record into a live page: open a fresh isolated browser
// context, inject the saved cookies, load /chat, and attach. This lets a pool
// adapter reuse sessions harvested by a previous process.
async function hydrateSession(cdp, record, { base = BASE, settleMs = 4000 } = {}) {
  const browserContextId = await cdp.createBrowserContext();
  const targetId = await cdp.createTarget("about:blank", browserContextId);
  await sleep(600);
  const cdpSessionId = await cdp.attach(targetId);

  for (const [name, value] of Object.entries(record.cookies || {})) {
    await cdp.send("Network.setCookie", {
      name, value, domain: "oxalpha.com", path: "/",
      secure: true, httpOnly: name === "ox_alpha_session",
    }, cdpSessionId).catch(() => {});
  }
  await cdp.send("Page.navigate", { url: `${base}/chat` }, cdpSessionId).catch(() => {});
  await sleep(settleMs);

  const live = await cdp.getCookies(cdpSessionId, [`${base}/chat`]).catch(() => ({}));
  const csrf = await cdp.evaluate(cdpSessionId, `(document.querySelector('meta[name="csrf-token"]')||{}).content || ""`).catch(() => "");
  if (!csrf || !live.ox_alpha_session) {
    await cdp.closeTarget(targetId);
    await cdp.disposeBrowserContext(browserContextId);
    throw new Error("hydrateSession: page not ready");
  }
  const s = new Session({
    cookies: { "XSRF-TOKEN": live["XSRF-TOKEN"], ox_alpha_session: live.ox_alpha_session },
    csrf, browserContextId, targetId, cdpSessionId,
  });
  s.used = record.used || 0;
  s.remaining = record.remaining ?? null;
  return s;
}

// Build a /api/chat SSE fetch expression that runs inside a page (relay mode).
function chatExpression(session, messages, model = MODEL) {
  return `(async () => {
    const __msgs = ${JSON.stringify(messages)};
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': ${JSON.stringify(session.csrf)} },
      body: JSON.stringify({ model: ${JSON.stringify(model)}, messages: __msgs }),
      credentials: 'include',
    });
    const status = res.status;
    const rl = res.headers.get('x-ratelimit-remaining');
    if (status !== 200) {
      const body = await res.text();
      return JSON.stringify({ status, remaining: rl, error: true, body: body.slice(0, 300) });
    }
    const txt = await res.text();
    let content = '', reasoning = '';
    for (const line of txt.split('\\n')) {
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const d = JSON.parse(p);
        const delta = d.choices && d.choices[0] && d.choices[0].delta;
        if (delta) { content += delta.content || ''; reasoning += delta.reasoning || ''; }
      } catch (e) {}
    }
    return JSON.stringify({ status, remaining: rl, content, reasoning });
  })()`;
}

// Run one chat call through a harvested session's live page (relay mode).
async function chatViaPage(cdp, session, messages, { model = MODEL } = {}) {
  if (!session.cdpSessionId) throw new Error("session has no live page (harvested with keepOpen=false)");
  const raw = await cdp.evaluate(session.cdpSessionId, chatExpression(session, messages, model));
  const out = JSON.parse(raw);
  session.used += 1;
  if (out.remaining != null) session.remaining = Number(out.remaining);
  if (out.error) {
    const err = new Error(`Ox Alpha HTTP ${out.status}: ${(out.body || "").slice(0, 160)}`);
    err.status = out.status;
    if (out.status === 428) err.turnstile = true;
    throw err;
  }
  return out.content || "";
}

module.exports = { Session, harvestSession, hydrateSession, chatViaPage, chatExpression, MODEL, BASE, CHAT_URL, sleep };
