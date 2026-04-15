#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

FULL=${1:-""}
LOG_DIR="/tmp"

pkill -9 -f "tsx packages" 2>/dev/null || true
sleep 2
lsof -ti :3000 -ti :3001 -ti :3002 -ti :3003 -ti :4000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

if [ "$FULL" = "--full" ]; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker no esta corriendo. Abre Docker Desktop primero."
    exit 1
  fi
  docker compose down -v --remove-orphans 2>&1 | grep -E "Removed|Network|Volume|Stopped" || true
  until [ -z "$(docker compose ps -q 2>/dev/null)" ]; do sleep 1; done
  echo "Contenedores detenidos. Datos de Prometheus/Grafana borrados."
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker no esta corriendo. Abre Docker Desktop primero."
  exit 1
fi

docker compose up zookeeper kafka redis \
  db-customers db-transactions db-ai \
  pgbouncer-customers pgbouncer-transactions pgbouncer-ai \
  loki promtail grafana prometheus -d 2>&1 | grep -E "Started|Running|Healthy|Created|Error" || true

wait_for_pg_docker() {
  local container=$1
  local name=$2
  local max=30
  for i in $(seq 1 $max); do
    if docker exec "$container" pg_isready -q 2>/dev/null; then
      echo "OK  $name (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "WARN $name tardo mas de ${max}s"
}

wait_for_pg_docker "banking-platform-db-customers-1"    "PostgreSQL customers"
wait_for_pg_docker "banking-platform-db-transactions-1" "PostgreSQL transactions"
wait_for_pg_docker "banking-platform-db-ai-1"           "PostgreSQL ai"

for i in $(seq 1 20); do
  if docker exec banking-platform-kafka-1 kafka-topics --bootstrap-server localhost:9092 --list >/dev/null 2>&1; then
    echo "OK  Kafka (${i}s)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "WARN Kafka tardo mas de 40s"
  fi
  sleep 2
done

export KAFKAJS_NO_PARTITIONER_WARNING=1

> "$LOG_DIR/customer-service.log"
> "$LOG_DIR/transaction-service.log"
> "$LOG_DIR/ai-service.log"
> "$LOG_DIR/api-gateway.log"
> "$LOG_DIR/graphql-gateway.log"

nohup env NODE_ENV=development \
  DB_HOST=localhost DB_PORT=5433 DB_NAME=customers_db DB_USER=customers_user DB_PASSWORD=customers_pass \
  DB_POOL_MAX=10 KAFKA_BROKERS=localhost:9092 REDIS_URL=redis://localhost:6379 PORT=3001 \
  npx tsx --tsconfig packages/customer-service/tsconfig.json packages/customer-service/src/main.ts > "$LOG_DIR/customer-service.log" 2>&1 &

nohup env NODE_ENV=development \
  DB_HOST=localhost DB_PORT=5434 DB_NAME=transactions_db DB_USER=transactions_user DB_PASSWORD=transactions_pass \
  DB_POOL_MAX=10 KAFKA_BROKERS=localhost:9092 PORT=3002 \
  npx tsx --tsconfig packages/transaction-service/tsconfig.json packages/transaction-service/src/main.ts > "$LOG_DIR/transaction-service.log" 2>&1 &

nohup env NODE_ENV=development \
  DB_HOST=localhost DB_PORT=5435 DB_NAME=ai_db DB_USER=ai_user DB_PASSWORD=ai_pass \
  DB_POOL_MAX=10 KAFKA_BROKERS=localhost:9092 PORT=3003 \
  TRANSACTION_SERVICE_URL=http://localhost:3002 \
  CUSTOMER_SERVICE_URL=http://localhost:3001 \
  LLM_PROVIDER=mock \
  npx tsx --tsconfig packages/ai-service/tsconfig.json packages/ai-service/src/main.ts > "$LOG_DIR/ai-service.log" 2>&1 &

nohup env NODE_ENV=development \
  KAFKA_BROKERS=localhost:9092 PORT=3000 \
  JWT_SECRET=banking-platform-secret-key-2024 JWT_EXPIRES_IN=24h \
  CUSTOMER_SERVICE_URL=http://localhost:3001 \
  TRANSACTION_SERVICE_URL=http://localhost:3002 \
  AI_SERVICE_URL=http://localhost:3003 \
  npx tsx --tsconfig packages/api-gateway/tsconfig.json packages/api-gateway/src/main.ts > "$LOG_DIR/api-gateway.log" 2>&1 &

nohup env NODE_ENV=development PORT=4000 \
  CUSTOMER_SERVICE_URL=http://localhost:3001 \
  TRANSACTION_SERVICE_URL=http://localhost:3002 \
  AI_SERVICE_URL=http://localhost:3003 \
  npx tsx packages/graphql-gateway/src/index.ts > "$LOG_DIR/graphql-gateway.log" 2>&1 &

ALL_OK=true
for svc in "3000:api-gateway" "3001:customer-service" "3002:transaction-service" "3003:ai-service" "4000:graphql-gateway"; do
  port="${svc%%:*}"
  name="${svc##*:}"
  ok=false
  for i in $(seq 1 20); do
    if curl -s --max-time 2 "http://localhost:$port/health" >/dev/null 2>&1; then
      ok=true
      break
    fi
    sleep 3
  done
  if $ok; then
    echo "OK  $name :$port"
  else
    echo "ERR $name :$port  ->  tail -f $LOG_DIR/${name}.log"
    ALL_OK=false
  fi
done

echo ""
echo "API Gateway:        http://localhost:3000"
echo "GraphQL Playground: http://localhost:4000/graphql"
echo "Grafana:            http://localhost:3030  (admin/admin)"
echo "Prometheus:         http://localhost:9090"
echo ""
echo "Postman: ejecuta primero G2 (Login Admin)"
echo ""
echo "Logs:"
echo "  tail -f /tmp/transaction-service.log"
echo "  tail -f /tmp/customer-service.log"
echo ""

if ! $ALL_OK; then
  exit 1
fi
