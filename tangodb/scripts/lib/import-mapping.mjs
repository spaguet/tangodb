import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tangodbRoot } from './import-common.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mappingsDir = resolve(tangodbRoot, '.import-mappings');

export class IdMappingStore {
  constructor({ orgId, slug, sourceFile, sourceHash }) {
    this.path = resolve(mappingsDir, `${slug}.json`);
    this.data = {
      version: 1,
      orgId,
      slug,
      sourceFile,
      sourceHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedSteps: [],
      ids: {
        clients: {},
        subscriptions: {},
        personal_lessons: {},
        prices: {},
        disciplines: {},
        locations: {},
        classes: {},
        schedule_slots: {},
      },
    };

    if (existsSync(this.path)) {
      const loaded = JSON.parse(readFileSync(this.path, 'utf8'));
      if (loaded.orgId !== orgId) {
        throw new Error(`Mapping file ${this.path} belongs to org ${loaded.orgId}, not ${orgId}`);
      }
      if (loaded.sourceHash && sourceHash && loaded.sourceHash !== sourceHash) {
        console.warn(
          `Warning: source file hash changed (${loaded.sourceHash} → ${sourceHash}). Mapping reused; verify IDs.`
        );
      }
      this.data = { ...this.data, ...loaded, ids: { ...this.data.ids, ...loaded.ids } };
    }
  }

  isStepCompleted(step) {
    return this.data.completedSteps.includes(step);
  }

  markStepCompleted(step) {
    if (!this.data.completedSteps.includes(step)) {
      this.data.completedSteps.push(step);
    }
    this.data.updatedAt = new Date().toISOString();
    this.save();
  }

  getUuid(table, oldKey) {
    const key = String(oldKey);
    return this.data.ids[table]?.[key] ?? null;
  }

  setUuid(table, oldKey, uuid) {
    if (!this.data.ids[table]) this.data.ids[table] = {};
    this.data.ids[table][String(oldKey)] = uuid;
  }

  mapOrCreate(table, oldKey) {
    const key = String(oldKey);
    let uuid = this.getUuid(table, key);
    if (!uuid) {
      uuid = randomUUID();
      this.setUuid(table, key, uuid);
    }
    return uuid;
  }

  save() {
    mkdirSync(mappingsDir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }

  summary() {
    const counts = {};
    for (const [table, map] of Object.entries(this.data.ids)) {
      counts[table] = Object.keys(map).length;
    }
    return {
      path: this.path,
      completedSteps: [...this.data.completedSteps],
      mappedIds: counts,
    };
  }
}
