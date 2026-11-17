import { Errors } from '../utils/app-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rejects malformed :id-style params before they reach the database. */
export function uuidParams(router, ...names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => (UUID.test(value) ? next() : next(Errors.notFound())));
  }
}
