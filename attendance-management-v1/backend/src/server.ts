import 'dotenv/config';
import app from './app.js';
import db from './database/connection.js';
import { APP_PORT } from './config/constants.js';
import { getLanAddresses } from './utils/network.util.js';
import { startSessionCleanupJob } from './jobs/session-cleanup.job.js';

const server = app.listen(APP_PORT, '0.0.0.0', () => {
  console.log('\n==============================================');
  console.log('       ATTENDANCE MANAGEMENT SYSTEM');
  console.log('==============================================');
  console.log(`Backend: RUNNING on port ${APP_PORT}`);
  console.log(`Laptop:  http://localhost:${APP_PORT}`);
  const addresses = getLanAddresses();
  if (addresses.length) addresses.forEach((ip) => console.log(`Mobile:  http://${ip}:${APP_PORT}`));
  else console.log('Mobile:  No LAN IPv4 address detected yet.');
  console.log('Keep this window open while using the application.');
  console.log('==============================================\n');
});

const sessionCleanupTimer = startSessionCleanupJob();

function shutdown(signal: string): void {
  console.info(`[server] ${signal} received; shutting down.`);
  clearInterval(sessionCleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
