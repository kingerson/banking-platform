FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api-gateway/package.json ./packages/api-gateway/

RUN npm ci --workspace=packages/api-gateway

COPY packages/api-gateway ./packages/api-gateway
COPY tsconfig.base.json ./

RUN npm run build --workspace=packages/api-gateway

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/api-gateway ./packages/api-gateway

WORKDIR /app/packages/api-gateway
EXPOSE 3000
CMD ["node", "dist/index.js"]
