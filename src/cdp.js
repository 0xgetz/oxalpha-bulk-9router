"use strict";
// Minimal CDP (Chrome DevTools Protocol) client - zero deps.
//
// Hand-rolled RFC6455 WebSocket so we do not need the `ws` package, plus small
// wrappers for Target / Runtime / Network. Used to drive a real Chromium and
// create one isolated browser context per Ox Alpha session (see src/browser.js)
// and to relay chat calls from inside a live oxalpha.com tab (see src/relay.js).

const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

class CdpSocket {
  constructor() { this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.ready = false; }

  connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const secure = u.protocol === "wss:";
      const port = u.port || (secure ? 443 : 80);
      const key = crypto.randomBytes(16).toString("base64");
      const host = u.hostname;
      const pathq = (u.pathname || "/") + (u.search || "");
      const onConnect = (sock) => {
        this.sock = sock;
        const req =
          `GET ${pathq} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
        sock.write(req);
      };
      const sock = secure
        ? tls.connect({ host, port, servername: host }, () => onConnect(sock))
        : net.connect({ host, port }, () => onConnect(sock));
      this.sock = sock;
      let handshake = "";
      const onData = (chunk) => {
        if (!this.ready) {
          handshake += chunk.toString("binary");
          const idx = handshake.indexOf("\r\n\r\n");
          if (idx === -1) return;
          const rest = handshake.slice(idx + 4);
          if (!/101/.test(handshake.split("\r\n")[0])) return reject(new Error("WS handshake failed: " + handshake.split("\r\n")[0]));
          this.ready = true;
          sock.removeListener("data", onData);
          sock.on("data", (d) => this._onFrame(d));
          if (rest.length) this._onFrame(Buffer.from(rest, "binary"));
          resolve();
        }
      };
      sock.on("data", onData);
      sock.on("error", reject);
    });
  }

  _onFrame(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) { len = this.buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = Number(this.buf.readBigUInt64BE(2)); offset = 10; }
      if (masked) offset += 4;
      if (this.buf.length < offset + len) return;
      const opcode = this.buf[0] & 0x0f;
      const payload = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);
      if (opcode === 0x1) this._handleText(payload.toString("utf8"));
      else if (opcode === 0x8) { try { this.sock.end(); } catch {} }
    }
  }

  _handleText(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const json = Buffer.from(JSON.stringify(payload));
    const header = [];
    header.push(0x81);
    const mask = crypto.randomBytes(4);
    if (json.length < 126) header.push(0x80 | json.length);
    else if (json.length < 65536) { header.push(0x80 | 126); header.push((json.length >> 8) & 0xff, json.length & 0xff); }
    else { header.push(0x80 | 127); const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(json.length)); header.push(...b); }
    header.push(...mask);
    const masked = Buffer.alloc(json.length);
    for (let i = 0; i < json.length; i++) masked[i] = json[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([Buffer.from(header), masked]));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP timeout: " + method)); } }, 120000);
    });
  }

  close() { try { this.sock.end(); } catch {} }

  // --- High-level helpers -------------------------------------------------

  async createBrowserContext() {
    const { browserContextId } = await this.send("Target.createBrowserContext", { disposeOnDetach: false }, null);
    return browserContextId;
  }

  async disposeBrowserContext(browserContextId) {
    try { await this.send("Target.disposeBrowserContext", { browserContextId }, null); } catch {}
  }

  async createTarget(url, browserContextId) {
    const params = { url };
    if (browserContextId) params.browserContextId = browserContextId;
    const { targetId } = await this.send("Target.createTarget", params, null);
    return targetId;
  }

  async closeTarget(targetId) {
    try { await this.send("Target.closeTarget", { targetId }, null); } catch {}
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true }, null);
    await this.send("Runtime.enable", {}, sessionId).catch(() => {});
    await this.send("Network.enable", {}, sessionId).catch(() => {});
    return sessionId;
  }

  async evaluate(sessionId, expression, { awaitPromise = true } = {}) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, sessionId);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      throw new Error(msg);
    }
    return res.result && res.result.value;
  }

  async getCookies(sessionId, urls) {
    const r = await this.send("Network.getCookies", urls ? { urls } : {}, sessionId);
    const map = {};
    for (const c of r.cookies) map[c.name] = c.value;
    return map;
  }
}

// Resolve the ws debugger URL from a CDP http(s) endpoint or return as-is.
async function resolveWsUrl(cdpUrlOrWs) {
  if (cdpUrlOrWs.startsWith("ws://") || cdpUrlOrWs.startsWith("wss://")) return cdpUrlOrWs;
  const base = cdpUrlOrWs.replace(/\/$/, "");
  const v = await (await fetch(`${base}/json/version`)).json();
  return v.webSocketDebuggerUrl || `${base.replace(/^http/, "ws")}/devtools/browser`;
}

module.exports = { CdpSocket, resolveWsUrl };
