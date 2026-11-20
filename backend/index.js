/**
 * Vercel entrypoint. Vercel's Express support looks for a module whose default
 * export is the app (index.js at the project root wins over src/app.js, which
 * only exports createApp). Local development keeps using src/server.js.
 */
import { validateConfig } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { createApp } from './src/app.js';

const { errors, warnings } = validateConfig();
for (const w of warnings) logger.warn(`config: ${w}`);
if (errors.length) {
  // Throw instead of process.exit so the reason shows up in Vercel's runtime logs.
  throw new Error(`Configuration invalid: ${errors.join('; ')} — set these in the Vercel project's Environment Variables and redeploy.`);
}

export default createApp();
