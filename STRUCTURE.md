# Project structure

```
oxalpha-bulk-9router/
│
├── src/
│   ├── cdp.js              Zero-dependency Chrome DevTools Protocol client
│   │                       (hand-rolled RFC6455 WebSocket + Target/Runtime/Network)
│   ├── browser.js          BrowserManager: attach to a remote CDP endpoint or
│   │                       launch a local Chromium; isolated browser contexts
│   ├── oxalpha.js          Session model + harvester + hydration + chat relay
│   ├── pool.js             Account pool: persistence, round-robin, failover
│   ├── provision.js        Bulk provisioning loop (N sessions, N workers)
│   ├── adapter.js          OpenAI-compatible HTTP server over the pool
│   ├── connect-9router.js  9Router registration (provider-node + provider + key)
│   └── cli.js              create | list | adapter | connect | test
│
├── docs/
│   └── PROTOCOL.md         Upstream API + 9Router wire reference
│
├── brand/
│   ├── logo.svg            Wordmark
│   └── icon.svg            Square app icon
│
├── i18n/
│   ├── README.id.md        Bahasa Indonesia
│   ├── README.zh.md        简体中文
│   ├── README.ja.md        日本語
│   └── README.es.md        Español
│
├── README.md               English (primary)
├── STRUCTURE.md            This file
├── LICENSE                 MIT
├── package.json
├── config.json             Active configuration
├── config.example.json     Configuration template
└── run.sh                  Convenience launcher
```

## Runtime flow

```
   ┌────────────┐   create    ┌──────────────────────────────────────┐
   │  run.sh    │────────────▶│  provision.js                        │
   │  cli.js    │             │   └─ for each account:               │
   └────────────┘             │        browser.js  new browser ctx   │
                              │        oxalpha.js  GET /chat         │
                              │                    harvest cookies   │
                              │        pool.js     append + save     │
                              └───────────────┬──────────────────────┘
                                              │ accounts.json
                                              ▼
   ┌────────────┐   adapter   ┌──────────────────────────────────────┐
   │  run.sh    │────────────▶│  adapter.js  (:8790)                 │
   │  cli.js    │             │   └─ hydrate each session into a     │
   └────────────┘             │      live oxalpha.com page (CDP)     │
                              │   relay each request via that page   │
                              │   round-robin + failover (pool.js)   │
                              └───────────────┬──────────────────────┘
                                              │ OpenAI-compatible /v1
                                              ▼
                              ┌──────────────────────────────────────┐
                              │  connect-9router.js                  │
                              │   POST /api/provider-nodes           │
                              │   POST /api/providers                │
                              │   POST /api/keys                     │
                              └───────────────┬──────────────────────┘
                                              │
                                              ▼
                              ┌──────────────────────────────────────┐
                              │  9Router  (localhost:20128 | 9router.com)
                              │   /v1/chat/completions               │
                              │   model: oxalpha/z-ai/glm-5.3-flash  │
                              └──────────────────────────────────────┘
```

## Why a browser?

Ox Alpha ties the anonymous session **and** a Cloudflare Turnstile checkpoint to
the client IP. The same cookies that work from a real browser return
`HTTP 428 {"code":"turnstile_required"}` from a datacenter host. Every request is
therefore relayed from inside a live `oxalpha.com` page, riding the browser's
egress IP, cookie jar and TLS fingerprint. See `docs/PROTOCOL.md`.
