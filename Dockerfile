FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache postgresql16-client

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY db ./db
COPY data ./data
COPY public ./public
COPY admin ./admin

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
