import { GraphQLError } from 'graphql';
import axios from 'axios';
import {
  customerServiceBreaker,
  transactionServiceBreaker,
  aiServiceBreaker,
  callWithCircuitBreaker,
} from '../utils/service-breakers.js';

const CUSTOMER_SERVICE_URL = process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3001';
const TRANSACTION_SERVICE_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3003';

interface Context {
  correlationId: string;
}

function unwrap(response: any): any {
  return response?.data ?? response;
}

function normalizeTransaction(txn: any): any {
  if (!txn) return txn;
  return {
    ...txn,
    type: txn.type ? txn.type.toUpperCase() : txn.type,
    status: txn.status ? txn.status.toUpperCase() : txn.status,
  };
}

export const resolvers = {
  Query: {

    async client(_: any, { id }: { id: string }, context: Context) {
      try {
        const envelope = await callWithCircuitBreaker(
          customerServiceBreaker,
          `${CUSTOMER_SERVICE_URL}/api/v1/clients/${id}`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(envelope);
      } catch (error: any) {
        throw new GraphQLError(
          error.response?.data?.message || error.message || 'Client not found',
          { extensions: { code: error.message?.includes('unavailable') ? 'SERVICE_UNAVAILABLE' : 'NOT_FOUND' } },
        );
      }
    },

    async clients(_: any, __: any, context: Context) {
      try {
        const envelope = await callWithCircuitBreaker(
          customerServiceBreaker,
          `${CUSTOMER_SERVICE_URL}/api/v1/clients`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(envelope);
      } catch (error: any) {
        throw new GraphQLError(
          error.response?.data?.message || error.message || 'Failed to fetch clients',
          { extensions: { code: 'SERVICE_UNAVAILABLE' } },
        );
      }
    },

    async account(_: any, { id }: { id: string }, context: Context) {
      try {
        const response = await axios.get(`${CUSTOMER_SERVICE_URL}/api/v1/accounts/${id}`, {
          headers: { 'X-Correlation-ID': context.correlationId },
        });
        return unwrap(response.data);
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Account not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
    },

    async accountsByClient(_: any, { clientId }: { clientId: string }, context: Context) {
      try {
        const response = await axios.get(
          `${CUSTOMER_SERVICE_URL}/api/v1/clients/${clientId}/accounts`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(response.data);
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Failed to fetch accounts', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },

    async transaction(_: any, { id }: { id: string }, context: Context) {
      try {
        const envelope = await callWithCircuitBreaker(
          transactionServiceBreaker,
          `${TRANSACTION_SERVICE_URL}/api/v1/transactions/${id}`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return normalizeTransaction(unwrap(envelope));
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Transaction not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
    },

    async transactions(
      _: any,
      { accountId, limit = 50 }: { accountId?: string; status?: string; limit?: number },
      context: Context,
    ) {
      if (!accountId) {
        return [];
      }
      try {
        const envelope = await callWithCircuitBreaker(
          transactionServiceBreaker,
          `${TRANSACTION_SERVICE_URL}/api/v1/accounts/${accountId}/transactions`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        const list: any[] = unwrap(envelope) ?? [];
        return (limit ? list.slice(0, limit) : list).map(normalizeTransaction);
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Failed to fetch transactions', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    },

    async health() {
      const [customerHealth, transactionHealth, aiHealth] = await Promise.allSettled([
        axios.get(`${CUSTOMER_SERVICE_URL}/health`).then(() => 'healthy').catch(() => 'unhealthy'),
        axios.get(`${TRANSACTION_SERVICE_URL}/health`).then(() => 'healthy').catch(() => 'unhealthy'),
        axios.get(`${AI_SERVICE_URL}/health`).then(() => 'healthy').catch(() => 'unhealthy'),
      ]);

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          customerService: customerHealth.status === 'fulfilled' ? customerHealth.value : 'unhealthy',
          transactionService: transactionHealth.status === 'fulfilled' ? transactionHealth.value : 'unhealthy',
          aiService: aiHealth.status === 'fulfilled' ? aiHealth.value : 'unhealthy',
        },
      };
    },
  },

  Mutation: {

    async createClient(_: any, { input }: { input: any }, context: Context) {
      try {
        const response = await axios.post(`${CUSTOMER_SERVICE_URL}/api/v1/clients`, input, {
          headers: { 'X-Correlation-ID': context.correlationId },
        });
        return unwrap(response.data);
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Failed to create client', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
    },

    async createAccount(_: any, { input }: { input: any }, context: Context) {
      try {

        const response = await axios.post(
          `${CUSTOMER_SERVICE_URL}/api/v1/accounts`,
          { clientId: input.clientId, currency: input.currency },
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(response.data);
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Failed to create account', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
    },

    async requestTransaction(_: any, { input }: { input: any }, context: Context) {
      try {
        const response = await axios.post(
          `${TRANSACTION_SERVICE_URL}/api/v1/transactions`,
          input,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return normalizeTransaction(unwrap(response.data));
      } catch (error: any) {
        throw new GraphQLError(error.response?.data?.message || 'Failed to request transaction', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
    },
  },

  Client: {
    async accounts(parent: any, _: any, context: Context) {
      try {
        const response = await axios.get(
          `${CUSTOMER_SERVICE_URL}/api/v1/clients/${parent.id}/accounts`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(response.data) ?? [];
      } catch {
        return [];
      }
    },
  },

  Account: {
    async client(parent: any, _: any, context: Context) {
      try {
        const response = await axios.get(
          `${CUSTOMER_SERVICE_URL}/api/v1/clients/${parent.clientId}`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return unwrap(response.data);
      } catch {
        return null;
      }
    },

    async transactions(parent: any, _: any, context: Context) {
      try {
        const envelope = await callWithCircuitBreaker(
          transactionServiceBreaker,
          `${TRANSACTION_SERVICE_URL}/api/v1/accounts/${parent.id}/transactions`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        return (unwrap(envelope) ?? []).map(normalizeTransaction);
      } catch {
        return [];
      }
    },
  },

  Transaction: {
    async explanation(parent: any, _: any, context: Context) {
      if (!parent.id) return null;
      try {
        const envelope = await callWithCircuitBreaker(
          aiServiceBreaker,
          `${AI_SERVICE_URL}/api/v1/ai/explanations/${parent.id}`,
          { headers: { 'X-Correlation-ID': context.correlationId } },
        );
        const list: any[] = unwrap(envelope) ?? [];
        return list.length > 0 ? list[0].explanation : null;
      } catch {
        return null;
      }
    },
  },
};
