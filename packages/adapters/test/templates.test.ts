import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expandRecipeTemplate, expandTemplateDirs, writeExpanded, type RecipeTemplate } from '../src/node/templates';
import { runFixtures } from '../src/node/fixtures';

const template = (): RecipeTemplate => ({
    template: 'tube',
    version: 2,
    recipe: {
        match: ['https://{{host}}/*'],
        api: {
            url: 'https://{{host}}/api/videos?channel={{channel}}&q={query}&start={page}',
            items: '$.data[*]',
            fields: { id: '$.id', link: { template: 'https://{{host}}/w/{uuid}' }, image: '$.thumb', aspect: { w: '$.w', h: '$.h' } },
        },
        fixtures: ['fixtures/page1.json'],
        tags: ['video'],
    },
    meta: { title: '{{name}}', description: 'Videos on {{host}}' },
});

describe('expandRecipeTemplate', () => {
    it('fills {{host}} and vars in every string and keeps the recipe placeholders', () => {
        const [a, b] = expandRecipeTemplate(template(), [
            { host: 'tube.example', name: 'Example Tube', vars: { channel: 'main' }, previews: ['https://cdn.example/1.jpg'] },
            { host: 'v.other.org', id: 'other.org', vars: { channel: 'x' }, revision: 1 },
        ]);
        expect(a.recipe).toMatchObject({ id: 'tube.example', version: 2, match: ['https://tube.example/*'] });
        expect(a.recipe.api!.url).toBe('https://tube.example/api/videos?channel=main&q={query}&start={page}');
        expect(a.recipe.api!.fields.link).toEqual({ template: 'https://tube.example/w/{uuid}' });
        expect(a.meta).toEqual({ title: 'Example Tube', description: 'Videos on tube.example', previews: ['https://cdn.example/1.jpg'], family: 'tube', position: 0 });
        expect(b.meta.previews).toEqual([]);
        expect(b.meta.position).toBe(1);
        expect(b.recipe).toMatchObject({ id: 'other.org', version: 3 });
        expect(b.meta.title).toBe('v.other.org');
    });
    it('refuses a bad host, a duplicate id, an unknown placeholder, a reserved or unsafe var, and {{name}} in the recipe', () => {
        const ok = { channel: 'c' };
        expect(() => expandRecipeTemplate(template(), [{ host: 'https://x.org', vars: ok }])).toThrow(/hostname/);
        expect(() => expandRecipeTemplate(template(), [{ host: 'a.org', vars: ok }, { host: 'b.org', id: 'a.org', vars: ok }])).toThrow(/duplicate/);
        expect(() => expandRecipeTemplate(template(), [{ host: 'a.org' }])).toThrow(/\{\{channel\}\}/);
        for (const channel of ['a*', '1&x=y', 'a/b', 'a?b', 'a b']) expect(() => expandRecipeTemplate(template(), [{ host: 'a.org', vars: { channel } }])).toThrow(/plain token/);
        expect(() => expandRecipeTemplate(template(), [{ host: 'A.org', vars: ok }, { host: 'a.org', vars: ok }])).toThrow(/duplicate/);
        expect(() => expandRecipeTemplate(template(), [{ host: 'a.org', vars: { channel: 'c', host: 'b.org' } }])).toThrow(/reserved/);
        expect(() => expandRecipeTemplate(template(), [{ host: 'a.org', vars: ok, previews: ['http://a.org/1.jpg'] }])).toThrow(/https/);
        for (const id of ['..', '.', '.hidden', 'a/b']) expect(() => expandRecipeTemplate(template(), [{ host: 'a.org', id, vars: ok }])).toThrow(/letter or digit/);
        const t = template();
        t.recipe.tags = ['{{name}}'];
        expect(() => expandRecipeTemplate(t, [{ host: 'a.org', vars: ok }])).toThrow(/\{\{name\}\}/);
        expect(() => expandRecipeTemplate({ ...template(), recipe: { ...template().recipe, id: 'x' } as never }, [])).toThrow(/id or version/);
    });
});

describe('expandTemplateDirs and writeExpanded', () => {
    it('writes the recipes/ layout, and each expanded recipe passes the fixture runner', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'tpl-'));
        const dir = path.join(root, 'tube');
        mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
        writeFileSync(path.join(dir, 'template.json'), JSON.stringify(template()));
        writeFileSync(path.join(dir, 'hosts.json'), JSON.stringify([{ host: 'tube.example', vars: { channel: 'm' } }, { host: 'v.other.org', vars: { channel: 'n' } }]));
        writeFileSync(path.join(dir, 'fixtures', 'page1.json'), JSON.stringify({ data: [{ id: 1, uuid: 'u1', thumb: 'https://cdn.example/t1.jpg', w: 280, h: 157 }] }));
        const list = expandTemplateDirs(root);
        expect(list.map((e) => e.id)).toEqual(['tube.example', 'v.other.org']);
        const out = path.join(root, 'out');
        writeExpanded(list, out);
        const recipe = JSON.parse(readFileSync(path.join(out, 'v.other.org', 'recipe.json'), 'utf8'));
        expect(JSON.parse(readFileSync(path.join(out, 'v.other.org', 'meta.json'), 'utf8')).description).toBe('Videos on v.other.org');
        expect(existsSync(path.join(out, 'v.other.org', 'fixtures', 'page1.json'))).toBe(true);
        const report = await runFixtures(recipe, path.join(out, 'v.other.org'));
        expect(report, JSON.stringify(report)).toMatchObject({ ok: true, results: [{ items: 1 }] });
    });
    it('refuses a fixture that leaves the template folder through .. or a symlink, and an id that is not a directory name', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'tpl-'));
        const dir = path.join(root, 'tube');
        mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
        writeFileSync(path.join(root, 'secret.json'), '{}');
        symlinkSync(path.join(root, 'secret.json'), path.join(dir, 'fixtures', 'link.json'));
        const [e] = expandRecipeTemplate(template(), [{ host: 'tube.example', vars: { channel: 'm' } }], dir);
        const out = path.join(root, 'out');
        for (const f of ['fixtures/link.json', '../secret.json']) {
            expect(() => writeExpanded([{ ...e, recipe: { ...e.recipe, fixtures: [f] } }], out)).toThrow(/outside its template folder/);
        }
        expect(() => writeExpanded([{ ...e, id: '..' }], out)).toThrow(/plain directory name/);
        expect(existsSync(path.join(root, 'recipe.json'))).toBe(false);
    });
    it('refuses the same id from two templates', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'tpl-'));
        for (const name of ['a', 'b']) {
            mkdirSync(path.join(root, name));
            writeFileSync(path.join(root, name, 'template.json'), JSON.stringify({ ...template(), template: name }));
            writeFileSync(path.join(root, name, 'hosts.json'), JSON.stringify([{ host: 'same.org', vars: { channel: 'c' } }]));
        }
        expect(() => expandTemplateDirs(root)).toThrow(/two templates/);
    });
});
