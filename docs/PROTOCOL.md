# Protocol reference

Two wire protocols matter here: the **Ox Alpha** upstream and the **9Router**
admin/gateway API.

---

## 1. Ox Alpha

Base: `https://oxalpha.com`. No account, no API key.

### 1.1 Session bootstrap

```
GET /chat               -> HTML page
```

Returns cookies:

| Cookie            | HttpOnly | Notes                          |
| ----------------- | -------- | ------------------------------ |
| `XSRF-TOKEN`      | no       | Laravel CSRF cookie            |
| `ox_alpha_session`| yes      | Session id                     |

and embeds a page token:

```html
<meta name="csrf-token" content="…">
```

The client script also exposes the model catalogue:

```html
<script>window.__CHAT_MODELS__ = [{"id":"z-ai/glm-5.3-flash","slug":"ox-alpha","name":"Ox Alpha","color":"#6e56cf"}];</script>
```

### 1.2 Chat

```
POST /api/chat
Content-Type: application/json
X-CSRF-TOKEN: <meta csrf-token>
Cookie: XSRF-TOKEN=…; ox_alpha_session=…

{"model":"z-ai/glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}
```

Response: Server-Sent Events.

```
data: {"id":"gen-…","object":"chat.completion.chunk","created":…,
       "model":"z-ai/glm-5.3-flash","provider":"CoreWeave",
       "choices":[{"index":0,"delta":{"content":"","reasoning":"…"},"finish_reason":null}]}
…
data: [DONE]
```

- Assistant text: `choices[0].delta.content`
- Reasoning/thinking: `choices[0].delta.reasoning`
- Only `z-ai/glm-5.3-flash` is accepted; any other id → `422 {"error":"Invalid model"}`.

### 1.3 Limits

| Header                  | Meaning                          |
| ----------------------- | -------------------------------- |
| `X-RateLimit-Limit`     | 30 requests per session window   |
| `X-RateLimit-Remaining` | decrements per message           |

After the window / enough activity a **Cloudflare Turnstile** checkpoint is
enforced:

```
HTTP 428
{"error":"Please complete the quick verification to continue.",
 "code":"turnstile_required","checkpoint":3,"messages_today":2}
```

A fresh anonymous session (new cookie jar) resets it. The session is also bound
to the client IP, so requests must originate from a browser.

---

## 2. 9Router

Base: `http://127.0.0.1:20128` (local) or `https://9router.com` (hosted).
Authenticated with the router admin password.

```
POST /api/auth/login      {"password":"…"}                       -> Set-Cookie
POST /api/provider-nodes  {"type":"openai-compatible",
                           "apiType":"chat","prefix":"oxalpha",
                           "name":"Ox Alpha","baseUrl":"http://127.0.0.1:8790/v1"}
                                                                 -> {"node":{"id":"openai-compatible-chat-<uuid>"}}
POST /api/providers       {"provider":"<NODE_ID>","apiKey":"…","name":"Ox Alpha",
                           "priority":1,"defaultModel":"oxalpha/z-ai/glm-5.3-flash"}
                                                                 -> {"connection":{…}}
POST /api/keys            {"name":"oxalpha"}                     -> {"key":"sk-…"}
```

**Gotcha:** `provider` in `POST /api/providers` must be the **node id**
(`openai-compatible-chat-<uuid>`), not the prefix, or 9Router replies
`Invalid provider`.

Gateway (client-facing, needs the `sk-…` key):

```
GET  /v1/models
POST /v1/chat/completions     (stream + non-stream)
Authorization: Bearer sk-…
```

model id exposed: `oxalpha/z-ai/glm-5.3-flash`.
