import { describe, it, expect } from 'vitest';
import { handleDev } from '../src/commands/dev.js';
import { handlePlay } from '../src/commands/play.js';
import { handleMap } from '../src/commands/map.js';
import { handleReplay } from '../src/commands/replay.js';
import { handleFreeze } from '../src/commands/freeze.js';
import { handleHeal } from '../src/commands/heal.js';
import { handleChat } from '../src/commands/chat.js';
import { handleGuard } from '../src/commands/guard.js';
import { handlePulse } from '../src/commands/pulse.js';
import { handleNuke } from '../src/commands/nuke.js';
import { handleGhost } from '../src/commands/ghost.js';
import { handleWarp } from '../src/commands/warp.js';
import { handleLock } from '../src/commands/lock.js';

describe('SynapseDB CLI Internal Function Exports', () => {

  it('verifies all 13 command handler layers export correctly', () => {
     // A simple test ensuring the handlers are physically present and export functions
     // This guarantees no spelling or import logic errors were made in phase integration
     expect(typeof handleDev).toBe('function');
     expect(typeof handlePlay).toBe('function');
     expect(typeof handleMap).toBe('function');
     expect(typeof handleReplay).toBe('function');
     expect(typeof handleFreeze).toBe('function');
     expect(typeof handleHeal).toBe('function');
     expect(typeof handleChat).toBe('function');
     expect(typeof handleGuard).toBe('function');
     expect(typeof handlePulse).toBe('function');
     expect(typeof handleNuke).toBe('function');
     expect(typeof handleGhost).toBe('function');
     expect(typeof handleWarp).toBe('function');
     expect(typeof handleLock).toBe('function');
  });

});
