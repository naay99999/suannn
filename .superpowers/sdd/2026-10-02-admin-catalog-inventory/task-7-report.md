# Task 7: Repeatable catalog and stock demo seed

**Status:** DONE

## Implementation

- Added an explicit development/test CLI parser, optional leading `--` handling, deterministic per-kind UUIDs, strict HTTPS asset-base validation, local env loading, non-secret summary output, and connection cleanup.
- Added a pure typed fixture builder for 8 products, 12 variants, 16 lots, 18 operations, 18 movements, and 48 audit records. It applies existing product normalizers/publication policy, audit metadata validation, and Bangkok-relative date policy.
- Added an atomic transaction guarded by `pg_advisory_xact_lock(20261002, 1)`. It checks the actual database name, active owner under the configured MFA policy, active MAIN warehouse, complete manifest reruns, partial fixtures, and reserved slug/SKU/lot-code collisions before inserting.
- Added integration coverage for creation and foreign-key links, unchanged reruns, partial fixtures, collisions, actor/database guards, injected rollback, concurrent invocations, unchanged settings, and no orders/reservations/outbox work.
- Added the `db:seed:demo` package command and setup/asset mapping documentation. No schema or migration changes.

## TDD evidence

**RED:** Before implementation, `bun test test/unit/seed-demo.test.ts` failed because `../../src/cli/demo/fixtures` did not exist. This was the expected missing implementation for the new fixture contract.

**GREEN:**

- `bun test test/unit/seed-demo.test.ts` — 6 passed, 0 failed, 73 assertions.
- `bun --filter api test:unit` — 239 passed, 0 failed, 2,753 assertions across 36 files.
- `bun --filter api typecheck` — passed.
- `bun --filter api lint` — passed.
- `bun test/require-test-database.ts && bun test test/integration/seed-demo.test.ts` — 7 passed, 0 failed, 34 assertions. `TEST_DATABASE_URL` was built in memory from the local API URL with its path changed to `/suannn_test`, inherited explicitly by the child process, and verified by the existing helper before its schema reset. PostgreSQL emitted expected `NOTICE` messages while resetting the test schema.

The integration runner loaded the local env file without displaying it, derived a dedicated test URL in memory, and explicitly passed it to the child process. The safe invocation pattern was:

```sh
bun --env-file=/Users/naay/workspace/naay/suannn/apps/api/.env.local -e '
const derivedUrl = new URL(process.env.DATABASE_URL!)
derivedUrl.pathname = "/suannn_test"
const childEnv = { ...process.env, TEST_DATABASE_URL: derivedUrl.toString() }
const test = Bun.spawn(["sh", "-c", "bun test/require-test-database.ts && bun test test/integration/seed-demo.test.ts"], {
  cwd: "/Users/naay/.codex/worktrees/admin-catalog-inventory/suannn/apps/api",
  env: childEnv,
  stdout: "inherit",
  stderr: "inherit",
})
process.exitCode = await test.exited
'
```

## Self-review

- All required manifest counts and IDs, Thai product names, statuses, variant pricing/SKUs, lot states/quantities, receipt/loss balances, audit actions, and Bangkok-relative dates are covered.
- The fixture builder and transaction do not import or start the runtime API, call email/Stripe/network paths, create orders/reservations/outbox rows, or modify settings.
- No development database seed was executed. A real development run still needs the operator's hosted HTTPS asset base and active owner email.

## Files changed

- `apps/api/src/cli/seed-demo.ts`
- `apps/api/src/cli/demo/fixtures.ts`
- `apps/api/src/cli/demo/seed.ts`
- `apps/api/test/unit/seed-demo.test.ts`
- `apps/api/test/integration/seed-demo.test.ts`
- `apps/api/package.json`
- `apps/api/README.md`
- `apps/admin/README.md`
