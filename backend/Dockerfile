FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads logs

EXPOSE 5000

ENV NODE_ENV=production

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
