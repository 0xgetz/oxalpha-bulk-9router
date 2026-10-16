<div align="center">

<img src="../brand/logo.svg" alt="Ox Alpha bulk — 9Router" width="420">

### 批量创建 Ox Alpha 会话 · 组成连接池 · 提供 OpenAI 兼容接口 · 接入 9Router

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blueviolet)](../package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](../LICENSE)
[![9Router](https://img.shields.io/badge/9router-compatible-6e56cf)](https://9router.com)
[![Model](https://img.shields.io/badge/model-z--ai%2Fglm--5.3--flash-8b74e8)](https://oxalpha.com/chat)
[![Status](https://img.shields.io/badge/E2E-verified-36c98f)](#验证)

[English](../README.md) ·
[Indonesia](README.id.md) ·
[中文](README.zh.md) ·
[日本語](README.ja.md) ·
[Español](README.es.md)

</div>

---

## 这是什么

**Ox Alpha** 是 [oxalpha.com/chat](https://oxalpha.com/chat) 上的免费
"stealth reasoning" 聊天服务 —— 无需注册，无需 API key。仅提供**一个**模型：

| 上游 ID | 显示名称 | 上下文 | 说明 |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` | **Ox Alpha**（slug `ox-alpha`） | 100 万 token | SSE，启用推理。经 Parasail / CoreWeave / DigitalOcean 路由。 |

其它模型 ID 会返回 `422 Invalid model`。

本工具集：

1. **批量创建** Ox Alpha 匿名会话 —— 每个账号一个隔离的浏览器上下文，Cookie 互不干扰。
2. **连接池**管理（轮询 + 自动故障转移），免费额度随会话数量线性增长。
3. **提供** OpenAI 兼容 API（`/v1/chat/completions`、`/v1/models`）。
4. **注册**到 [9Router](https://9router.com)，作为 `openai-compatible` 提供商。

零 npm 依赖。纯 Node ≥ 18。一个 Chromium。

## 为什么需要浏览器

Ox Alpha 把匿名会话**和** Cloudflare Turnstile 校验绑定到客户端 IP。
在浏览器里可用的 Cookie，从机房 IP 请求却会返回
`HTTP 428 {"code":"turnstile_required"}`。因此每个请求都从**一个活跃的
`oxalpha.com` 页面内部**转发，借用浏览器的出口 IP、Cookie 与 TLS 指纹。

- **本地 Chromium**（默认）：`CHROME_PATH=/usr/bin/chromium`
- **远程 / 云端 Chromium**：`CDP_URL=wss://…/devtools/browser/<id>`

## 快速开始

```bash
# 0. 需要一个浏览器
export CHROME_PATH=/usr/bin/chromium        # 或: export CDP_URL=wss://…

# 1. （可选）复制配置模板
cp config.example.json config.json

# 2. 批量创建 5 个会话 -> accounts.json
./run.sh create --count 5 --concurrency 2

# 3. 查看连接池
./run.sh list

# 4. 启动 OpenAI 兼容适配器（默认 :8790）
./run.sh adapter

# 5. 注册到 9Router（本地 :20128 或 https://9router.com）
ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=123456 ./run.sh connect
```

然后像普通 OpenAI 提供商一样使用：

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"oxalpha/z-ai/glm-5.3-flash",
       "messages":[{"role":"user","content":"你好"}]}'
```

## CLI

| 命令 | 说明 |
| --- | --- |
| `node src/cli.js create --count N [--concurrency K]` | 创建 N 个会话到 `accounts.json` |
| `node src/cli.js list` | 查看池大小与每个会话用量/剩余 |
| `node src/cli.js adapter` | 运行 OpenAI 兼容连接池适配器 |
| `node src/cli.js connect` | 注册到 9Router |
| `node src/cli.js test "你好"` | 用新会话测试一次对话 |

## 适配器端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | 对话（流式 + 非流式） |
| `GET` | `/v1/models` | `oxalpha/z-ai/glm-5.3-flash` |
| `GET` | `/health` | 状态 + 池统计 |
| `GET` | `/pool` | 每个会话的用量 / 剩余 / 健康状态 |
| `POST` | `/pool/reload` | 从 `accounts.json` 重新加载 |

## 验证

已对一个运行中的 9Router（v0.5.99）完成端到端测试：

```
pool ready: 3/3 healthy, 3 live
router models: ["oxalpha/z-ai/glm-5.3-flash"]
router non-stream: 200
router SSE: 200  "X Y Z"  → data: [DONE]
```

`accounts.json` 保存着活跃会话 Cookie —— 已被 **git 忽略**。

## 许可证

MIT —— 见 [LICENSE](../LICENSE)。
