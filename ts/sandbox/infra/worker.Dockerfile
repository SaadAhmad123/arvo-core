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
RUN cd arvo-core && pnpm install --frozen-lockfile && pnpm build

COPY sandbox/ ./sandbox/
RUN cd sandbox && pnpm install --frozen-lockfile

# ---------------------------------------------------------------- runtime

FROM node:22.23.1-alpine

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /arvo
COPY --from=build /arvo /arvo

WORKDIR /arvo/sandbox

# Which worker this container runs, since both are built from one image.
ENV ARVO_WORKER=temporal

# No init process is installed here. Compose supplies one with
# `init: true`, which is Docker's own tini — so a signal reaches the
# worker as a signal and a killed container leaves no children behind.
CMD ["sh", "-c", "pnpm tsx src/distributed/${ARVO_WORKER}/worker.ts"]
