import { SynapseEngine, defineManifest } from '@synapsedb/core';
import createPostgres from '@synapsedb/plugin-postgres';
import createMongo from '@synapsedb/plugin-mongodb';

// 1. We connect BOTH a relational and a document database
const db = new SynapseEngine({
  plugins: [
    createPostgres({ connectionUri: process.env.DATABASE_URL || 'postgres://localhost/store' }),
    createMongo({ connectionUri: process.env.MONGO_URL || 'mongodb://localhost/store' })
  ]
});

// 2. Define the Polyglot E-Commerce Model
const Products = defineManifest({
  name: 'products',
  fields: {
    id: { type: 'uuid', primary: true },
    
    // Inventory + Price MUST have ACID transactional accuracy (Postgres)
    price: { type: 'integer', transactional: true, required: true },
    stockCount: { type: 'integer', transactional: true },
    
    // Searchable Marketing descriptions belong in a NoSQL Document Store (MongoDB)
    name: { type: 'string', searchable: true },
    features: { type: 'array', flexible: true },
    metadata: { type: 'json', flexible: true }, // Schema-less JSON
    
    // Automatically routes writes/reads based on definitions defined above. No dual-writes handled by developer.
  }
});

async function runStoreDemo() {
  await db.initialize();

  console.log('📦 E-Commerce Platform Booting...');

  // The Developer just inserts an object.
  // The 'price' goes to Postgres.
  // The 'metadata' goes to Mongo.
  const newProduct = {
    id: 'macbook-pro-14',
    name: 'Apple MacBook Pro 14"',
    price: 199900, // Cents (SQL)
    stockCount: 45, // (SQL)
    features: ['M3 Max', '36GB RAM', 'Liquid Retina'], // (Mongo)
    metadata: {
      color: 'Space Black',
      weight: '3.5 lbs',
      seoTags: ['apple', 'laptop', 'macbook'] 
    } // (Mongo)
  };

  const start = performance.now();
  
  // Magic Polyglot Insert
  const { insertedIds } = await db.insert('products', [newProduct]);
  
  console.log(`✅ Product mapped into dual-databases automatically in ${Math.round(performance.now() - start)}ms.`);
  console.log('ID:', insertedIds[0]);

  // Read implicitly splices data back together
  const theProduct = await db.findOne('products', {
    filters: {
      logic: 'AND', conditions: [{ field: 'id', op: 'EQ', value: 'macbook-pro-14' }]
    }
  });

  console.log('Read Unified Data Object natively:', theProduct);
  
  process.exit(0);
}

runStoreDemo().catch(console.error);
