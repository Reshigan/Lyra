# syntax=docker/dockerfile:1
#
# One image, two roles (docs/11 §1): `app` serves web+api, `worker` runs the
# same image with MODE=jobs. Build context is the repo root:
#   docker build -f ops/Dockerfile .
#
# ponytail: node:22-slim, not the distroless base docs/11 §1 names. Distroless
# has no shell and no package manager, and the same image has to run
# `pnpm db:migrate` (the `migrate` service in ops/docker-compose.yml).
# Revisit when the on-prem build emits a self-contained bundle.

FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm version is pinned by `packageManager` in the root package.json.
# COREPACK_HOME is shared so the non-root runtime user can resolve pnpm too —
# otherwise `migrate` would try to fetch pnpm at boot and fail on an air-gapped
# host (docs/11 §1).
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install && chmod -R a+rX /opt/corepack

# ponytail: whole-tree copy rather than a per-package manifest list. The list
# went stale the first time a package was added; .dockerignore already strips
# node_modules and build output. Split it back out if install-layer cache
# misses actually start costing build time.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Nothing below is baked in: every value comes from the compose env file.
# RUNTIME=node selects the on-prem adapters (docs/11 §3); MODE picks the role.
ENV RUNTIME=node MODE=app NODE_ENV=production
USER node
EXPOSE 8787

# The Node entrypoint (`RUNTIME=node` adapter) is built by apps/api and is NOT
# in the repo yet — see README §"On-prem status". Until it lands, `app` and
# `worker` will exit; `libsql` and `migrate` work today.
CMD ["node", "apps/api/dist/node.js"]
