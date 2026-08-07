# OpenSpec — spec-driven development tool

**Source:** https://github.com/Fission-AI/OpenSpec
**Install doc:** https://github.com/Fission-AI/OpenSpec/blob/main/docs/installation.md
**Package:** `@fission-ai/openspec` on npm

## What it is

An AI-native spec-driven-development (SDD) CLI: 5 commands, plain-Markdown
artifacts under `openspec/`, works with 20+ AI coding assistants including
Claude Code. The methodology: agree on *what* to build (a written proposal +
spec with concrete WHEN/THEN scenarios) before any code is written, then
implement against that spec, then archive it as permanent reference material.

## Why it's used here

The user's requirement was explicit: every design/code choice needs a
reference anyone can audit. OpenSpec gives that a durable home in-repo —
`openspec/changes/<id>/proposal.md` + `design.md` + `specs/*.md` — rather than
decisions living only in chat history or commit messages.

## Install used in this repo

```bash
npm install --save-dev @fission-ai/openspec@latest   # requires Node >= 20.19.0 (verified: v22.22.2 present)
npx openspec init --tools claude
```

Verified: `npx openspec --version` → `1.8.0` (installed 2026-08-06).

## Structure this repo uses

```
openspec/
  config.yaml               # project context shown to the AI on every artifact
  changes/
    <change-id>/
      proposal.md            # why, what's changing
      design.md               # technical approach
      tasks.md                 # implementation checklist
      specs/*.md                # requirements as WHEN/THEN scenarios
    archive/                    # completed changes land here after /opsx:archive,
                                  # and their specs get promoted to openspec/specs/
  specs/                          # accepted, current specs (empty until first archive)
```

Workflow commands (installed as Claude Code slash commands under `.claude/`):
`/opsx:propose`, `/opsx:apply`, `/opsx:archive` (per the GitHub README).
