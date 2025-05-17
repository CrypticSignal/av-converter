FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./

RUN yarn install --frozen-lockfile

COPY ./src ./src
COPY ./public ./public

CMD ["yarn", "start"]