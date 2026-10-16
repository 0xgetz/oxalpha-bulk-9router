"use strict";
// Connect the Ox Alpha pool adapter into a 9Router instance.
//
// 9Router API used (v0.5.99, authed by the router password):
//   POST /api/auth/login      { password }                      -> session cookie
//   POST /api/provider-nodes  { name, type, prefix, baseUrl, apiType } -> node
//   POST /api/providers       { provider:<nodeId>, apiKey, name, priority, defaultModel }
//
// GOTCHA: `provider` must be the NODE ID returned above
//         ("openai-compatible-chat-<uuid>"), NOT the prefix, or 9Router replies
//         "Invalid provider".
//
// Target a local instance (:20128) or the hosted hub at https://9router.com by
// setting ROUTER_URL and ROUTER_PASSWORD.

const fs = require("fs");
const path = require("path");
const { MODEL } = require("./oxalpha");

const ROOT = path.resolve(__dirname, "..");
const ROUTER = (process.env.ROUTER_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const ADMIN_PW = process.env.ROUTER_PASSWORD || "123456";
const UA = "oxalpha-bulk-9router/1.0";

function readConfig() {
  const cfgPath = process.env.OXALPHA_CONFIG || path.join(ROOT, "config.json");
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  return {
    prefix: process.env.OXALPHA_PREFIX || cfg.modelPrefix || "oxalpha",
    adapterUrl: process.env.OXALPHA_ADAPTER_URL || cfg.adapterUrl || `http://127.0.0.1:${cfg.port || 8790}/v1`,
  };
}

function cookieFrom(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function login() {
  const res = await fetch(`${ROUTER}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ password: ADMIN_PW }),
  });
  if (!res.ok) throw new Error(`9Router login failed: HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error("9Router login: no Set-Cookie returned");
  return cookie;
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${ROUTER}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, "User-Agent": UA },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`9Router ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    e.body = data;
    throw e;
  }
  return data;
}

async function main() {
  const { prefix, adapterUrl } = readConfig();
  console.log(`Connecting Ox Alpha pool adapter to 9Router at ${ROUTER}`);
  console.log(`  adapter baseUrl: ${adapterUrl}`);
  console.log(`  model prefix:    ${prefix}`);

  const cookie = await login();
  console.log("  logged in to 9Router");

  let nodeId = null;
  try {
    const nodes = await api(cookie, "GET", "/api/provider-nodes");
    const list = Array.isArray(nodes) ? nodes : (nodes.nodes || nodes.data || []);
    const found = list.find((n) => n.prefix === prefix && n.type && n.type.includes("openai"));
    if (found) nodeId = found.id;
  } catch { /* ignore */ }

  if (!nodeId) {
    const node = await api(cookie, "POST", "/api/provider-nodes", {
      type: "openai-compatible",
      apiType: "chat",
      prefix,
      name: "Ox Alpha",
      baseUrl: adapterUrl,
    });
    nodeId = node.id || (node.node && node.node.id) || (node.data && node.data.id);
    console.log("  created provider node:", nodeId);
  } else {
    console.log("  reusing provider node:", nodeId);
  }

  const provider = await api(cookie, "POST", "/api/providers", {
    provider: nodeId,
    apiKey: process.env.OXALPHA_ADAPTER_KEY || "oxalpha-local",
    name: "Ox Alpha",
    priority: 1,
    defaultModel: `${prefix}/${MODEL}`,
    allowOverwrite: true,
  });
  console.log("  registered provider:", provider.id || JSON.stringify(provider).slice(0, 120));

  // Mint a client key for the router's own /v1 gateway.
  let keyInfo = null;
  try {
    keyInfo = await api(cookie, "POST", "/api/keys", { name: "oxalpha" });
  } catch (e) { console.log("  (key mint skipped:", e.message.slice(0, 80), ")"); }

  console.log("\nDone. 9Router should now expose:");
  console.log(`  ${prefix}/${MODEL}`);
  if (keyInfo) console.log("  router client key:", keyInfo.key || keyInfo.apiKey || JSON.stringify(keyInfo).slice(0, 80));
}

if (require.main === module) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

module.exports = { main, login, api, readConfig };
