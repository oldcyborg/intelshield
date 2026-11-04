# IntelShield web (Next.js standalone). Build: docker compose -f deploy/docker-compose.yml build web
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Next bakes the /api rewrite at build time: where the backend is, inside the compose network.
ARG API_URL=http://backend:5001
# Optional: folder holding the per-role tutorial videos (ending in '/'), and where the Android app is
# downloaded. Empty video folder hides the videos; empty download URL means the GitHub releases page.
ARG NEXT_PUBLIC_VIDEO_BASE_URL=
ARG NEXT_PUBLIC_APP_DOWNLOAD_URL=
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_VIDEO_BASE_URL=$NEXT_PUBLIC_VIDEO_BASE_URL NEXT_PUBLIC_APP_DOWNLOAD_URL=$NEXT_PUBLIC_APP_DOWNLOAD_URL
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Ho_Chi_Minh PORT=5000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 5000
CMD ["node", "server.js"]
