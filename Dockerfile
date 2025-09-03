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
RUN npm ci --only=production
COPY . .

EXPOSE 7150 7160

CMD ["npm", "start"]
