/**
 * Vercel entrypoint (also package.json "main"). Re-exports the lazy handler from
 * src/app.js so Vercel gets a valid default export whichever file it picks.
 * Local development keeps using src/server.js.
 */
export { default } from './src/app.js';
