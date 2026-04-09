FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/graphql-gateway/package.json ./packages/graphql-gateway/

RUN npm ci --workspace=packages/shared --workspace=packages/graphql-gateway

COPY packages/shared ./packages/shared
COPY packages/graphql-gateway ./packages/graphql-gateway
COPY tsconfig.base.json ./

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/graphql-gateway

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/graphql-gateway ./packages/graphql-gateway

WORKDIR /app/packages/graphql-gateway
EXPOSE 4000
CMD ["node", "dist/index.js"]
