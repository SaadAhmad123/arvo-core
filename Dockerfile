ARG NODE_VERSION=18
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
COPY node_modules ./node_modules
COPY package*.json ./
COPY . .
RUN npm run build
