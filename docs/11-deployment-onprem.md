# 11 — Deployment: On-Prem (Docker + internal LLM)

For regulated tenants requiring full data residency: the same application,
packaged as a Docker Compose stack (Kubernetes Helm chart derives from it,
v1.1), with an **internal LLM** so no data leaves the estate.

## 1. Stack (ops/docker-compose.yml)

| Service | Image | Role |
|---|---|---|
| `app` | node:22 distroless, our build | web+api+agents (Node adapters for RR7/Hono) |
| `worker` | same image, `MODE=jobs` | queues consumer, schedulers, workflows-inline |
| `libsql` | ghcr.io/tursodatabase/libsql-server | SQLite server (same Drizzle schema as D1) |
| `redis` | redis:7 | BullMQ queues, rate counters, realtime pubsub |
| `minio` | minio/minio | R2-compatible object store |
| `qdrant` | qdrant/qdrant | vectors (Vectorize replacement) |
| `llm` | vllm/vllm-openai **or** ollama | internal model, OpenAI-compatible API |
| `embed` | TEI (text-embeddings-inference) | bge-m3 embeddings (ar/en) |
| `render` | browserless/chromium | PDF board packs, page snapshots |
| `caddy` | caddy:2 | TLS, reverse proxy, forward-auth (OIDC) |
| `otel` (opt) | grafana/otel-lgtm | logs/metrics/traces single-node |

Volumes: `libsql-data`, `minio-data`, `qdrant-data`, `models`. Air-gapped
install supported: image bundle + model weights delivered offline; licence
file checked locally (signed JWT, grace period, no phone-home required).

## 2. Internal LLM guidance

- Reference model tiers (tenant hardware decides):
  - `fast`: Llama 3.1 8B Instruct (or Qwen2.5-7B) — extraction/classify.
  - `standard`: Llama 3.3 70B AWQ on 2×A100/H100, or Qwen2.5-32B on 1×A100.
  - `reasoning`: same 70B with extended context; on-prem briefs cap at 32k ctx.
  - Arabic quality: evaluate Qwen2.5 / Jais-family per tenant; the model-gateway
    eval suite (packages/model-gateway/evals, ar+en sets) must pass thresholds
    before a model is approved for a tier — recorded in the tenant's policy.
- vLLM flags: `--served-model-name lyra-standard --max-model-len 32768
  --gpu-memory-utilization 0.92`; Ollama acceptable for pilots/CPU-only demos.
- model-gateway provider `openai-compat` points at `http://llm:8000/v1`;
  tier→model mapping in tenant policy; budget metering identical to cloud.

## 3. Capability flags (env)

`RUNTIME=node` switches adapters: Queues→BullMQ, DO AgentRoom→Redis-backed
room service (same interface, packages/core/rooms), Workflows→inline durable
jobs (BullMQ + state table `core_jobs`), Vectorize→Qdrant, R2→MinIO S3 API,
Browser Rendering→`render` service, Analytics Engine→OTEL metrics, AI
Gateway→direct provider with local logging. Feature parity matrix in §6.

## 4. Install & operate

```
lyra onprem init        # generates .env, secrets, licence check
docker compose pull && docker compose up -d
lyra onprem migrate     # drizzle migrations against libsql
lyra onprem seed --tenant demo
lyra onprem smoke       # runs J-C1/J-O1/J-E1 synthetic journeys
```
Upgrades: pull tag → `migrate` → rolling restart (app is stateless).
Backups: `libsql` snapshot + MinIO mirror script (cron container) to tenant
NAS; restore runbook R-11. Monitoring: bundled Grafana dashboards (queue
depth, LLM latency/tokens, journey funnels).

## 5. Security posture

All services on an internal network; only caddy exposed. OIDC to tenant IdP
(Keycloak/AzureAD). Disk encryption is tenant responsibility (documented
prereq). Same RBAC/audit/consent code paths as cloud — compliance features do
not fork. Optional FIPS-mode base images (v1.1).

## 6. Parity matrix (v1)

| Capability | Cloud | On-prem |
|---|---|---|
| All five modules | ✅ | ✅ |
| WhatsApp channel | ✅ | ✅ (BSP still external — flag if disallowed) |
| Voice channel | v1.1 | v1.1 |
| Model tiers | fast/standard/reasoning (frontier) | internal models (32k ctx cap) |
| AEO monitor (external sampling) | ✅ | ⚠ requires egress allowlist |
| SCOUT external crawling | ✅ | ⚠ egress allowlist or feed-import mode |
| Browser PDF render | ✅ | ✅ |
| Multi-region DR | ✅ | tenant infra |
| EAS mobile OTA | ✅ | enterprise MDM distribution |

Any ⚠ path has a degraded mode that is explicit in UI (GuardrailNotice), never
a silent failure.
