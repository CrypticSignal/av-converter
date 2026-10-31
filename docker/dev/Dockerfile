FROM node:26-alpine
# Node 25+ images no longer bundle Yarn or Corepack.
RUN npm install --global yarn@1.22.22

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY ./src ./src
COPY ./public ./public

CMD ["yarn", "dev"]