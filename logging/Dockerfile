FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN yarn install

COPY index.ts ./
# Complile to JavaScript (index.js)
RUN npx tsc index.ts

FROM node:24-alpine

ENV NODE_ENV=production

# Create app directory and set correct permissions before switching user
RUN mkdir -p /app && chown -R node:node /app

WORKDIR /app

# Switch to non-root user for security
USER node

# Copy files with correct ownership
COPY --chown=node:node package.json ./
RUN yarn install --production && yarn cache clean

# Copy compiled JavaScript from builder
COPY --chown=node:node --from=builder /app/index.js ./

CMD ["node", "index.js"]
