# pi-rhizomatic

Native Pi memory surface and portable HTTP contract for Rhizomatic agent memory.

This package is intentionally **not** tied to one deployment. The package owns the contract and client/runtime surfaces; any HTTP service that conforms to the contract can back it.

## What ships in v0

- Pi extension with first-class `rhizomatic_*` tools for all Rhizomatic/Chorus primitives
- Effect-authored schemas for the Rhizomatic Service Contract
- generated OpenAPI (`pi-rhizomatic openapi`)
- HTTP client helpers and config loading
- local reference HTTP service (`pi-rhizomatic serve`)
- generic Claude/Codex hook helpers
- write-only outbox for mutating calls when the service is unavailable

## Install

```bash
pi install git:github.com/joelhooks/pi-rhizomatic
```

For local package development:

```bash
npm install
npm run check
```

## Configure

No service URL is hardcoded. Resolution order:

1. `RHIZOMATIC_SERVICE_URL`
2. project `.pi/rhizomatic.json`
3. user `~/.pi/agent/rhizomatic.json`
4. user/system `$XDG_CONFIG_HOME/rhizomatic/config.json` or `~/.config/rhizomatic/config.json`

Example config:

```json
{
  "serviceUrl": "http://127.0.0.1:7331",
  "tokenEnv": "RHIZOMATIC_TOKEN",
  "outboxDir": "~/.rhizomatic/outbox"
}
```

`pi-rhizomatic init` is dry-run by default:

```bash
pi-rhizomatic init
pi-rhizomatic init --write --service-url http://127.0.0.1:7331
```

## Local reference service

```bash
pi-rhizomatic serve --store ./rhizomatic.jsonl --host 127.0.0.1 --port 7331
```

The reference service is open by default on localhost. If you expose it beyond localhost, set `RHIZOMATIC_TOKEN` and clients should use the same token through env/secret references.

## CLI examples

```bash
pi-rhizomatic health
pi-rhizomatic contract
pi-rhizomatic call begin-session --json '{"runtime":"pi","runtimeSessionId":"demo"}'
pi-rhizomatic call remember --json '{"about":"canary:pi","attribute":"status","value":"seen","kind":"canary"}'
pi-rhizomatic call recall --json '{"query":"canary"}'
pi-rhizomatic canary --local
pi-rhizomatic canary --label canary:flagg-001
pi-rhizomatic drain
```

Generate OpenAPI:

```bash
pi-rhizomatic openapi --out schemas/rhizomatic.openapi.json
```

## Hook helpers

The hook helpers read runtime hook JSON from stdin and emit JSON for the host runtime.

```bash
pi-rhizomatic hook session-start --runtime claude
pi-rhizomatic hook stop --runtime claude
pi-rhizomatic hook session-start --runtime codex
pi-rhizomatic hook stop --runtime codex
```

Private deployments decide where to install those hooks and which endpoint/store they use.

## Pi commands

- `/rhizomatic status`
- `/rhizomatic briefing`
- `/rhizomatic contract`
- `/rhizomatic drain`
- `/rhizomatic call <primitive> <json>`

Pi tools use explicit names like `rhizomatic_begin_session`, `rhizomatic_briefing`, `rhizomatic_remember`, and so on.

## Network canary bar

A full network canary is not just "Pi can write a fact." `pi-rhizomatic canary` performs the shared-store proof against the configured service. It means Pi, Claude, and Codex each:

1. begin a session,
2. receive/read a briefing,
3. remember a runtime-specific canary claim,
4. recall all three runtime claims from the same store,
5. end the session,
6. leave attributed begin/end records in the same store.

Anything less is a local demo.
