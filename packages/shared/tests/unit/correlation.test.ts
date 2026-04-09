import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { correlationMiddleware } from '../../src/middleware/correlation.js';

describe('correlationMiddleware', () => {
  it('should generate correlation ID if not provided', () => {
    const middleware = correlationMiddleware();
    const req = { headers: {} } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toBeDefined();
    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', req.correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('should use existing correlation ID from header', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440000';
    const middleware = correlationMiddleware();
    const req = { headers: { 'x-correlation-id': existingId } } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toBe(existingId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', existingId);
    expect(next).toHaveBeenCalled();
  });

  it('should handle case-insensitive header', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440000';
    const middleware = correlationMiddleware();
    const req = { headers: { 'x-correlation-id': existingId } } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.correlationId).toBe(existingId);
  });
});
