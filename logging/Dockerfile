FROM node:26-alpine
WORKDIR /app
COPY package.json index.ts ./
# Compile index.ts to index.js, then drop the build-only packages.
RUN npm install && npx tsc index.ts && npm prune --omit=dev
ENV NODE_ENV=production
USER node
CMD ["node", "index.js"]
