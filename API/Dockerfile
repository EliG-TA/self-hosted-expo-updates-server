# ---- Stage 1: build the vendored @hot-updater/bsdiff fork into a tarball ----
# The fork's dist/ is not committed (see vendor/bsdiff/.gitignore); we build it
# here with tsdown and pack a tarball. The wasm is committed (assets/hdiff.wasm),
# so build-wasm.mjs falls back to it — no Rust toolchain needed in the image.
FROM oven/bun:1-alpine AS bsdiff
WORKDIR /pkg
COPY vendor/bsdiff/ ./
RUN bun install \
 && bun run build \
 && bun pm pack --filename bsdiff.tgz

# ---- Stage 2: runtime ----
FROM oven/bun:1-alpine
RUN apk update && apk add --no-cache tzdata
RUN mkdir -p /home/bun/server/vendor/bsdiff && chown -R bun:bun /home/bun/server
WORKDIR /home/bun/server
USER bun

# Bring in the prebuilt fork tarball first so the file: dependency in
# package.json resolves during `bun install`.
COPY --from=bsdiff --chown=bun:bun /pkg/bsdiff.tgz ./vendor/bsdiff/bsdiff.tgz

COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY --chown=bun:bun . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD bun run src/modules/docker/healthcheck.ts

CMD ["bun", "run", "src/index.ts"]
