import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService } from '../../src/services/customer.service.js';
import { ConflictError, NotFoundError } from '@banking/shared';

const mockClientRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByEmail: vi.fn(),
  findAll: vi.fn(),
};

const mockAccountRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByClientId: vi.fn(),
  updateBalance: vi.fn(),
  getBalance: vi.fn(),
};

const mockDbClient = {
  query: vi.fn().mockResolvedValue({}),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockDbClient),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbClient.query.mockResolvedValue({});
    mockDbClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockDbClient);
    service = new CustomerService(
      mockClientRepo as any,
      mockAccountRepo as any,
      mockPool as any,
    );
  });

  describe('createClient', () => {
    it('should create a client and publish ClientCreated event', async () => {
      mockClientRepo.findByEmail.mockResolvedValue(null);
      mockClientRepo.create.mockResolvedValue({
        id: 'test-uuid',
        name: 'Juan Pérez',
        email: 'juan@test.com',
        documentNumber: '12345678',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await service.createClient({
        name: 'Juan Pérez',
        email: 'juan@test.com',
        documentNumber: '12345678',
      });

      expect(result.name).toBe('Juan Pérez');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw ConflictError if email already exists', async () => {
      mockClientRepo.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createClient({ name: 'Test', email: 'dup@test.com', documentNumber: '99999999' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('createAccount', () => {
    it('should create account for existing client', async () => {
      mockClientRepo.findById.mockResolvedValue({ id: 'client-1', name: 'Test' });
      mockAccountRepo.create.mockResolvedValue({
        id: 'acc-1',
        clientId: 'client-1',
        accountNumber: '191-0000000001',
        balance: 0,
        currency: 'PEN',
        status: 'active',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await service.createAccount({ clientId: 'client-1', currency: 'PEN' });

      expect(result.balance).toBe(0);
      expect(result.clientId).toBe('client-1');
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw NotFoundError if client does not exist', async () => {
      mockClientRepo.findById.mockResolvedValue(null);

      await expect(
        service.createAccount({ clientId: 'nonexistent', currency: 'PEN' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getBalance', () => {
    it('should return balance for existing account', async () => {
      mockAccountRepo.getBalance.mockResolvedValue(1500.50);

      const result = await service.getBalance('acc-1');

      expect(result).toEqual({ accountId: 'acc-1', balance: 1500.50 });
    });

    it('should throw NotFoundError for nonexistent account', async () => {
      mockAccountRepo.getBalance.mockResolvedValue(null);

      await expect(service.getBalance('bad-id')).rejects.toThrow(NotFoundError);
    });
  });
});
