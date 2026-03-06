import { createApp } from './app.js';
import { env } from './env.js';

async function main(): Promise<void> {
  const app = await createApp();
  await app.listen({
    host: env.API_HOST,
    port: env.API_PORT
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
