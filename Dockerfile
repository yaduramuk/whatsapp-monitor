FROM node:20-bullseye-slim

# Install Chromium and all required system libraries
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    wget \
    gnupg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Find where chromium was actually installed and store the real path
RUN which chromium || which chromium-browser || find / -name "chromium" -type f 2>/dev/null | head -5

# Set environment variables
# PUPPETEER_EXECUTABLE_PATH is resolved at runtime in server.js, not hardcoded here
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Railway uses PORT 8080 by default — we honour whatever Railway sets
ENV PORT=8080

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
