import type { ErrorRequestHandler } from 'express';
import { AppError, isUniqueConstraintError } from '../utils/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error('[API error]', error);

  if (isUniqueConstraintError(error)) {
    res.status(409).json({ error: 'This record already exists.' });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.expose ? error.message : 'An unexpected server error occurred.' });
    return;
  }

  const production = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: production ? 'An unexpected server error occurred.' : (error instanceof Error ? error.message : 'Unexpected server error.'),
  });
};
