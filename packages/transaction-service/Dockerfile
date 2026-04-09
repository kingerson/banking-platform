FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/transaction-service/package.json ./packages/transaction-service/

RUN npm ci --workspace=packages/shared --workspace=packages/transaction-service

COPY packages/shared ./packages/shared
COPY packages/transaction-service ./packages/transaction-service
COPY tsconfig.base.json ./

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/transaction-service

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/transaction-service ./packages/transaction-service

WORKDIR /app/packages/transaction-service
EXPOSE 3002
CMD ["node", "dist/index.js"]
