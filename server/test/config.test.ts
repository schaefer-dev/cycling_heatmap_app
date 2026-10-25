import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('config paths', () => {
  it('resolves relative DATA_DIR and DB_PATH against the repository root', () => {
    const config = loadConfig({ DATA_DIR: './demo', DB_PATH: './data/demo.db' });
    expect(config.dataDir).toBe(path.join(REPO_ROOT, 'demo'));
    expect(config.backupDir).toBe(path.join(REPO_ROOT, 'demo', 'backups'));
    expect(config.dbPath).toBe(path.join(REPO_ROOT, 'data', 'demo.db'));
  });

  it('defaults to data/cycling_archive.db in the repository', () => {
    expect(loadConfig({}).dbPath).toBe(path.join(REPO_ROOT, 'data', 'cycling_archive.db'));
  });
});
