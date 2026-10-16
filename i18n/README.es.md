<div align="center">

<img src="../brand/logo.svg" alt="Ox Alpha bulk — 9Router" width="420">

### Crear sesiones Ox Alpha en masa · agruparlas · servir OpenAI-compatible · conectar a 9Router

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blueviolet)](../package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](../LICENSE)
[![9Router](https://img.shields.io/badge/9router-compatible-6e56cf)](https://9router.com)
[![Model](https://img.shields.io/badge/model-z--ai%2Fglm--5.3--flash-8b74e8)](https://oxalpha.com/chat)
[![Status](https://img.shields.io/badge/E2E-verificado-36c98f)](#verificación)

[English](../README.md) ·
[Indonesia](README.id.md) ·
[中文](README.zh.md) ·
[日本語](README.ja.md) ·
[Español](README.es.md)

</div>

---

## Qué es esto

**Ox Alpha** es un chat gratuito de "stealth reasoning" en
[oxalpha.com/chat](https://oxalpha.com/chat) — sin registro, sin API key. Sirve
exactamente **un** modelo:

| ID upstream | Nombre | Contexto | Notas |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` | **Ox Alpha** (slug `ox-alpha`) | 1M tokens | SSE, razonamiento activo. Enrutado vía Parasail / CoreWeave / DigitalOcean. |

Cualquier otro id devuelve `422 Invalid model`.

Este toolkit:

1. **Crea en masa** sesiones anónimas de Ox Alpha — un contexto de navegador
   aislado por cuenta, sin solapamiento de cookies.
2. Las **agrupa** en un pool (round-robin + failover automático) para escalar la
   cuota gratuita con el número de sesiones.
3. **Sirve** una API compatible con OpenAI (`/v1/chat/completions`, `/v1/models`).
4. Se **registra** en [9Router](https://9router.com) como proveedor
   `openai-compatible`.

Cero dependencias npm. Node ≥ 18 puro. Un Chromium.

## Por qué hace falta un navegador

Ox Alpha ata la sesión anónima **y** un checkpoint de Cloudflare Turnstile a la
IP del cliente. Las mismas cookies que funcionan en un navegador devuelven
`HTTP 428 {"code":"turnstile_required"}` desde una IP de datacenter. Por eso
cada petición se retransmite **desde dentro de una página `oxalpha.com` viva**,
usando la IP de salida, el cookie jar y el fingerprint TLS del navegador.

- **Chromium local** (por defecto): `CHROME_PATH=/usr/bin/chromium`.
- **Chromium remoto / cloud**: `CDP_URL=wss://…/devtools/browser/<id>`.

## Inicio rápido

```bash
# 0. se requiere un navegador
export CHROME_PATH=/usr/bin/chromium        # o: export CDP_URL=wss://…

# 1. (opcional) copia la plantilla de configuración
cp config.example.json config.json

# 2. crea 5 sesiones -> accounts.json
./run.sh create --count 5 --concurrency 2

# 3. inspecciona el pool
./run.sh list

# 4. ejecuta el adaptador de pool OpenAI-compatible (por defecto :8790)
./run.sh adapter

# 5. regístralo en 9Router (local :20128 o https://9router.com)
ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=123456 ./run.sh connect
```

Luego úsalo como cualquier proveedor OpenAI:

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"oxalpha/z-ai/glm-5.3-flash",
       "messages":[{"role":"user","content":"hola"}]}'
```

## CLI

| Comando | Descripción |
| --- | --- |
| `node src/cli.js create --count N [--concurrency K]` | Crea N sesiones en `accounts.json` |
| `node src/cli.js list` | Muestra el pool y el uso/restante por sesión |
| `node src/cli.js adapter` | Ejecuta el adaptador de pool OpenAI-compatible |
| `node src/cli.js connect` | Registra el adaptador en 9Router |
| `node src/cli.js test "hola"` | Chat puntual con una sesión nueva |

## Endpoints del adaptador

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | Chat (stream + non-stream) |
| `GET` | `/v1/models` | `oxalpha/z-ai/glm-5.3-flash` |
| `GET` | `/health` | Estado + estadísticas del pool |
| `GET` | `/pool` | Uso / restante / salud por sesión |
| `POST` | `/pool/reload` | Recarga desde `accounts.json` |

## Verificación

Probado de extremo a extremo contra un 9Router en ejecución (v0.5.99):

```
pool ready: 3/3 healthy, 3 live
router models: ["oxalpha/z-ai/glm-5.3-flash"]
router non-stream: 200
router SSE: 200  "X Y Z"  → data: [DONE]
```

`accounts.json` contiene cookies de sesión vivas — está **ignorado por git**.

## Licencia

MIT — ver [LICENSE](../LICENSE).
