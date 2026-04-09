import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './schema/resolvers.js';
import { getCircuitBreakersHealth } from './utils/service-breakers.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

async function bootstrap() {
  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    formatError: (error) => {
      console.error('[GraphQL Error]', error);
      return {
        message: error.message,
        extensions: error.extensions,
      };
    },
  });

  await server.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json(),
    expressMiddleware(server, {
      context: async ({ req }) => {
        const correlationId = (req.headers['x-correlation-id'] as string) || uuid();
        return { correlationId };
      },
    }),
  );

  app.get('/health', (_req, res) => {
    const circuitBreakers = getCircuitBreakersHealth();
    const allHealthy = circuitBreakers.every(cb => cb.healthy);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'graphql-gateway',
      circuitBreakers,
    });
  });

  app.get('/circuit-breakers', (_req, res) => {
    res.json({
      circuitBreakers: getCircuitBreakersHealth(),
      timestamp: new Date().toISOString(),
    });
  });

  await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));
  console.log(`[graphql-gateway] 🚀 Server ready at http://localhost:${PORT}/graphql`);
  console.log(`[graphql-gateway] 📊 GraphQL Playground available`);
}

bootstrap().catch((err) => {
  console.error('Failed to start graphql-gateway:', err);
  process.exit(1);
});
