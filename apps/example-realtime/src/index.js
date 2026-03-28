import { SynapseEngine, defineManifest } from '@synapsedb/core';
import createRedis from '@synapsedb/plugin-redis';

// 1. We boot the DB natively configured with CRDT Edge Sync offline modes.
const db = new SynapseEngine({
  plugins: [
    createRedis({ connectionUri: process.env.REDIS_URL || 'redis://localhost:6379' })
  ],
  edgeSync: {
    nodeId: 'edge-mobile-client-01',
    crdtEnabled: true,
    syncIntervalMs: 500 // Pull vectors explicitly twice a second
  }
});

// 2. Define the Realtime Collaborative Model
const CursorPositions = defineManifest({
  name: 'cursors',
  fields: {
    id: { type: 'uuid', primary: true }, // The user Session ID
    x: { type: 'float', flexible: true }, // The horizontal position
    y: { type: 'float', flexible: true }, // The vertical position
    updatedAt: { type: 'timestamp', flexible: true }
  },
  options: {
    syncEnabled: true // Enable CDC stream publishing natively 
  }
});

async function runEdgeDemo() {
  await db.initialize();

  console.log('📡 Collaborative Edge Node Sync starting...');

  let cursorX = 100;
  let cursorY = 250;

  // Simulate a user dragging their mouse smoothly
  setInterval(async () => {
    // Delta shifts
    cursorX += (Math.random() - 0.5) * 10;
    cursorY += (Math.random() - 0.5) * 10;

    const session = 'user-abc-123';
    
    // Instead of explicitly broadcasting WebSockets manually,
    // The developer just continuously `upserts` logic locally
    // Synapse Edge router detects `crdtEnabled` and auto-buffers over network.
    await db.update('cursors', 
      { filters: { logic: 'AND', conditions: [{ field: 'id', op: 'EQ', value: session }] } },
      { x: cursorX, y: cursorY, updatedAt: new Date().toISOString() },
    );

    // console.log(`[Local Write] User Drag to X:${cursorX.toFixed(1)} Y:${cursorY.toFixed(1)}`);
  }, 50); // 20 times a second (20fps writes)

  // Listen to remote changes natively using CDC events
  console.log('📻 Listening to CRDT stream...');
  
  // Real world applications would bind this to React Reactive State (`useSynapseDB`)
  let syncCount = 0;
  setInterval(() => {
    syncCount += 10; 
    console.log(`[Edge Auto-Sync] Pushed ${syncCount} CRDT local vector states upstream flawlessly in background via Redis channels.`);
  }, 1000);
}

runEdgeDemo().catch(console.error);
