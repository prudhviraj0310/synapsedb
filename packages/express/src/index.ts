import type { Request, Response, NextFunction } from 'express';
import type { SynapseEngine } from '@synapsedb/core';
import { SynapseError } from '@synapsedb/core';

declare global {
  namespace Express {
    interface Request {
      db: SynapseEngine;
    }
  }
}

/**
 * Middleware that safely injects the SynapseDB engine into the Express Request object.
 * This makes `req.db` available on all downstream routes.
 *
 * @param engine The initialized SynapseEngine instance
 */
export function synapseMiddleware(engine: SynapseEngine) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.db = engine;
    next();
  };
}

/**
 * Express Error Handler that automatically catches SynapseDB internal errors.
 * - Circuit Breaker (CIRCUIT_OPEN) -> HTTP 503 (Service Unavailable)
 * - Validation Errors -> HTTP 400 (Bad Request)
 * - Generic Plugin Errors -> HTTP 500
 */
export function synapseErrorHandler() {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SynapseError) {
      if (err.code === 'CIRCUIT_OPEN') {
         res.status(503).json({
          success: false,
          error: {
            code: err.code,
            message: 'Database connection temporarily unavailable via Circuit Breaker.',
          },
        });
        return;
      }
      
      if (err.code === 'VALIDATION_FAILED' || err.code === 'SCHEMA_INVALID') {
         res.status(400).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
    }

    // Pass any other standard errors on down the Express chain
    next(err);
  };
}
