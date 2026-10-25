import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, BadRequestError } from '../errors.ts';
import { logger } from '../logger.ts';
import { InvalidActivityFileError } from '../parsers/gpx.ts';

/** Parses request input with a zod schema; failures become 400 responses listing the problems. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const summary = details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
    throw new BadRequestError(`Invalid request: ${summary}`, details);
  }
  return result.data;
}

export const MAX_UPLOAD_FILES = 100;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.gpx', '.fit'];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) cb(null, true);
    else
      cb(
        new BadRequestError(
          `Unsupported file "${file.originalname}": only .gpx and .fit files are allowed`
        )
      );
  },
});

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`,
  LIMIT_FILE_COUNT: `Too many files (max ${MAX_UPLOAD_FILES} per request)`,
  LIMIT_UNEXPECTED_FILE: `Too many files or unexpected field (max ${MAX_UPLOAD_FILES} per request, field "files")`,
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: MULTER_MESSAGES[err.code] ?? err.message });
    return;
  }
  if (err instanceof InvalidActivityFileError) {
    res.status(400).json({ error: err.message });
    return;
  }
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: err.message });
    return;
  }
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
};

/** Parses a JSON column without letting one corrupt row break a whole response. */
export function safeJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const bikeTypeFilter = z.enum(['road', 'gravel', 'mtb', 'unassigned']).optional();
