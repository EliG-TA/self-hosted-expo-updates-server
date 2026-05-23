FROM oven/bun:1-alpine
RUN apk update && apk add --no-cache tzdata
RUN mkdir -p /home/bun/server && chown -R bun:bun /home/bun/server
WORKDIR /home/bun/server
USER bun
COPY --chown=bun:bun package.json bun.lock* ./

RUN bun install --frozen-lockfile

COPY --chown=bun:bun . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD bun run src/modules/docker/healthcheck.ts

CMD ["bun", "run", "src/index.ts"]
