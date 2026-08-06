# Secrets handling — why the credentials live where they do

Credentials provided this session:
- `project_url` — not secret, public per-project identifier.
- `publishable_key` (`sb_publishable_...`) — Supabase's new-style publishable
  key, designed for client-side exposure (RLS-gated). Low risk.
- `access_token` (`sbp_...`) — a Supabase **Personal Access Token**, which
  authenticates against the account-level Management API, not a single
  project. Scope: can manage every project under the account, not row-level
  data. This is the highest-risk credential of the three.

**Source:** Supabase key-format conventions — `sb_publishable_...`/
`sb_secret_...` prefixes and `sbp_...` (personal access token) prefix are
documented in Supabase's own dashboard/CLI tooling and support material; token
prefix alone was sufficient to identify the token class without needing to
call the Management API to check.

## Decision

- All three values live in `.env`, which is `.gitignore`d (`.env`, `.env.*`,
  `!.env.example`) — never committed, never in `openspec/` artifacts, never
  pasted into a mermaid diagram or planning doc.
- `.env.example` documents the *shape* (empty values) so another developer
  knows what to fill in without seeing real secrets.
- Recommended follow-up (not performed automatically — this is the user's
  account): rotate the `sbp_...` personal access token from the Supabase
  dashboard (Account → Access Tokens) since it was pasted into a chat
  transcript, which may be logged/retained outside this repo's control.
