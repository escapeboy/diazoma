import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));

export const SCHEMA_DIR = new URL('../schemas/', import.meta.url);

export interface Validators {
    manifest: ValidateFunction;
    feed: ValidateFunction;
    item: ValidateFunction;
    recipe: ValidateFunction;
    view: ValidateFunction;
}

let cached: Validators | null = null;

/** Compiles the schemas once; view is registered by its `$id` so the `$ref` in manifest and recipe resolves offline. `$data` stays off: it has a ReDoS history and nothing here needs it. */
export function validators(): Validators {
    if (cached) return cached;
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
    (addFormats as unknown as (a: unknown) => void)(ajv);
    const item = load('item');
    ajv.addSchema(item);
    const view = load('view');
    ajv.addSchema(view);
    cached = {
        item: ajv.getSchema(item.$id)!,
        feed: ajv.compile(load('feed')),
        manifest: ajv.compile(load('manifest')),
        recipe: ajv.compile(load('recipe')),
        view: ajv.getSchema(view.$id)!,
    };
    return cached;
}

export function describeErrors(v: ValidateFunction, limit = 3): string {
    const errors = v.errors ?? [];
    const lines = errors.slice(0, limit).map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'missingProperty' in e.params ? ` (${String(e.params.missingProperty)})` : ''}`);
    return lines.join('; ') + (errors.length > limit ? `; +${errors.length - limit} more` : '');
}
