/**
 * Renecon backend entrypoint.
 *
 * Boots the config store, database, NapCat client, pipeline scheduler and the
 * REST/API server, in that dependency order.
 */

import { loadConfig } from './config/store.js';
import { initDb } from './db/index.js';
import { napcatClient } from './napcat/client.js';
import { scheduler } from './pipeline/scheduler.js';
import { createServer } from './api/server.js';
import { createLogger, setLogLevel } from './util/logger.js';

const log = createLogger('main');
const PORT = Number(process.env.PORT) || 8787;

function main() {
  setLogLevel(process.env.LOG_LEVEL || 'info');
  loadConfig();
  initDb();

  napcatClient.start();
  scheduler.start();

  const app = createServer();
  app.listen(PORT, () => {
    log.info(`Renecon backend listening on http://127.0.0.1:${PORT}`);
  });

  const shutdown = () => {
    log.info('Shutting down.');
    napcatClient.stop();
    scheduler.clearTimer();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
