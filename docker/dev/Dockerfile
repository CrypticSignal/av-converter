FROM node:25-alpine

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY ./src ./src
COPY ./public ./public

CMD ["yarn", "dev"]