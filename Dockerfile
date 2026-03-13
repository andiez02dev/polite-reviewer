FROM node:22-alpine AS base

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm install --only=production

COPY src ./src
COPY README.md ./

# Expose the HTTP port for the webhook server
EXPOSE 3000

# Default command runs the webhook server
CMD ["node", "src/server.js"]

