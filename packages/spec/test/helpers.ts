import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const ADAPTERS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../adapters');
export const fixtureDir = (name: string) => path.join(ADAPTERS, 'fixtures', name);
export const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
export const PACKAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
