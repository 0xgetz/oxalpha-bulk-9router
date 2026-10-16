<div align="center">

<img src="../brand/logo.svg" alt="Ox Alpha bulk — 9Router" width="420">

### Ox Alpha セッションを一括作成 · プール化 · OpenAI 互換で提供 · 9Router へ接続

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blueviolet)](../package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](../LICENSE)
[![9Router](https://img.shields.io/badge/9router-compatible-6e56cf)](https://9router.com)
[![Model](https://img.shields.io/badge/model-z--ai%2Fglm--5.3--flash-8b74e8)](https://oxalpha.com/chat)
[![Status](https://img.shields.io/badge/E2E-verified-36c98f)](#検証)

[English](../README.md) ·
[Indonesia](README.id.md) ·
[中文](README.zh.md) ·
[日本語](README.ja.md) ·
[Español](README.es.md)

</div>

---

## これは何か

**Ox Alpha** は [oxalpha.com/chat](https://oxalpha.com/chat) の無料
「stealth reasoning」チャットです。登録も API キーも不要。モデルは**1つ**だけ：

| 上流 ID | 表示名 | コンテキスト | 備考 |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` | **Ox Alpha**（slug `ox-alpha`） | 100万トークン | SSE、推論有効。Parasail / CoreWeave / DigitalOcean 経由。 |

他のモデル ID は `422 Invalid model` を返します。

このツールキット：

1. Ox Alpha の匿名セッションを**一括作成**（アカウントごとに隔離された
   ブラウザコンテキスト、Cookie は干渉しません）。
2. **プール**化（ラウンドロビン + 自動フェイルオーバー）し、無料枠を
   セッション数に比例して拡張。
3. OpenAI 互換 API（`/v1/chat/completions`、`/v1/models`）を**提供**。
4. [9Router](https://9router.com) に `openai-compatible` プロバイダとして
   **登録**。

npm 依存ゼロ。純粋な Node ≥ 18。Chromium ひとつ。

## なぜブラウザが必要か

Ox Alpha は匿名セッション**と** Cloudflare Turnstile チェックポイントを
クライアント IP に紐づけます。ブラウザで有効な Cookie でも、データセンター
IP からは `HTTP 428 {"code":"turnstile_required"}` が返ります。そのため
すべてのリクエストは**稼働中の `oxalpha.com` ページの内部**から中継され、
ブラウザの出口 IP・Cookie・TLS フィンガープリントを利用します。

- **ローカル Chromium**（既定）：`CHROME_PATH=/usr/bin/chromium`
- **リモート / クラウド Chromium**：`CDP_URL=wss://…/devtools/browser/<id>`

## クイックスタート

```bash
# 0. ブラウザが必要
export CHROME_PATH=/usr/bin/chromium        # あるいは: export CDP_URL=wss://…

# 1.（任意）設定テンプレートをコピー
cp config.example.json config.json

# 2. セッションを5つ作成 -> accounts.json
./run.sh create --count 5 --concurrency 2

# 3. プールを確認
./run.sh list

# 4. OpenAI 互換プールアダプタを起動（既定 :8790）
./run.sh adapter

# 5. 9Router に登録（ローカル :20128 または https://9router.com）
ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=123456 ./run.sh connect
```

あとは通常の OpenAI プロバイダと同じように使えます：

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"oxalpha/z-ai/glm-5.3-flash",
       "messages":[{"role":"user","content":"こんにちは"}]}'
```

## CLI

| コマンド | 説明 |
| --- | --- |
| `node src/cli.js create --count N [--concurrency K]` | N セッションを `accounts.json` に作成 |
| `node src/cli.js list` | プール規模とセッション別の使用/残量を表示 |
| `node src/cli.js adapter` | OpenAI 互換プールアダプタを起動 |
| `node src/cli.js connect` | アダプタを 9Router に登録 |
| `node src/cli.js test "こんにちは"` | 新規セッションで単発チャット |

## アダプタのエンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | チャット（ストリーム + 非ストリーム） |
| `GET` | `/v1/models` | `oxalpha/z-ai/glm-5.3-flash` |
| `GET` | `/health` | 状態 + プール統計 |
| `GET` | `/pool` | セッション別の使用量 / 残量 / 健全性 |
| `POST` | `/pool/reload` | `accounts.json` から再読み込み |

## 検証

稼働中の 9Router（v0.5.99）に対してエンドツーエンドで検証済み：

```
pool ready: 3/3 healthy, 3 live
router models: ["oxalpha/z-ai/glm-5.3-flash"]
router non-stream: 200
router SSE: 200  "X Y Z"  → data: [DONE]
```

`accounts.json` は稼働中の Cookie を含むため **git 管理外**です。

## ライセンス

MIT — [LICENSE](../LICENSE) を参照。
