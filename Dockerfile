# RevenueOS: one image serving the web app and the API on port 4000.

# ---- web app ----
FROM node:24-alpine AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/tsconfig.json ./
COPY server/src ./src
COPY --from=web /build/web/dist /app/web/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
