#!/usr/bin/env node
"use strict";
// Ox Alpha bulk -> 9Router CLI.
//
//   node src/cli.js create  --count 5            harvest N anonymous sessions into accounts.json
//   node src/cli.js list                          show the pool
//   node src/cli.js adapter                       run the OpenAI-compatible pool adapter
//   node src/cli.js connect                       register the adapter into 9Router
//   node src/cli.js test "hello"                  one-off chat through a pooled session
//
// Browser: CDP_URL (remote) or CHROME_PATH (local). Env:
//   ROUTER_URL / ROUTER_PASSWORD   for `connect` (local :20128 or https://9router.com)

const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config.json");

function cfg() {
  return fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, "utf8")) : {};
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function cmdCreate() {
  const { provision } = require("./provision");
  const c = cfg();
  const count = Number(arg("count", 1));
  const accountsFile = path.resolve(ROOT, process.env.OXALPHA_ACCOUNTS || c.accountsFile || "accounts.json");
  console.log(`Harvesting ${count} Ox Alpha session(s)...`);
  const { browser, results } = await provision({
    count,
    file: accountsFile,
    cdpUrl: process.env.CDP_URL || c.cdpUrl,
    chromePath: process.env.CHROME_PATH || c.chromePath,
    concurrency: Number(arg("concurrency", c.concurrency || 2)),
    headless: c.headless !== false,
    keepOpen: true,
  });
  console.log(`\nDone: ${results.created} created, ${results.failed} failed -> ${accountsFile}`);
  // keep the browser alive so relay works; exit anyway (sessions persist in file,
  // but live-page relay needs a running adapter that owns the browser).
  await browser.close();
}

async function cmdList() {
  const { Pool } = require("./pool");
  const c = cfg();
  const accountsFile = path.resolve(ROOT, process.env.OXALPHA_ACCOUNTS || c.accountsFile || "accounts.json");
  const pool = Pool.load(accountsFile);
  console.log(`Accounts file: ${accountsFile}`);
  console.log(`Total: ${pool.stats().total}  Healthy: ${pool.stats().healthy}  Unhealthy: ${pool.stats().unhealthy}`);
  for (const s of pool.sessions) {
    console.log(`  ${s.id}  used=${s.used || 0}  remaining=${s.remaining ?? "?"}  ${s.disabled ? "DISABLED" : ""}`);
  }
}

async function cmdAdapter() {
  const { makeAdapter } = require("./adapter");
  const c = cfg();
  const a = await makeAdapter({
    configFile: CONFIG,
    cdpUrl: process.env.CDP_URL || c.cdpUrl,
    chromePath: process.env.CHROME_PATH || c.chromePath,
  });
  a.server.listen(a.port, a.host, () => {
    console.log(`Ox Alpha pool adapter on http://${a.host}:${a.port} (prefix="${a.prefix}", model=${a.prefix}/z-ai/glm-5.3-flash)`);
    console.log(`  accounts: ${a.accountsFile}  pool=${a.pool.stats().total}`);
  });
}

async function cmdConnect() {
  const { main } = require("./connect-9router");
  return main();
}

async function cmdTest(prompt) {
  const { BrowserManager } = require("./browser");
  const { harvestSession, chatViaPage } = require("./oxalpha");
  const c = cfg();
  // A one-off test cannot reuse live pages from a previous process; it verifies
  // connectivity by harvesting a fresh session instead.
  const b = new BrowserManager({ cdpUrl: process.env.CDP_URL || c.cdpUrl, chromePath: process.env.CHROME_PATH || c.chromePath });
  await b.connect();
  const s = await harvestSession(b.cdp);
  const out = await chatViaPage(b.cdp, s, [{ role: "user", content: prompt || "hello" }]);
  console.log("reply:", out);
  await b.close();
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "create": return cmdCreate();
    case "list": return cmdList();
    case "adapter": return cmdAdapter();
    case "connect": return cmdConnect();
    case "test": return cmdTest(process.argv.slice(3).join(" "));
    default:
      console.log(`Ox Alpha bulk -> 9Router

Usage:
  node src/cli.js create --count 5 [--concurrency 2]   harvest sessions -> accounts.json
  node src/cli.js list                                 show the pool
  node src/cli.js adapter                              run the pool adapter (default :8790)
  node src/cli.js connect                              register into 9Router
  node src/cli.js test "hello"                         one-off chat (fresh session)

Env:
  CDP_URL / CHROME_PATH   remote CDP endpoint or local Chromium
  ROUTER_URL              9Router base (default http://127.0.0.1:20128)
  ROUTER_PASSWORD         9Router admin password (default 123456)
  PORT / HOST             adapter bind (default 8790 / 127.0.0.1)
`);
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
