import { Errors } from '../utils/app-error.js';

/**
 * Validate req[source] with a zod schema. The parsed (coerced, stripped)
 * value replaces the original so controllers only see validated input.
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(Errors.validation(details));
  }
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  return next();
};
