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

# The image builds and runs on pnpm; the npm the base image bundles is never
# invoked, and it is where every JS CVE in this image lives (its own vendored
# tar, sigstore, brace-expansion). Deleting it ships nothing we don't use.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# ponytail: whole-tree copy rather than a per-package manifest list. The list
# went stale the first time a package was added; .dockerignore already strips
# node_modules and build output. Split it back out if install-layer cache
# misses actually start costing build time.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# The R2 stand-in writes here (FILES_DIR). Created before USER drops so the
# named volume inherits node's ownership at first mount.
RUN mkdir -p /var/lib/lyra/files && chown -R node:node /var/lib/lyra

# Nothing below is baked in: every value comes from the compose env file.
# RUNTIME=node selects the on-prem adapters (docs/11 §3); MODE picks the role.
ENV RUNTIME=node MODE=app NODE_ENV=production
USER node
EXPOSE 8787

# apps/api/src/node.ts, run through tsx.
#
# ponytail: no bundle step. tsx pays a one-off transpile at boot and keeps the
# image honest — the container runs the same source the tests run. Swap for a
# real `pnpm --filter @lyra/api build` + `node dist/node.js` when cold-start
# time or a distroless base actually matters.
CMD ["pnpm", "--filter", "@lyra/api", "start"]
