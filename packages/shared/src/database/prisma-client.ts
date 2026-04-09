export interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

export function createPrismaClient<T extends PrismaClientLike>(
  PrismaClientConstructor: new (config?: any) => T,
  serviceName: string,
): T {
  const client = new PrismaClientConstructor({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

  if (process.env.NODE_ENV !== 'production') {
    (client as any).$on('query', (e: any) => {
      console.log(`[${serviceName}] Prisma Query: ${e.query}`);
      console.log(`[${serviceName}] Duration: ${e.duration}ms`);
    });
  }

  return client;
}

export async function disconnectPrisma(client: PrismaClientLike): Promise<void> {
  try {
    await client.$disconnect();
    console.log('[Prisma] Disconnected successfully');
  } catch (error) {
    console.error('[Prisma] Error disconnecting:', error);
    throw error;
  }
}
