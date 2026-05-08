FROM node:22-alpine

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY tsconfig.json vite.config.ts tailwind.config.js index.html ./
COPY ./src ./src
COPY ./public ./public

CMD ["yarn", "dev"]