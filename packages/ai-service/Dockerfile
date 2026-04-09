FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai-service/package.json ./packages/ai-service/

RUN npm ci --workspace=packages/shared --workspace=packages/ai-service

COPY packages/shared ./packages/shared
COPY packages/ai-service ./packages/ai-service
COPY tsconfig.base.json ./

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/ai-service

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/ai-service ./packages/ai-service

WORKDIR /app/packages/ai-service
EXPOSE 3003
CMD ["node", "dist/index.js"]
