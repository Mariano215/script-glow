# Script Glow app. See "Run with Docker" in README.md.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY stubs stubs
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY stubs stubs
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY scripts scripts
COPY --from=build /app/dist dist
# 0.0.0.0 so the published port reaches the app. Projects, settings and keys live on the /data volume.
ENV HOST=0.0.0.0 SCRIPT_GLOW_HOME=/data SCRIPT_GLOW_SECRETS=/data/secrets.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3001
# Every service runs at its 127.0.0.1 default in Docker, so write those settings when none exist.
# That skips the welcome screen, which would ask for a voice server address.
CMD ["sh", "-c", "node -e \"import('./server/connections.js').then(async m => { try { await (await import('node:fs/promises')).access(m.CONNECTIONS_FILE) } catch { await m.saveConnections(m.CONNECTIONS_FILE, m.DEFAULT_CONNECTIONS) } })\" && exec node server/index.js"]
