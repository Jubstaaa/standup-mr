# The remote server runs straight from TypeScript under Bun and imports the
# package's own src/ (never mcp/, which is the local stdio server), so the
# image carries the repo minus everything the npm package or the tests need. Build from the repository root:
#   docker build -f remote/Dockerfile .
# Pinned by digest so a re-pushed tag cannot change what ships; Dependabot
# (docker, /remote) bumps tag and digest together.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d

# Debian security fixes land on every build instead of waiting for upstream to
# rebuild the pinned base; CI scans the result for fixable HIGH/CRITICAL CVEs.
RUN apt-get update \
    && apt-get -y --no-install-recommends upgrade \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install against the committed lockfile first so the layer caches across
# source edits. Both package.jsons are needed for Bun to resolve the workspace.
COPY package.json bun.lock ./
COPY remote/package.json remote/package.json
RUN bun install --frozen-lockfile --production

# skills/ is read at runtime by get_note_instructions; assets/ holds the icon.
COPY src src
COPY skills skills
COPY assets assets
COPY remote/src remote/src

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/standup.db

RUN mkdir -p /data && chown bun:bun /data
USER bun

EXPOSE 3000
CMD ["bun", "remote/src/index.ts"]
