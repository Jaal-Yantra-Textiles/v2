# partner-ui e2e

Drives the real UI in a real browser. Everything is **local** — the seed writes
to `localhost:9000` and the browser hits the vite dev server. Nothing touches
prod.

```bash
# 1. backend on :9000, then:
cd apps/partner-ui && npx vite --port 5173 --strictPort

# 2. in another shell, from the repo root:
MEDUSA_ADMIN_KEY=sk_... pnpm --filter @jyt/partner-ui e2e      # headed, watchable
E2E_HEADED=0 MEDUSA_ADMIN_KEY=sk_... pnpm --filter @jyt/partner-ui e2e   # headless
```

## Two things that will bite you

**Port 5173, not any port.** The backend's `AUTH_CORS` / `ADMIN_CORS` list
`http://localhost:5173`. On any other port every auth call fails CORS preflight
and the login screen just sits there saying "Failed to fetch" — it does not look
like a CORS problem from the outside.

**The seed must bypass email verification.** `POST /auth/partner/emailpass`
happily returns a token for an unverified partner, so a working API login proves
nothing about the SCREEN: the login page swaps the form for a "verify your
email" panel and never navigates.

## Why `.e2e.mjs`, not `.spec.mjs`

vitest has no config here, so it uses its defaults and picks up
`**/*.spec.mjs` ANYWHERE — including this directory. Named `.spec.mjs`, this
file was collected as a unit test and failed the suite. The extension keeps it
out without bolting a vitest block onto the shared vite config.

## What `action-first.e2e.mjs` covers (#2018)

The phase logic is pure and unit-tested in `src/lib/run-phase.test.ts`. This
covers what a unit test cannot — whether the partner SEES the action before the
spec, which is a question about a rendered page.

Seeds a run in the **offered** phase (the phase the rework is about), then:

- the next action reads "Accept this run", with its hint
- the action sits physically ABOVE the job detail (compared by `boundingBox().y`)
- the job detail is hidden while the run is merely offered
- Details reveals it — hidden, not deleted
- at 400px the action is still on the first screen

Mutation-checked: forcing the gate open (`revealed={true}`) turns three of them
red.

⚠️ An earlier version of the "detail is hidden" check looked for "bill of
materials" / "size set" — text a bare seeded design never renders — so it passed
whether or not the gate worked. It is anchored on the "Summary" heading now.
A check that never runs reads as a pass.
