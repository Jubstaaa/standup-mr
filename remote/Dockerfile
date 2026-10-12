# The remote server runs straight from TypeScript under Bun and imports the
# package's own src/ and mcp/, so the image carries the repo minus everything
# the npm package or the tests need. Build from the repository root:
#   docker build -f remote/Dockerfile .
FROM oven/bun:1.3.13
WORKDIR /app

# Install against the committed lockfile first so the layer caches across
# source edits. Both package.jsons are needed for Bun to resolve the workspace.
COPY package.json bun.lock ./
COPY remote/package.json remote/package.json
RUN bun install --frozen-lockfile --production

# skills/ is read at runtime by get_note_instructions; assets/ holds the icon.
COPY src src
COPY mcp mcp
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
