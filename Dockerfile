# Railway builds this image on every push to main. The Bun version matches the
# one the team and CI run, so a deploy never meets a runtime nobody tested.
FROM oven/bun:1.4.4-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

# Railway injects PORT; the volume for Patricia's state is mounted at /data.
EXPOSE 3000
CMD ["bun", "src/main.ts"]
