# Banking Platform

Plataforma bancaria basada en microservicios con arquitectura event-driven.

## Arquitectura

```
                    CLIENTES (Web, Mobile, Third-party)
                                    |
                    ┌───────────────┴───────────────┐
                    |                               |
         ┌──────────────────┐           ┌──────────────────────┐
         │  GraphQL Gateway │           │    REST API Gateway   │
         │     (:4000)      │           │       (:3000)         │
         │─────────────────-│           │──────────────────────-│
         │ BFF              │           │ JWT (HS256)           │
         │ Agregacion datos │           │ RBAC (roles)          │
         │ Circuit Breaker  │           │ Rate Limiting (Redis) │
         │ Schema unificado │           │ OWASP Headers         │
         └──────────────────┘           └──────────────────────┘
                    |                               |
                    └───────────────┬───────────────┘
                                    |
               ┌────────────────────┼────────────────────┐
               |                    |                    |
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │  Customer Svc    │ │ Transaction Svc  │ │   AI / LLM Svc   │
    │    (:3001)       │ │    (:3002)       │ │     (:3003)      │
    │─────────────────-│ │─────────────────-│ │─────────────────-│
    │ Clientes         │ │ Depositos        │ │ Explicaciones    │
    │ Cuentas          │ │ Retiros          │ │ Resumenes        │
    │ Saldos           │ │ Transferencias   │ │ Analisis riesgo  │
    │ Prisma ORM       │ │ Prisma ORM       │ │ Prisma ORM       │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
               |                    |                    |
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   PostgreSQL     │ │   PostgreSQL     │ │   PostgreSQL     │
    │  customers_db    │ │ transactions_db  │ │     ai_db        │
    │    (:5433)       │ │    (:5434)       │ │    (:5435)       │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
               |                    |                    |
               └────────────────────┼────────────────────┘
                                    |
                    ┌───────────────────────────────┐
                    │      Apache Kafka              │
                    │───────────────────────────────│
                    │ Topics: banking.*              │
                    │ Kafka: :9092  Zookeeper: :2181 │
                    └───────────────────────────────┘
                                    |
                    ┌───────────────────────────────┐
                    │         Redis (:6379)          │
                    │───────────────────────────────│
                    │ Cache · Rate Limit · Sessions  │
                    └───────────────────────────────┘

  Seguridad
  ─────────
  JWT HS256          autenticacion en API Gateway y GraphQL Gateway
  RBAC               roles: admin, customer, readonly
  Rate Limiting      100 req/min por IP (Redis)
  OWASP Headers      helmet, CORS, XSS, CSRF, content-type sniffing

  Observabilidad
  ──────────────
  Prometheus (:9090)  metricas de todos los servicios
  Loki (:3100)        logs centralizados via Promtail
  Grafana (:3030)     dashboards (Prometheus + Loki)

  Flujo de una transaccion
  ────────────────────────
  POST /transactions  [requiere JWT valido + rol customer o admin]
    -> API Gateway valida token y reenvía con headers x-user-id, x-user-role
    -> transaction-service guarda en DB + outbox (atomico)
    -> PostgreSQL NOTIFY despierta OutboxPoller (~1ms)
    -> OutboxPoller publica TransactionRequested a Kafka
    -> Saga valida fondos y actualiza balance
    -> customer-service recibe TransactionCompleted
    -> balance actualizado en ~100-150ms
```

**Servicios:**

| Servicio | Puerto | Descripción |
|---|---|---|
| API Gateway | 3000 | Punto de entrada, JWT, RBAC, proxy |
| Customer Service | 3001 | Clientes y cuentas |
| Transaction Service | 3002 | Transacciones, Saga, CQRS |
| AI Service | 3003 | Análisis con LLM |
| GraphQL Gateway | 4000 | API unificada GraphQL, Circuit Breaker |

**Infraestructura:**

| Componente | Puerto | Descripción |
|---|---|---|
| PostgreSQL (customers) | 5433 | Base de datos clientes |
| PostgreSQL (transactions) | 5434 | Base de datos transacciones |
| PostgreSQL (ai) | 5435 | Base de datos AI |
| PgBouncer (customers) | 6433 | Connection pooling |
| PgBouncer (transactions) | 6434 | Connection pooling |
| PgBouncer (ai) | 6435 | Connection pooling |
| Kafka | 9092 | Event streaming |
| Zookeeper | 2181 | Coordinación Kafka |
| Redis | 6379 | Cache, rate limiting y sesiones |
| Prometheus | 9090 | Métricas |
| Grafana | 3030 | Dashboards |
| Loki | 3100 | Logs |

## Seguridad

Toda petición al sistema pasa por el API Gateway, que aplica las siguientes capas antes de reenviar al microservicio correspondiente:

```
Peticion entrante
  |
  v
Rate Limiting (Redis)
  100 req/min por IP
  responde 429 si se supera el limite
  |
  v
OWASP Headers (helmet)
  X-Content-Type-Options, X-Frame-Options,
  Strict-Transport-Security, X-XSS-Protection
  |
  v
Validacion JWT
  verifica firma HS256 con JWT_SECRET
  verifica expiracion del token
  responde 401 si el token es invalido o ausente
  |
  v
Control de acceso por rol (RBAC)
  admin     -> acceso total
  customer  -> lectura/escritura sobre sus propios recursos
  readonly  -> solo GET, sin escritura
  responde 403 si el rol no tiene permiso
  |
  v
Proxy al microservicio
  agrega headers internos:
    x-user-id, x-user-role, x-user-email, x-correlation-id
```

**Endpoints publicos** (sin JWT):

```
POST /auth/login    obtener token
POST /auth/refresh  renovar token
GET  /auth/me       info del token actual
GET  /health        estado del gateway
```

**Permisos por rol:**

| Endpoint | admin | customer | readonly |
|---|---|---|---|
| POST /api/v1/clients | OK | - | - |
| GET /api/v1/clients | OK | OK | OK |
| POST /api/v1/accounts | OK | OK | - |
| GET /api/v1/accounts/:id/balance | OK | OK | OK |
| POST /api/v1/transactions | OK | OK | - |
| GET /api/v1/transactions/:id | OK | OK | OK |
| POST /api/v1/ai/* | OK | OK | - |

**Usuarios de prueba:**

| Email | Password | Rol |
|---|---|---|
| admin@bank.com | admin123 | admin |
| customer@bank.com | customer123 | customer |
| readonly@bank.com | readonly123 | readonly |

## Bus de servicios

Se utiliza **Apache Kafka** como bus de eventos para la comunicación entre microservicios.

Kafka corre junto a Zookeeper en Docker. Los topics siguen el patrón `banking.*`:

| Topic | Publicado por | Consumido por |
|---|---|---|
| `banking.clients.created` | customer-service | ai-service |
| `banking.accounts.created` | customer-service | transaction-service |
| `banking.accounts.balance-updated` | customer-service | transaction-service |
| `banking.transactions.requested` | transaction-service | transaction-service (saga) |
| `banking.transactions.completed` | transaction-service | customer-service, ai-service |
| `banking.transactions.rejected` | transaction-service | customer-service, ai-service |
| `banking.*.dlq` | cualquier servicio | monitoreo |

**Procesamiento idempotente:** cada servicio mantiene una tabla `processed_events` con los IDs de eventos ya procesados. Antes de procesar un evento se verifica si ya fue procesado, descartándolo si es así.

**Manejo de fallos:** el OutboxPoller reintenta la publicación hasta 5 veces en caso de error. Los mensajes que superan ese límite se mueven al Dead Letter Queue (topic `banking.*.dlq` + tabla `dead_letter_queue` en PostgreSQL).

**Garantía de entrega:** se usa el patrón Transactional Outbox. El evento se escribe en la tabla `outbox` dentro de la misma transacción de base de datos que el dato de negocio. PostgreSQL LISTEN/NOTIFY notifica al poller en menos de 1ms para publicar a Kafka sin esperar el intervalo de polling.

## Rol del microservicio LLM

El AI Service (`ai-service`) no ejecuta lógica bancaria. Su función es interpretar información financiera y generar explicaciones en lenguaje natural, además de analizar el riesgo de cada transacción en tiempo real.

### Endpoints

| Endpoint | Rol requerido | Descripción |
|---|---|---|
| `POST /api/v1/ai/explain` | customer, admin | Explica una transacción en lenguaje natural |
| `POST /api/v1/ai/summary` | customer, admin | Resume el historial de transacciones de una cuenta |
| `POST /api/v1/ai/translate-event` | customer, admin | Traduce un evento técnico de Kafka a mensaje para el usuario |
| `POST /api/v1/ai/risk` | customer, admin | Analiza el riesgo de una transacción (low / medium / high) |
| `GET /api/v1/ai/explanations/:txnId` | customer, admin | Obtiene el historial de explicaciones generadas para una transacción |

### Patrones LLM implementados

**1. Prompt Templates centralizados (`src/prompts/index.ts`)**

Todos los prompts están en un único archivo tipado. Cada función recibe parámetros estructurados y construye el prompt de forma consistente. Esto permite versionar los prompts, hacer A/B testing y evitar strings dispersos en el código.

```
Prompts.explainCompleted({ type, amount, currency, ... })
Prompts.explainRejected({ type, amount, reason, ... })
Prompts.summarizeAccount({ totalDeposits, totalWithdrawals, ... })
Prompts.translateEvent(eventSubject, eventData)
Prompts.analyzeRisk({ type, amount, accountBalance, ... })
```

**2. Retry con backoff exponencial**

El `AnthropicLLMProvider` reintenta automáticamente hasta 3 veces ante errores de red o rate limits (HTTP 429/5xx). El delay entre intentos crece exponencialmente: 500ms → 1s → 2s, con jitter aleatorio para evitar thundering herd.

```
intento 1 → falla → espera 500ms + jitter
intento 2 → falla → espera 1000ms + jitter
intento 3 → falla → propaga el error al Fallback
```

**3. Fallback chain (`FallbackLLMProvider`)**

Si el proveedor primario (Anthropic) falla tras los reintentos, el sistema cae automáticamente al Mock sin lanzar error al usuario. Garantiza disponibilidad del servicio aunque la API externa no esté disponible.

```
AnthropicLLMProvider (primario)
        |
        | falla
        v
MockLLMProvider (fallback)
```

**4. Rate limiter interno**

Limita las llamadas concurrentes al LLM a un máximo de 3 simultáneas con al menos 200ms entre llamadas. Evita superar las cuotas de la API y protege contra picos de tráfico.

**5. Cache de explicaciones en PostgreSQL**

Antes de llamar al LLM, el servicio verifica si ya existe una explicación para esa transacción en la tabla `ai_explanations`. Si existe, la devuelve directamente sin consumir tokens. Patrón Cache-Aside aplicado a LLM.

**6. Análisis de riesgo en tiempo real**

El servicio escucha el evento `TransactionRequested` de Kafka y analiza el riesgo de cada transacción antes de que sea procesada. Obtiene el saldo real de la cuenta desde el customer-service y calcula:

| riskLevel | score | Criterio |
|---|---|---|
| low | 0-39 | Monto < 40% del saldo disponible |
| medium | 40-79 | Monto entre 40% y 80% del saldo |
| high | 80-100 | Monto > 80% del saldo o monto > $5,000 |

Respuesta del endpoint `/api/v1/ai/risk`:
```json
{
  "riskLevel": "high",
  "score": 96,
  "reasons": ["El monto supera el 80% del saldo disponible"],
  "recommendation": "Revisar manualmente antes de aprobar"
}
```

**7. Consumo de eventos Kafka (Subscriber pattern)**

El AI service reacciona a tres eventos del bus sin acoplamiento directo con los otros servicios:

| Evento Kafka | Acción del AI service |
|---|---|
| `banking.transactions.requested` | Analiza el riesgo, loguea advertencia si es HIGH |
| `banking.transactions.completed` | Genera explicación en lenguaje natural, la guarda en DB |
| `banking.transactions.rejected` | Genera explicación del rechazo con mensaje empático |

**Proveedor LLM:** configurable via `LLM_PROVIDER`. En desarrollo usa el Mock (sin API key). En producción usa Anthropic Claude con fallback automático al Mock.

```bash
LLM_PROVIDER=mock        # desarrollo (default)
LLM_PROVIDER=anthropic   # producción (requiere LLM_API_KEY)
LLM_MODEL=claude-sonnet-4-20250514
```

### Ejemplo completo

```bash
# 1. Analizar riesgo de una transacción
curl -X POST http://localhost:3000/api/v1/ai/risk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "type": "withdrawal",
    "amount": 2400,
    "currency": "USD",
    "sourceAccountId": "<account-uuid>"
  }'

# Respuesta
{
  "success": true,
  "data": {
    "riskLevel": "high",
    "score": 96,
    "reasons": ["El monto supera el 80% del saldo disponible"],
    "recommendation": "Revisar manualmente antes de aprobar"
  }
}

# 2. Explicar una transacción completada
curl -X POST http://localhost:3000/api/v1/ai/explain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"transactionId": "<uuid>"}'

# Respuesta
{
  "success": true,
  "data": {
    "transactionId": "<uuid>",
    "explanation": "Se realizó un depósito exitoso en tu cuenta. El monto ha sido acreditado y ya se refleja en tu saldo disponible."
  }
}
```

## Estructura del proyecto

```
banking-platform/
├── packages/
│   ├── shared/                     codigo compartido entre servicios
│   │   └── src/
│   │       ├── adapters/           KafkaEventBus
│   │       ├── cache/              Redis client, CacheService
│   │       ├── database/           Prisma client, migrations
│   │       ├── dlq/                Dead Letter Queue handlers
│   │       ├── event-sourcing/     Aggregates, EventStore, Snapshots
│   │       ├── events/             definicion de eventos y payloads
│   │       ├── health/             HealthChecker
│   │       ├── metrics/            Prometheus client
│   │       ├── middleware/         Correlation ID
│   │       ├── outbox/             OutboxRepository, OutboxPoller
│   │       ├── security/           OWASP middleware
│   │       ├── types/              DTOs, interfaces, IEventBus
│   │       └── utils/              Errors, ErrorHandler
│   ├── api-gateway/                punto de entrada REST (JWT, RBAC, proxy)
│   │   └── src/
│   ├── customer-service/           clientes y cuentas
│   │   ├── src/
│   │   │   ├── models/             schema PostgreSQL
│   │   │   ├── repositories/       acceso a datos (pg + Prisma)
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── subscribers/        Kafka consumers (balance updates)
│   │   └── tests/
│   ├── transaction-service/        transacciones, Saga, CQRS
│   │   ├── src/
│   │   │   ├── models/
│   │   │   ├── repositories/       TransactionRepo, ProjectionRepo
│   │   │   ├── routes/
│   │   │   ├── saga/               Choreography Saga
│   │   │   ├── services/
│   │   │   └── subscribers/        CQRS projections
│   │   └── tests/
│   ├── ai-service/                 analisis con LLM
│   │   ├── src/
│   │   │   ├── providers/          LLM provider (Anthropic/mock)
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── subscribers/
│   │   └── tests/
│   └── graphql-gateway/            API GraphQL unificada (BFF)
│       └── src/
│           ├── schema/             TypeDefs, Resolvers
│           └── utils/              CircuitBreaker, ServiceBreakers
├── scripts/
│   ├── start-services.sh           inicia microservicios Node.js
│   ├── restart.sh                  reinicio completo del sistema
│   ├── load-test.ts                prueba de carga
│   └── demo-interview.ts           demo interactivo
├── postman/
│   ├── Banking-Platform.postman_collection.json
│   └── Banking-Platform.postman_environment.json
├── monitoring/
│   ├── grafana/                    dashboards y datasources
│   ├── loki/                       configuracion Loki
│   └── promtail/                   configuracion Promtail
└── docker-compose.yml
```

## Requisitos

- Node.js 20+
- Docker Desktop
- npm 9+

## Instalación

```bash
npm install
```

## Iniciar el sistema

### Script automático (recomendado)

```bash
bash scripts/restart.sh
```

Para destruir volúmenes y empezar desde cero:

```bash
bash scripts/restart.sh --full
```

### Manual

```bash
docker compose up zookeeper kafka redis \
  db-customers db-transactions db-ai \
  pgbouncer-customers pgbouncer-transactions pgbouncer-ai \
  loki promtail grafana prometheus -d

# Esperar ~15 segundos a que Kafka y PostgreSQL esten listos

bash scripts/start-services.sh
```

## Verificar que todo está correcto

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:4000/health
```

## Endpoints principales

Todos los endpoints requieren el header `Authorization: Bearer <token>` excepto los de autenticación.

### Autenticación

```
POST /auth/login      obtener token JWT
POST /auth/refresh    renovar token
GET  /auth/me         info del usuario autenticado
```

### Clientes  [admin, customer]

```
POST   /api/v1/clients              crear cliente           [admin]
GET    /api/v1/clients              listar clientes         [admin, customer, readonly]
GET    /api/v1/clients/:id          obtener cliente         [admin, customer, readonly]
GET    /api/v1/clients/:id/accounts cuentas del cliente     [admin, customer, readonly]
```

### Cuentas  [admin, customer]

```
POST   /api/v1/accounts             crear cuenta            [admin, customer]
GET    /api/v1/accounts/:id         obtener cuenta          [admin, customer, readonly]
GET    /api/v1/accounts/:id/balance consultar saldo         [admin, customer, readonly]
```

### Transacciones  [admin, customer]

```
POST   /api/v1/transactions              crear transaccion (async)   [admin, customer]
GET    /api/v1/transactions/:id          consultar estado            [admin, customer, readonly]
GET    /api/v1/accounts/:id/transactions historial                   [admin, customer, readonly]
```

### AI  [admin, customer]

```
POST   /api/v1/ai/explain           explicar transaccion    [admin, customer]
POST   /api/v1/ai/summary           resumen de cuenta       [admin, customer]
POST   /api/v1/ai/risk              analisis de riesgo      [admin, customer]
```

### GraphQL

```
GET/POST http://localhost:4000/graphql    requiere JWT en header Authorization
```

El GraphQL Gateway actúa como BFF (Backend for Frontend). Agrega datos de los tres microservicios en una sola consulta, aplica Circuit Breaker por servicio y requiere JWT en el header `Authorization`.

**Queries disponibles:**

```graphql
# Obtener cliente con sus cuentas y transacciones en una sola consulta
query {
  client(id: "uuid") {
    id
    name
    email
    accounts {
      id
      accountNumber
      balance
      currency
      transactions {
        id
        type
        amount
        status
        createdAt
      }
    }
  }
}

# Listar todos los clientes
query {
  clients {
    id
    name
    email
  }
}

# Consultar transacciones filtradas
query {
  transactions(accountId: "uuid", status: COMPLETED, limit: 10) {
    id
    type
    amount
    status
    explanation
  }
}

# Health check de todos los servicios
query {
  health {
    status
    services {
      customerService
      transactionService
      aiService
    }
  }
}
```

**Mutations disponibles:**

```graphql
# Crear cliente
mutation {
  createClient(input: {
    name: "Juan Perez"
    email: "juan@example.com"
    documentNumber: "DNI12345678"
  }) {
    id
    name
  }
}

# Crear cuenta
mutation {
  createAccount(input: {
    clientId: "uuid"
    currency: "USD"
  }) {
    id
    accountNumber
    balance
  }
}

# Crear transaccion
mutation {
  requestTransaction(input: {
    type: TRANSFER
    sourceAccountId: "uuid"
    targetAccountId: "uuid"
    amount: 200
    currency: "USD"
    idempotencyKey: "unique-key-uuid"
  }) {
    id
    status
    amount
  }
}
```

**Ejemplo con curl:**

```bash
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ clients { id name email } }"}'
```

## Flujo de una transferencia

```
Cliente
  |
  | POST /api/v1/transactions
  | { type: "transfer", amount: 200, sourceAccountId, targetAccountId, idempotencyKey }
  | Authorization: Bearer <jwt>
  v
API Gateway (:3000)
  | 1. Rate limiting: verifica que IP no supero el limite
  | 2. Valida JWT: firma, expiracion, claims
  | 3. Verifica rol: customer o admin pueden crear transacciones
  | 4. Agrega headers internos: x-user-id, x-user-role, x-correlation-id
  | 5. Reenvía al Transaction Service
  v
Transaction Service (:3002)
  | 1. Verifica idempotencyKey (evita duplicados)
  | 2. Crea transaccion en estado PENDING
  | 3. Escribe TransactionRequested en tabla outbox (misma transaccion DB)
  | 4. Responde 202 Accepted { status: "pending" }
  |
  | PostgreSQL NOTIFY -> OutboxPoller despierta (~1ms)
  v
Kafka (topic: banking.transactions.requested)
  v
Transaction Service - Saga
  | 1. Consume TransactionRequested
  | 2. Verifica que cuenta origen existe y tiene fondos suficientes
  | 3. Verifica que cuenta destino existe
  | 4. Debita cuenta origen
  | 5. Acredita cuenta destino
  | 6. Actualiza transaccion a COMPLETED (o REJECTED si falla alguna validacion)
  | 7. Publica TransactionCompleted (o TransactionRejected)
  v
Kafka (topic: banking.transactions.completed)
  |
  ├── Customer Service (:3001)
  |     actualiza balance en su base de datos
  |
  └── AI Service (:3003)
        genera explicacion en lenguaje natural

Cliente
  | GET /api/v1/transactions/:id
  | Authorization: Bearer <jwt>
  v
{ status: "completed", amount: 200, ... }
```

El balance queda actualizado en aproximadamente 100-150ms desde el POST inicial.

Si la cuenta origen no tiene fondos suficientes, la transaccion pasa a estado `rejected` con el motivo del rechazo.

## Tipos de transacción

| Tipo | Campos requeridos |
|---|---|
| `deposit` | `targetAccountId`, `amount`, `currency`, `idempotencyKey` |
| `withdrawal` | `sourceAccountId`, `amount`, `currency`, `idempotencyKey` |
| `transfer` | `sourceAccountId`, `targetAccountId`, `amount`, `currency`, `idempotencyKey` |

Monedas aceptadas: `PEN`, `USD`.

El campo `idempotencyKey` debe ser único por transacción (UUID recomendado).

## Ejemplos

### Obtener token

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bank.com","password":"admin123"}' \
  | jq -r '.data.token')
```

### Crear cliente y cuenta

```bash
CLIENT_ID=$(curl -s -X POST http://localhost:3000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Juan Perez","email":"juan@example.com","documentNumber":"DNI12345678"}' \
  | jq -r '.data.id')

ACCOUNT_ID=$(curl -s -X POST http://localhost:3000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"clientId\":\"$CLIENT_ID\",\"currency\":\"USD\",\"initialBalance\":1000}" \
  | jq -r '.data.id')
```

### Depósito

```bash
curl -s -X POST http://localhost:3000/api/v1/transactions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"type\": \"deposit\",
    \"amount\": 500,
    \"targetAccountId\": \"$ACCOUNT_ID\",
    \"currency\": \"USD\",
    \"idempotencyKey\": \"$(uuidgen)\"
  }"
```

### Consultar saldo

```bash
curl -s http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/balance \
  -H "Authorization: Bearer $TOKEN"
```

### Probar control de acceso

```bash
READONLY_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"readonly@bank.com","password":"readonly123"}' \
  | jq -r '.data.token')

curl -s -X POST http://localhost:3000/api/v1/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $READONLY_TOKEN" \
  -d '{"name":"Test","email":"t@t.com","documentNumber":"DOC00000001"}'
```

Respuesta esperada: `403 Forbidden` — el rol `readonly` no puede crear clientes.

## Demo con Postman

Importar los archivos:

- `postman/Banking-Platform.postman_collection.json`
- `postman/Banking-Platform.postman_environment.json`

Seleccionar el environment `Banking Platform Local` y ejecutar en orden:

| Request | Descripción |
|---|---|
| G2 — Login Admin | obtiene token JWT, lo guarda automáticamente |
| G3 — Login Readonly | obtiene token con rol readonly |
| G5 — Acceso denegado (readonly) | demuestra RBAC: 403 al intentar crear |
| A1 — Crear cliente | 201 Created |
| A5 — Crear cuenta 1 | saldo inicial $1000 |
| A6 — Crear cuenta 2 | saldo inicial $200 |
| A7 — Consultar saldo | demuestra Cache-Aside Redis |
| B1 — Deposito | 202 Accepted, status: pending |
| B2 — Consultar estado | espera 200ms, muestra completed |
| B3 — Retiro | descuenta del saldo |
| B4 — Transferencia | mueve fondos entre cuentas |
| B5 — Fondos insuficientes | 202 Accepted, sera rejected |
| B6 — Consultar rechazo | muestra rejected + motivo |
| C1 — Explicar transaccion | AI genera texto en lenguaje natural |

## Prueba de carga

```bash
npx tsx scripts/load-test.ts
```

Modo solo depósitos:

```bash
npx tsx scripts/load-test.ts --mode=deposit
```

## Interfaces web

| Interfaz | URL | Credenciales |
|---|---|---|
| Grafana | http://localhost:3030 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| GraphQL Playground | http://localhost:4000/graphql | JWT requerido |

## Detener el sistema

```bash
pkill -f "tsx"

docker compose down -v
```

## Patrones implementados

### Arquitectura y mensajería

| Patron | Descripcion |
|---|---|
| Transactional Outbox | escritura atomica DB + evento, publicacion garantizada |
| LISTEN/NOTIFY | PostgreSQL notifica al poller en <1ms, sin polling activo |
| Saga (choreography) | coordinacion de transacciones distribuidas via eventos |
| CQRS | proyecciones locales en transaction-service sin HTTP entre servicios |
| Idempotent Consumer | tabla processed_events evita procesar el mismo evento dos veces |
| Circuit Breaker | GraphQL Gateway protege contra fallos en cascada |
| Dead Letter Queue | mensajes fallidos en Kafka topic + tabla PostgreSQL |
| Event Sourcing | EventStore con snapshots para reconstruir estado de cuentas |

### Resiliencia y rendimiento

| Patron | Descripcion |
|---|---|
| Cache-Aside | Redis cachea balances, invalida al recibir BalanceUpdated |
| PgBouncer | connection pooling entre microservicios y PostgreSQL |
| Retry con backoff exponencial | LLM reintenta 3 veces con delays crecientes ante errores de API |
| Fallback chain | si Anthropic falla, el sistema cae al Mock sin error visible al usuario |
| Rate limiter interno | max 3 llamadas LLM concurrentes, 200ms entre llamadas |

### Seguridad

| Patron | Descripcion |
|---|---|
| JWT + RBAC | autenticacion y autorizacion por rol en API Gateway |
| Rate Limiting | 100 req/min por IP con Redis, responde 429 |
| OWASP Headers | helmet aplica cabeceras de seguridad en todos los servicios |

### LLM / Inteligencia Artificial

| Patron | Descripcion |
|---|---|
| Prompt Templates | prompts centralizados y tipados en src/prompts/index.ts |
| Cache de explicaciones | PostgreSQL cachea respuestas LLM por transaccion, evita llamadas repetidas |
| Subscriber pattern | AI service reacciona a eventos Kafka sin acoplamiento con otros servicios |
| Risk scoring | analisis de riesgo en tiempo real: score 0-100, nivel low/medium/high |
| Provider factory | createLLMProvider() selecciona proveedor por variable de entorno |
