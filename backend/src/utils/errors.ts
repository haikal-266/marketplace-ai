import { Request, Response, NextFunction } from 'express';

/**
 * Base class untuk semua custom errors aplikasi.
 * Sertakan statusCode agar middleware error handler bisa kirim response HTTP yang tepat.
 */
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 Bad Request */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/** 401 Unauthorized */
export class UnauthorizedError extends AppError {
  constructor(message = 'Facebook belum terkoneksi') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/** 404 Not Found */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} tidak ditemukan`, 404, 'NOT_FOUND');
  }
}

/** 409 Conflict */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Express error handler middleware.
 * Tangani semua error yang di-throw dari route handlers.
 * Pasang sebagai middleware TERAKHIR di Express app.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || 'APP_ERROR',
        message: err.message,
      },
    });
    return;
  }

  // Prisma unique constraint violation
  if ((err as any).code === 'P2002') {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Data sudah ada (duplicate)',
      },
    });
    return;
  }

  // Unexpected error
  console.error('[ErrorHandler] Unexpected error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Terjadi kesalahan internal server',
    },
  });
}

/**
 * Wrapper async route handler agar tidak perlu try-catch di setiap route.
 * Error dilempar ke error handler middleware.
 *
 * @example
 * router.get('/listings', asyncHandler(async (req, res) => {
 *   const listings = await listingService.getAll();
 *   res.json({ success: true, data: listings });
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
