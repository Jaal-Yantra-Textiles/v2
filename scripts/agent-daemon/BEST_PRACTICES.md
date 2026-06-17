# Daemon Best Practices

- Visual-flow executor/graph logic is best tested as a **unit spec** (`*.unit.spec.ts` under `src/**/__tests__/`, `TEST_TYPE=unit`) — no DB boot, dodges the CONCURRENTLY/TRUNCATE deadlock. Make the recursion testable by `export`ing the helper (`@internal`) + accepting an injectable `execOp` last param defaulting to the real one; pass a fake that records call order. (PR #468)
