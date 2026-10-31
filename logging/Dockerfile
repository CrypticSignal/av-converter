FROM node:26-alpine AS builder
# Node 25+ images no longer bundle Yarn or Corepack.
RUN npm install --global yarn@1.22.22

WORKDIR /app

COPY package.json ./
RUN yarn install

COPY index.ts ./
# Complile to JavaScript (index.js)
RUN npx tsc index.ts

FROM node:26-alpine
# Node 25+ images no longer bundle Yarn or Corepack.
RUN npm install --global yarn@1.22.22

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
