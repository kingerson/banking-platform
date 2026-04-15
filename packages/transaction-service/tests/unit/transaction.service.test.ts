import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionService } from '../../src/services/transaction.service';
import { DuplicateTransactionError, ValidationError } from '@banking/shared';

const mockTxnRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  findByAccountId: vi.fn(),
  updateStatus: vi.fn(),
};

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const mockDbClient = {
  query: vi.fn().mockResolvedValue({}),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockDbClient),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbClient.query.mockResolvedValue({});
    mockDbClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockDbClient);
    service = new TransactionService(mockTxnRepo as any, mockPool as any);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
  });

  describe('requestTransaction', () => {
    it('should create a deposit and publish TransactionRequested', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue(null);
      mockTxnRepo.create.mockResolvedValue({
        id: 'txn-1',
        type: 'deposit',
        status: 'pending',
        amount: 500,
        currency: 'PEN',
        sourceAccountId: null,
        targetAccountId: 'acc-1',
        idempotencyKey: 'dep-001',
        createdAt: new Date().toISOString(),
        completedAt: null,
      });

      const result = await service.requestTransaction({
        type: 'deposit',
        amount: 500,
        currency: 'PEN',
        targetAccountId: 'acc-1',
        idempotencyKey: 'dep-001',
      });

      expect(result.status).toBe('pending');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should reject duplicate idempotency key', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue({ id: 'existing' });

      await expect(
        service.requestTransaction({
          type: 'deposit',
          amount: 100,
          targetAccountId: 'acc-1',
          idempotencyKey: 'dup-key',
        }),
      ).rejects.toThrow(DuplicateTransactionError);
    });

    it('should validate deposit requires target account', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.requestTransaction({
          type: 'deposit',
          amount: 100,
          idempotencyKey: 'no-target',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should validate withdrawal requires source account', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.requestTransaction({
          type: 'withdrawal',
          amount: 100,
          idempotencyKey: 'no-source',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should validate transfer requires both accounts', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.requestTransaction({
          type: 'transfer',
          amount: 100,
          sourceAccountId: 'acc-1',
          idempotencyKey: 'no-target-transfer',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should prevent transfer to same account', async () => {
      mockTxnRepo.findByIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.requestTransaction({
          type: 'transfer',
          amount: 100,
          sourceAccountId: 'acc-1',
          targetAccountId: 'acc-1',
          idempotencyKey: 'self-transfer',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
