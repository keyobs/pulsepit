import Fastify from 'fastify';

const app = Fastify({ logger: true });
app.get('/api/health', async () => ({ status: 'ok', app: 'pulsepit-api' }));

const port = Number(process.env.PORT ?? 3001);
try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

async function shutdown() {
  await app.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
