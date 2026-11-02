# The image every load check runs in.
#
# Built from `ts/`, as the worker image is, because the sandbox depends on
# `arvo-core` by path. Debian rather than Alpine: `better-sqlite3` and
# `libfaketime` both expect glibc. Every check runs in a container made
# from this, never on the machine that started it.
#
# One stage, dependencies first: each install depends only on its package
# manifests, so a rebuild after a source change reuses them and adds a few
# megabytes, rather than a new copy of every dependency.

FROM node:22.23.1-bookworm-slim

# Lets `pnpm load:*` find and remove its own superseded images, and no other.
LABEL arvo.load="true"

# A toolchain, in case `better-sqlite3` has no prebuilt binary to fetch;
# libfaketime moves SQLite's clock for the clock checks; procps lets a
# check count its own processes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ libfaketime make procps python3 \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s "/usr/lib/$(uname -m)-linux-gnu/faketime/libfaketime.so.1" /usr/local/lib/libfaketime.so.1 \
  && corepack enable && corepack prepare pnpm@11.25.0 --activate \
  && mkdir /arvo && chown node:node /arvo

# Not root from here on: nothing a check does needs it.
USER node
WORKDIR /arvo

COPY --chown=node:node arvo-core/package.json arvo-core/pnpm-lock.yaml arvo-core/pnpm-workspace.yaml ./arvo-core/
WORKDIR /arvo/arvo-core
RUN pnpm install --frozen-lockfile

WORKDIR /arvo
COPY --chown=node:node sandbox/package.json sandbox/pnpm-lock.yaml sandbox/pnpm-workspace.yaml ./sandbox/
WORKDIR /arvo/sandbox
RUN pnpm install --frozen-lockfile

WORKDIR /arvo
COPY --chown=node:node arvo-core/ ./arvo-core/
# The sandbox holds its own copy of arvo-core, taken when it installed,
# before arvo-core was built: the fresh build goes into that copy.
WORKDIR /arvo/arvo-core
RUN pnpm build \
  && cp -R dist "$(readlink -f /arvo/sandbox/node_modules/arvo-core)/"

WORKDIR /arvo
COPY --chown=node:node sandbox/ ./sandbox/
WORKDIR /arvo/sandbox

CMD ["node_modules/.bin/vitest", "run", "--config", "vitest.load.config.ts"]
