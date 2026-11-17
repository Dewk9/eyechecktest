import { config, validateConfig } from './config/env.js';
import { logger } from './utils/logger.js';

const { errors, warnings } = validateConfig();
for (const w of warnings) logger.warn(`config: ${w}`);
if (errors.length) {
  for (const e of errors) logger.error(`config: ${e}`);
  logger.error('Configuration invalid — copy backend/.env.example to backend/.env and fill in the values. Server not started.');
  process.exit(1);
}

const { createApp } = await import('./app.js');
const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`EYE Check backend listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { error: err }));
