"use strict";
// Browser manager.
//
// Connects to a Chromium over CDP. Three ways to get one, in priority order:
//   1. CDP_URL / --cdp  : attach to an already-running remote browser
//                         (e.g. a Browser Use cloud browser: wss://…/devtools/browser/<id>)
//   2. CHROME_PATH / --chrome : launch a local Chromium with --remote-debugging-port
//   3. auto-detect a local Chrome/Chromium on this machine
//
// Each Ox Alpha "account" is harvested in its own isolated browser context
// (Target.createBrowserContext), so cookies/storage never leak between accounts.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CdpSocket, resolveWsUrl } = require("./cdp");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findLocalChrome() {
  const explicit = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable", "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

class BrowserManager {
  constructor({ cdpUrl, chromePath, port = 9222, headless = true, userDataDir } = {}) {
    this.cdpUrl = cdpUrl || process.env.CDP_URL || process.env.BU_CDP_WS || process.env.BU_CDP_URL || null;
    this.chromePath = chromePath || findLocalChrome();
    this.port = port;
    this.headless = headless;
    this.userDataDir = userDataDir || path.join(os.tmpdir(), `oxalpha-chrome-${Date.now()}`);
    this.proc = null;
    this.cdp = null;
  }

  async connect() {
    if (this.cdp) return this.cdp;

    if (!this.cdpUrl) {
      await this._launch();
      this.cdpUrl = `http://127.0.0.1:${this.port}`;
    }
    const ws = await resolveWsUrl(this.cdpUrl);
    const cdp = new CdpSocket();
    await cdp.connect(ws);
    // sanity: talk to the target domain
    await cdp.send("Target.getTargets", {});
    this.cdp = cdp;
    return cdp;
  }

  async _launch() {
    if (!this.chromePath) {
      throw new Error(
        "No Chrome/Chromium found and no CDP_URL set. Set CDP_URL to a remote browser " +
        "or CHROME_PATH to a local Chromium binary."
      );
    }
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu",
      "--disable-dev-shm-usage", "--no-sandbox",
      "--window-size=1280,900",
    ];
    if (this.headless) args.push("--headless=new");
    this.proc = spawn(this.chromePath, args, { stdio: "ignore", detached: true });
    this.proc.unref();

    // Wait for the debug port to come up.
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) return;
      } catch {}
      await sleep(500);
    }
    throw new Error("Chromium did not expose its debugging port in time");
  }

  async close() {
    if (this.cdp) { try { this.cdp.close(); } catch {} this.cdp = null; }
    if (this.proc) {
      // Chrome ignores a parent-directed kill when detached; signal the group.
      try { process.kill(-this.proc.pid, "SIGKILL"); } catch {}
      try { this.proc.kill("SIGKILL"); } catch {}
      this.proc = null;
    }
  }
}

module.exports = { BrowserManager, findLocalChrome, sleep };
