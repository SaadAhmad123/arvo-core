# A worker, as a container, so it can be killed rather than asked to stop.
#
# Section 14 needs a worker a test can `docker kill` mid-delivery. A
# process on the host can only be sent a signal, and a signal is the one
# kind of stopping this exercise already handles gracefully — so it
# proves nothing about a worker that simply stops existing.
#
# Built from the two packages together, because the sandbox depends on
# `arvo-core` by path: the build context is `ts/`, not either package.

FROM node:22.23.1-alpine AS build

# pnpm, at the version both packages are pinned to.
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /arvo

# The package manifests first, so a change to source does not reinstall
# every dependency.
COPY arvo-core/package.json arvo-core/pnpm-lock.yaml ./arvo-core/
COPY sandbox/package.json sandbox/pnpm-lock.yaml ./sandbox/

COPY arvo-core/ ./arvo-core/
WORKDIR /arvo/arvo-core
RUN pnpm install --frozen-lockfile && pnpm build

WORKDIR /arvo
COPY sandbox/ ./sandbox/
WORKDIR /arvo/sandbox
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- runtime

FROM node:22.23.1-alpine

# No package manager in the runtime. The sandbox pins none, so corepack
# would fetch whatever is newest the first time it ran — a container that
# downloads its own toolchain at start is one that fails without a
# network and runs something different on two days.
WORKDIR /arvo
# Owned by the user that will run it, so nothing needs root to read it.
COPY --from=build --chown=node:node /arvo /arvo

WORKDIR /arvo/sandbox

# Not root. The image defaults to it and nothing here needs it: the
# worker reads its own tree, opens sockets to Temporal and Postgres, and
# writes nothing outside what it was given.
USER node

# Which worker this container runs, since both are built from one image.
ENV ARVO_WORKER=temporal

# No init process is installed here. Compose supplies one with
# `init: true`, which is Docker's own tini — so a signal reaches the
# worker as a signal and a killed container leaves no children behind.
CMD ["sh", "-c", "node_modules/.bin/tsx src/distributed/${ARVO_WORKER}/worker.ts"]
