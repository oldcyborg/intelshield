# IntelShield app (bản chạy trên trình duyệt) — chỉ để thử trên máy và quay video hướng dẫn.
# Bản cho điện thoại vẫn build bằng npm run android:apk.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Vite bakes the API address in at build time: where the browser reaches the backend.
ARG VITE_API_BASE=http://localhost:3001/api
ENV VITE_API_BASE=$VITE_API_BASE
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
