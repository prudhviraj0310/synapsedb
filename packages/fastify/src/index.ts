import type { FastifyPluginAsync, FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import type { SynapseEngine } from '@synapsedb/core';
import { SynapseError } from '@synapsedb/core';

// Augment the FastifyInstance to include our db
declare module 'fastify' {
  interface FastifyInstance {
    db: SynapseEngine;
  }
}

export interface SynapseFastifyOptions {
  engine: SynapseEngine;
  /** Automatically register the error handler mapping Circuit Breaker errors to HTTP 503 */
  registerErrorHandler?: boolean;
}

/**
 * Fastify plugin that registers SynapseDB.
 * Attaches the engine securely as `fastify.db`.
 */
export const fastifySynapsePlugin: FastifyPluginAsync<SynapseFastifyOptions> = async (
  fastify: FastifyInstance,
  options: SynapseFastifyOptions
) => {
  if (!options.engine) {
    throw new Error('SynapseEngine instance is required in options');
  }

  // Inject fastify.db securely
  fastify.decorate('db', options.engine);

  if (options.registerErrorHandler !== false) {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof SynapseError) {
        if (error.code === 'CIRCUIT_OPEN') {
           reply.status(503).send({
            success: false,
            error: {
              code: error.code,
              message: 'Database connection temporarily unavailable via Circuit Breaker.',
            },
          });
          return;
        }

        if (error.code === 'VALIDATION_FAILED' || error.code === 'SCHEMA_INVALID') {
           reply.status(400).send({
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          });
          return;
        }
      }

      // Fallback
      reply.send(error);
    });
  }
};

export default fastifySynapsePlugin;
