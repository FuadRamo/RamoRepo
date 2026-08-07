# /study — Research Log

Every schema and design decision in this project must trace back to a real,
verifiable source: official docs, a specific open-source project's data model,
or an authoritative RFC/standard. Nothing here is invented from "it seems
right" — where I couldn't verify something, it's marked `[UNVERIFIED]` and
flagged as a question in `../planning` docs instead of being asserted as fact.

## Index

- [01-openspec.md](./01-openspec.md) — the spec-driven-development tool installed in this repo
- [02-supabase-schema-design.md](./02-supabase-schema-design.md) — tables, PKs/FKs, JSONB usage, RLS, indexing
- [03-migration-to-self-hosted.md](./03-migration-to-self-hosted.md) — Supabase → VPS Postgres export path
- [04-platform-integration-source.md](./04-platform-integration-source.md) — what the business's own spec (Project1A) requires, verbatim field-by-field
- [05-secrets-handling.md](./05-secrets-handling.md) — why the Supabase credentials are handled the way they are

## Method

1. Search official docs first (Supabase docs, PostgreSQL docs, npm/GitHub for tools).
2. Fetch the actual page, quote/paraphrase what it says, keep the URL.
3. Only use a pattern in the schema if it's backed by a note in this folder.
4. If two sources conflict, say so and state which one this project follows and why.
