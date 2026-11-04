# IntelShield backend (NestJS). Build: docker compose -f deploy/docker-compose.yml build backend
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 5001
# Migrations first: a new version never starts on an old schema.
CMD ["sh", "-c", "node ./node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run && node dist/main"]
