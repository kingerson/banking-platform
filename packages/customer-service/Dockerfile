FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/customer-service/package.json ./packages/customer-service/

RUN npm ci --workspace=packages/shared --workspace=packages/customer-service

COPY packages/shared ./packages/shared
COPY packages/customer-service ./packages/customer-service
COPY tsconfig.base.json ./

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/customer-service

# ── Runtime ──
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/customer-service ./packages/customer-service

WORKDIR /app/packages/customer-service
EXPOSE 3001
CMD ["node", "dist/index.js"]
