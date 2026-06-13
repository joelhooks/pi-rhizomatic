---
name: rhizomatic-memory
description: Use Rhizomatic memory primitives from Pi through the configured Rhizomatic Service Contract. Triggers on rhizomatic memory, recall, remember, agent memory, begin-session, briefing, trust, as-of, or cross-runtime Pi/Claude/Codex memory canaries.
---

# Rhizomatic Memory

Use this skill when a task involves Rhizomatic agent memory or the `pi-rhizomatic` package.

## Rules

- Use the native `rhizomatic_*` Pi tools when available.
- MCP is compatibility only; prefer the native Pi surface inside Pi.
- Do not assume a specific hostname, tailnet, service account, or deployment topology.
- If the service is not configured, run `/rhizomatic status` or `pi-rhizomatic init` and follow the setup output.
- Reads fail fast when offline. Mutating calls can queue to the local outbox and be retried with `pi-rhizomatic drain`.

## Useful commands

```bash
pi-rhizomatic init              # dry-run config preview
pi-rhizomatic init --write      # write user config after review
pi-rhizomatic serve --store ./rhizomatic.jsonl
pi-rhizomatic openapi --out schemas/rhizomatic.openapi.json
pi-rhizomatic drain
```

## Runtime coverage target

A real network canary requires Pi, Claude, and Codex to each begin, brief, remember, recall all runtime canary claims, and end against the same store.
