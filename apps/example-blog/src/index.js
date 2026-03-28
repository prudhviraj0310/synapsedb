import express from 'express';
import { SynapseEngine, defineManifest } from '@synapsedb/core';
import createPostgres from '@synapsedb/plugin-postgres';
import createRedis from '@synapsedb/plugin-redis';
import { synapseMiddleware, synapseErrorHandler } from '@synapsedb/express';

// 1. Initialize Intelligent Data OS
const db = new SynapseEngine({
  plugins: [
    createPostgres({ connectionUri: process.env.DATABASE_URL || 'postgres://localhost/blog' }),
    createRedis({ connectionUri: process.env.REDIS_URL || 'redis://localhost:6379' })
  ],
  intelligence: { enabled: true }
});

// 2. Define the exact shape and INTENT of your data.
// Notice `cached: true` — Synapse will auto-route reads to Redis first.
const Articles = defineManifest({
  name: 'articles',
  fields: {
    id: { type: 'uuid', primary: true },
    title: { type: 'string', searchable: true },
    content: { type: 'string', cached: true, ttl: 3600 }, // Magic happens here
    authorId: { type: 'uuid', indexed: true }
  }
});

const app = express();
app.use(express.json());

// 3. Inject Synapse into your framework
app.use(synapseMiddleware(db));

// 4. Build standard routes. You never manually write Redis `GET` lines again.
app.get('/articles/:id', async (req, res, next) => {
  try {
    const start = performance.now();
    const article = await req.db.findOne('articles', {
      filters: { logic: 'AND', conditions: [{ field: 'id', op: 'EQ', value: req.params.id }] }
    });
    
    // The first time this takes 15ms (Postgres). The second time it takes 0.5ms (Redis).
    res.json({ data: article, meta: { took_ms: performance.now() - start } });
  } catch(err) { next(err); }
});

app.post('/articles', async (req, res, next) => {
  try {
    const result = await req.db.insert('articles', [req.body]);
    res.json(result);
  } catch(err) { next(err); }
});

// 5. Catch Circuit Breaker errors seamlessly
app.use(synapseErrorHandler());

db.initialize().then(() => {
  app.listen(3000, () => console.log('🚀 SynapseDB Example Blog running on port 3000'));
});
