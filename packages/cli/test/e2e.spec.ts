import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

const BIN_PATH = path.resolve(__dirname, '../dist/bin/synapsedb.js');

describe('SynapseDB CLI E2E Tests', () => {

  it('should print the help menu outlining all 13 core commands', () => {
    const result = spawnSync('node', [BIN_PATH, '--help'], { encoding: 'utf-8' });
    
    // Assert 0 exit code
    expect(result.status).toBe(0);

    // The stdout should contain the commander help output with all 13 tools
    const out = result.stdout;
    expect(out).toContain('Usage: synapsedb [options] [command]');
    expect(out).toContain('dev');
    expect(out).toContain('play');
    expect(out).toContain('map');
    expect(out).toContain('replay');
    expect(out).toContain('freeze');
    expect(out).toContain('heal');
    expect(out).toContain('chat');
    expect(out).toContain('guard');
    expect(out).toContain('pulse');
    expect(out).toContain('nuke');
    expect(out).toContain('ghost');
    expect(out).toContain('warp');
    expect(out).toContain('lock');
  });

  // Since TUI commands block or require manual input, we test pure execution flags
  // avoiding hanging processes by just relying on the root binary parser test for them.
  // Instead, test that a specific command handles an unknown arg gracefully:
  it('should gracefully error on unknown commands', () => {
    const result = spawnSync('node', [BIN_PATH, 'random-undefined-command'], { encoding: 'utf-8' });
    
    // Commander should throw exit code 1
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error: unknown command');
  });

});
