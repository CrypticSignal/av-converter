FROM node:26-alpine
WORKDIR /app
COPY package.json index.ts geo.ts ./
# Compile the TypeScript to JavaScript, then drop the build-only packages.
RUN npm install && npx tsc index.ts && npm prune --omit=dev
# The IP location database is downloaded and kept up to date here (see geo.ts). It's a volume in
# docker-compose.yml, so restarts and deploys don't download it again.
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production
USER node
CMD ["node", "index.js"]
