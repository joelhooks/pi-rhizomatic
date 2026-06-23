# pi-rhizomatic Vision

## Intent

`pi-rhizomatic` is the portable Pi adapter for Rhizomatic agent memory.

It exists to give Pi, Codex, Claude, and adjacent agent runtimes a typed memory contract that can point at a real Rhizomatic/Chorus service without hardcoding one deployment, copying upstream theory, or turning a local reference server into fake durable truth.

This repo is an adapter and canary harness. The durable substrate, witness model, and deeper semantics belong to upstream Rhizomatic/Chorus implementations.

## Who It Serves

- Agents that need shared memory primitives across runtimes instead of one-off prompt scraps.
- Operators who need a portable HTTP contract, hook helpers, and outbox behavior that fail open when memory is unavailable.
- Future Rhizomatic/Chorus service backends that need a small client surface from Pi without vendored code or private topology.

## Product Bet

The bet is portability over local cleverness.

`pi-rhizomatic` should make the memory boundary explicit: schemas, OpenAPI, Pi tools, hooks, canaries, and backend adapters. It should not pretend that its localhost reference server is the real memory system. The reference server is a development aid; the `chorus-http` adapter is the production-shaped path.

## Priorities

1. **Contract first.** Keep schemas, command output, and generated OpenAPI as the stable interface agents can rely on.
2. **Backend portability.** Support real Chorus/Rhizomatic services through adapters instead of baking in one local deployment.
3. **Fail-open agent hooks.** Hook helpers should be strict enough for Codex/Pi/Claude runtimes, but unavailable memory should not break the agent session.
4. **Source-grounded attribution.** Credit upstream Rhizomatic/Chorus work and avoid copying spec text, conformance vectors, or implementation code into this repo.
5. **Canaries over claims.** A useful memory integration proves cross-runtime begin, briefing, remember, recall, and end-session behavior against the same store.

## Non-Goals

- Do not vendor upstream Rhizomatic, Chorus, spec text, or conformance vectors.
- Do not treat the local reference service as production Rhizomatic semantics.
- Do not hardcode private service URLs, hostnames, tokens, account names, or operator topology.
- Do not make memory availability a hard dependency for agent startup unless explicitly configured by the operator.
- Do not invent trust, witness, policy-lens, contested-fact, or time-travel behavior in the adapter when the backend does not support it.

## Merge By Default

Merge small, tested changes that:

- tighten schemas, command envelopes, OpenAPI generation, or typed client behavior;
- improve `chorus-http` compatibility without copying upstream internals;
- make hooks stricter, safer, and easier to install;
- improve outbox drain/retry behavior without hiding failures;
- add canary receipts that prove cross-runtime shared-store behavior;
- clarify public docs while keeping private deployment details out.

## Needs Owner Sign-Off

Stop for explicit approval before:

- changing the public primitive names or request/response schema shapes;
- changing default config resolution or hook install behavior in a way that mutates user files;
- promoting the local reference server as a production backend;
- adding a persistent dependency, hosted service assumption, or private deployment detail;
- changing attribution or upstream relationship language;
- making memory failures block normal agent execution by default.

## Evidence Of Progress

This repo is getting better when:

- `npm run check` passes after contract or adapter changes;
- generated OpenAPI matches the current typed schema surface;
- `pi-rhizomatic canary` proves multiple runtimes can share one configured store;
- the outbox makes unavailable-service writes inspectable and drainable;
- the `chorus-http` backend works against a real Chorus server without vendored upstream code;
- docs make the reference-service boundary obvious to agents and humans.
