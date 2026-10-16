"use strict";
// Bulk provisioning: create N Ox Alpha sessions and add them to the pool.
//
// Each account is harvested in its own isolated browser context (own cookie jar)
// from the browser's egress IP. Sessions are then usable both directly (via the
// relay page) and pooled for round-robin load balancing.

const { BrowserManager, sleep } = require("./browser");
const { harvestSession } = require("./oxalpha");
const { Pool } = require("./pool");

async function provision({
  count = 1,
  file,
  cdpUrl,
  chromePath,
  headless = true,
  concurrency = 2,
  delayMs = 400,
  keepOpen = true,
  base,
  onAccount,
  log = console.log,
} = {}) {
  const browser = new BrowserManager({ cdpUrl, chromePath, headless });
  await browser.connect();
  const cdp = browser.cdp;

  const pool = file ? Pool.load(file) : new Pool({ sessions: [] });
  const results = { created: 0, failed: 0, sessions: [] };

  const queue = Array.from({ length: count }, (_, i) => i + 1);
  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());

  async function worker() {
    while (queue.length) {
      const n = queue.shift();
      try {
        const s = await harvestSession(cdp, { keepOpen, base });
        const rec = s.toJSON();
        pool.add(s);
        results.created += 1;
        results.sessions.push(rec);
        if (onAccount) onAccount(rec);
        log(`  [${n}/${count}] ok  ${rec.id}  (cookie len ${s.cookieHeader().length})`);
      } catch (e) {
        results.failed += 1;
        log(`  [${n}/${count}] fail ${e.message}`);
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  await Promise.all(workers);
  if (file) pool.save();

  return { pool, browser, results };
}

module.exports = { provision };
