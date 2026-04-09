export const typeDefs = `#graphql
  type Client {
    id: ID!
    name: String!
    email: String!
    documentNumber: String!
    createdAt: String!
    accounts: [Account!]!
  }

  type Account {
    id: ID!
    clientId: ID!
    accountNumber: String!
    balance: Float!
    currency: String!
    status: String!
    createdAt: String!
    client: Client
    transactions: [Transaction!]!
  }

  enum TransactionType {
    DEPOSIT
    WITHDRAWAL
    TRANSFER
  }

  enum TransactionStatus {
    PENDING
    COMPLETED
    REJECTED
  }

  type Transaction {
    id: ID!
    type: TransactionType!
    sourceAccountId: ID
    targetAccountId: ID
    amount: Float!
    currency: String!
    status: TransactionStatus!
    idempotencyKey: String!
    description: String
    reason: String
    createdAt: String!
    completedAt: String
    explanation: String
  }

  type Query {
    client(id: ID!): Client
    clients: [Client!]!
    account(id: ID!): Account
    accountsByClient(clientId: ID!): [Account!]!
    transaction(id: ID!): Transaction
    transactions(
      accountId: ID
      status: TransactionStatus
      limit: Int = 50
    ): [Transaction!]!
    health: HealthStatus!
  }

  type Mutation {
    createClient(input: CreateClientInput!): Client!
    createAccount(input: CreateAccountInput!): Account!
    requestTransaction(input: RequestTransactionInput!): Transaction!
  }

  input CreateClientInput {
    name: String!
    email: String!
    documentNumber: String!
  }

  input CreateAccountInput {
    clientId: ID!
    currency: String = "PEN"
  }

  input RequestTransactionInput {
    type: TransactionType!
    sourceAccountId: ID
    targetAccountId: ID
    amount: Float!
    currency: String = "PEN"
    idempotencyKey: String!
    description: String
  }

  type HealthStatus {
    status: String!
    timestamp: String!
    services: ServiceHealth!
  }

  type ServiceHealth {
    customerService: String!
    transactionService: String!
    aiService: String!
  }
`;
