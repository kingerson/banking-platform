export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, `${resource} with id '${id}' not found`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class InsufficientFundsError extends AppError {
  constructor(accountId: string) {
    super(422, `Insufficient funds in account '${accountId}'`, 'INSUFFICIENT_FUNDS');
  }
}

export class DuplicateTransactionError extends AppError {
  constructor(idempotencyKey: string) {
    super(409, `Transaction with idempotency key '${idempotencyKey}' already exists`, 'DUPLICATE_TRANSACTION');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export function generateAccountNumber(): string {
  const prefix = '191';
  const random = Math.floor(Math.random() * 10_000_000_000).toString().padStart(10, '0');
  return `${prefix}-${random}`;
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency,
  }).format(amount);
}
