FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY index.html ./

RUN yarn install --frozen-lockfile

COPY ./src ./src
COPY ./public ./public

CMD ["yarn", "dev"]