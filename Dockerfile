FROM node:18-alpine

RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    ca-certificates

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN mkdir -p logs

EXPOSE 7150 7160

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:7160/health || exit 1

CMD ["npm", "start"]
