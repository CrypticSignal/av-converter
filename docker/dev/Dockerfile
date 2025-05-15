FROM node:22-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and yarn.lock to leverage Docker cache
COPY package.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the source code (only src and public)
COPY src ./src
COPY public ./public

CMD ["yarn", "dev"]