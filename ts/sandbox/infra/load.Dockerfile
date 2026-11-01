# The image every load check runs in.
#
# Built from `ts/`, as the worker image is, because the sandbox depends on
# `arvo-core` by path. Debian rather than Alpine: `better-sqlite3` and
# `libfaketime` both expect glibc. Every check runs in a container made
# from this, never on the machine that started it.

FROM node:22.23.1-bookworm-slim AS build

# A toolchain, in case `better-sqlite3` has no prebuilt binary to fetch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /arvo
COPY arvo-core/ ./arvo-core/
WORKDIR /arvo/arvo-core
RUN pnpm install --frozen-lockfile && pnpm build

WORKDIR /arvo
COPY sandbox/ ./sandbox/
WORKDIR /arvo/sandbox
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- runtime

FROM node:22.23.1-bookworm-slim

# libfaketime moves SQLite's clock for the clock checks; procps lets a
# check count its own processes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libfaketime procps \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s "/usr/lib/$(uname -m)-linux-gnu/faketime/libfaketime.so.1" /usr/local/lib/libfaketime.so.1

WORKDIR /arvo
COPY --from=build --chown=node:node /arvo /arvo
WORKDIR /arvo/sandbox

# Not root: nothing a check does needs it.
USER node

CMD ["node_modules/.bin/vitest", "run", "--config", "vitest.load.config.ts"]
