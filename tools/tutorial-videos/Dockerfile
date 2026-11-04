# Máy quay video hướng dẫn: Chromium (Playwright) + ffmpeg. Chạy: docker compose --profile video run --rm video
FROM mcr.microsoft.com/playwright:v1.49.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg socat fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENTRYPOINT ["sh", "/work/entrypoint.sh"]
