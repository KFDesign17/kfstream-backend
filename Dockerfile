FROM node:22-slim

# Installe Chromium (pour Puppeteer) et ses dépendances système
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxkbcommon0 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer utilise le Chromium système (pas de téléchargement)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3000

CMD ["node", "src/index.js"]
