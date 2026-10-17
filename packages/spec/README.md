# @diazoma/spec

The open Diazoma site-compatibility spec, version 1: the text, the JSON Schemas, and a validator.

- `spec/v1.md`: the specification (CC-BY-4.0, see `LICENSE-text`).
- `schemas/manifest.schema.json`, `feed.schema.json`, `item.schema.json`, `recipe.schema.json`: JSON
  Schema 2020-12 (Apache-2.0, see `LICENSE`). `recipe.schema.json` is a copy of the file in
  `@diazoma/recipe-schema`; a test checks that the two are identical.
  Section 3.6 of `spec/v1.md` describes the recipe's api extensions (value templates, aspect from w/h,
  offset and continuation-token paging) and the limits on `re`.

## Validator

```
npx @diazoma/spec validate https://example.com
npx @diazoma/spec validate https://example.com --json
```

It detects the level (3, 2, 1, in the order of the spec), validates the manifest and one page of
each non-search feed, requests one image from each `media.hosts` host with an `Origin` header and
requires `Access-Control-Allow-Origin` to be `*` or that origin, checks that `brand.accent` has at
least 4.5:1 contrast against `brand.bg` (default `#0e0e10`) and the card surface (`#1b1b1f`), prints `policy`, and prints the ladder with pass or fail per
level and per check. Exit code 0 when the highest detected level passes, 1 when it fails or nothing
is detected, 2 on bad usage.

It does not run JavaScript, so it cannot see `window.__diazoma`; for Level 3 it looks for the embed
script and says so.
