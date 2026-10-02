# Admin Catalog and Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after the human reviews this plan and selects the execution method. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Thai catalog, inventory, and manual reservation workflows backed by every existing API operation in those domains, with a repeatable development demo seed.

**Architecture:** Feature clients infer contracts through Eden's exported `App` type; TanStack Query owns server data and invalidation. Permission-aware pages compose the existing shared shadcn components, with reusable cursor navigation and stock-command retry state. Backend changes are the approved fulfillment catalog-read permission and the standalone demo CLI.

**Tech Stack:** Bun, Elysia/Eden, Drizzle/PostgreSQL, React 19, React Router, TanStack Query/Table, React Hook Form/Zod, Tailwind v4, Base UI/shadcn, Hugeicons, Bun tests and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-02-admin-catalog-inventory-design.md` (approved).

**Planning baseline:** `7e0775d`. Re-read actual files before edits; do not overwrite intervening user changes. The unrelated untracked `docs/reports/2026-09-30-ecommerce-mvp-audit-th.md` is outside this work.

## Global Constraints

- Existing business endpoints only; no schema migration, upload service, warehouse CRUD, bulk actions, or fabricated analytics.
- Add only `catalog:read` to fulfillment; no new catalog mutation permissions for that role.
- Thai catalog/inventory UI; `Asia/Bangkok`, Gregorian calendar; wire expiry dates remain `YYYY-MM-DD`.
- Server pagination defaults to 25, with 25/50/100 options; catalog search debounce is 300 ms.
- Active reservation polling is 30 seconds while visible, plus window focus and expiry refetch.
- Money is integer satang on the wire; parse decimal strings, never floating-point multiplication for money input.
- Match repository TypeScript style: two spaces, single quotes, no semicolons. Follow root/API AGENTS.md.
- Reuse shared UI and semantic tokens; Hugeicons only. Preserve existing customized components and unrelated screens.
- Forms use React Hook Form/Zod, labels/invalid attributes, shared Field/FieldGroup; queries use Eden-derived types.
- Credentialed CORS, session policy, browser mutation rules, and server authorization stay authoritative.
- Do not automatically retry mutations or optimistically update stock. Empty-body stock commands send JSON `{}`.
- No product code before plan approval and execution-method selection. At execution, follow the chosen workflow's workspace-isolation requirements.

## Review Focus

1. A stock request commits but its response is lost: same command/payload must retry with the same key, including after dialog reopen; Task 5 tests this.
2. Fulfillment receives catalog read but a direct URL or forged UI call must not grant catalog writes; Task 1 tests server authorization and Task 3 tests read-only controls.
3. An expiry date crosses UTC/Bangkok midnight or the staff browser uses another timezone: dates and eligibility labels must not shift; Tasks 4 and 6 test this.
4. A staff user revisits page two after changing filters or losing history state: no unrelated cursor or fake global totals/search results; Task 2 tests this.
5. Seed is repeated, interrupted, or invoked against the wrong DB: no overwrite, duplicate, partial commit, or external send; Task 7 tests this.

## Execution map and shared contracts

Execute Tasks 1–8 in order. Tasks 2–6 reuse interfaces from earlier tasks. Task 7 is independent of UI implementation but must match the approved spec; Task 8 validates the complete feature.

All paths below are repository-relative. Route components export `Component` for the existing lazy router. Tests use fresh QueryClients, memory data routers, `spyOn` with restoration, and controlled fetchers. Avoid persistent global `mock.module` substitutions across these new test files. Existing staff/auth tests must continue passing unchanged in behavior.

Feature response aliases are derived from client methods using `Awaited<ReturnType<...>>`; request aliases come from the corresponding Eden method parameters. Do not import API runtime services into the frontend or manually redefine HTTP entity shapes.

Use query-key roots `['catalog']` and `['inventory']`. Resource branches are `products`, `product`, `warehouse`, `lots`, `lot`, `summary`, `movements`, and `reservation`. Include all effective filters and cursor in list keys. Query factories invoke adapter object methods at execution time so tests can spy on the method, not on module loading.

---

### Task 1: Establish the authorized, configurable typed API boundary

**Files:**
- Create: `apps/admin/src/lib/api-url.ts`, `apps/admin/src/lib/api-result.ts`, `apps/admin/src/lib/catalog/api.ts`.
- Modify: `apps/admin/src/lib/api.ts`, `apps/admin/src/lib/auth-client.ts`, `apps/admin/vite.config.ts`, `apps/admin/README.md`.
- Modify: `apps/api/src/plugins/auth/access-control.ts`.
- Test: `apps/admin/test/api-url.test.ts`, `apps/admin/test/catalog-api.test.ts`, `apps/admin/test/api-result.test.ts`.
- Extend: `apps/api/test/unit/access-control.test.ts`, `apps/api/test/unit/products-routes.test.ts`, `apps/api/test/unit/inventory-routes.test.ts`.

**Interfaces:**
- `resolveApiUrl(value: string | undefined, production: boolean): string`: pure parser shared by Vite config and runtime clients. Trim input, require HTTP(S) origin without credentials/path/query/hash, normalize trailing slash; missing nonproduction value returns `http://localhost:6767`. Production missing/invalid values throw a configuration error.
- `createApiClient(baseUrl: string, fetcher?: typeof fetch, client?: QueryClient)`: return `treaty<App>(...).api.v1`, with `fetcher`, `fetch.credentials = 'include'`, and the existing auth-response handler. Export `ApiClient = ReturnType<typeof createApiClient>` and preserve `api` and `getApiHealth` exports.
- `ApiRequestError(status: number, code: string, message: string)`; `apiData<T>(result: { data: T | null; error: unknown; status: number }): T`; `apiEmpty(result: { error: unknown; status: number }): void`; `apiRequest<T>(operation: () => Promise<T>): Promise<T>` converts transport exceptions into status 0 without leaking their text.
- `apiErrorMessage(error: unknown): string` maps known domain codes to Thai and supplies safe network/rate-limit/server fallbacks. Keep existing auth adapter response/message compatibility.
- `createCatalogApi(client: ApiClient = api)` produces `list(query)`, `get(id)`, `create(input)`, `update(id,input)`, `publish(id)`, `unpublish(id)`, `archive(id)`, `createVariant(productId,input)`, `updateVariant(productId,variantId,input)`, `archiveVariant(productId,variantId)`; export singleton `catalogApi` and inferred aliases `ProductSummary`, `ProductDetail`, `Variant`, `CatalogListInput`, `ProductCreateInput`, `ProductUpdateInput`, `VariantCreateInput`, `VariantUpdateInput`.

- [ ] **Step 1: Add failing contract tests.** Use captured fetch requests (pattern in `auth-client.test.ts`) for all ten catalog operations. Assert actual URL/method, credential inclusion, payloads, no doubled `/api/v1`, and successful void responses. Assert unknown 500 responses cannot leak their server message. Include these parser expectations:

```ts
expect(resolveApiUrl(undefined, false)).toBe('http://localhost:6767')
expect(() => resolveApiUrl(undefined, true)).toThrow('VITE_API_URL')
expect(resolveApiUrl(' https://api.example.test/ ', true)).toBe('https://api.example.test')
expect(() => resolveApiUrl('https://api.example.test/path', true)).toThrow()
```

  Extend the complete backend permission matrix with exactly one fulfillment capability, `catalog:read`. Extend the route test auth fake to recognize fulfillment; assert list/detail are 200 and every catalog write is 403 before service invocation. Keep support denied, customer denied, and fulfillment stock commands authorized.
- [ ] **Step 2: Confirm the new tests fail for the missing behavior.** Run `bun test apps/admin/test/api-url.test.ts apps/admin/test/catalog-api.test.ts apps/admin/test/api-result.test.ts` and `bun --filter api test:unit`. Record genuine baseline failures separately; do not weaken expected authorization results.
- [ ] **Step 3: Implement the boundary and role change.** Use `loadEnv(mode, import.meta.dirname, 'VITE_')` in Vite and validate whenever `command === 'build'`; use the same pure resolver in runtime Eden/auth initialization. Keep existing auth methods and hooks. Add catalog methods with Eden inference and data/empty response normalization. Document explicit production build env and matching API origins.
- [ ] **Step 4: Rerun Step 2 commands.** Expect all new and existing unit assertions to pass. Check a 401 still triggers the existing session invalidation and a 403 does not clear unrelated session state.
- [ ] **Step 5: Commit only this task's files** with subject `Add typed catalog client and fulfillment read access`.

### Task 2: Deliver the real product list with reusable cursor navigation

**Files:**
- Create: `apps/admin/src/lib/catalog/queries.ts`, `apps/admin/src/lib/permissions.ts`, `apps/admin/src/hooks/use-cursor-pagination.ts`.
- Create: `apps/admin/src/components/auth/permission-gate.tsx`, `apps/admin/src/components/server-data-table.tsx`, `apps/admin/src/components/query-state.tsx`.
- Create: `apps/admin/src/pages/products/product-detail-page.tsx` as a working read-only detail page, extended by Task 3.
- Modify: `apps/admin/src/pages/products/products-page.tsx`, `apps/admin/src/router.tsx`, `apps/admin/src/components/layout/app-sidebar.tsx`, `apps/admin/src/components/layout/site-header.tsx`.
- Remove: `apps/admin/src/pages/products/data.json` after its import is removed.
- Test: `apps/admin/test/cursor-pagination.test.tsx`, `apps/admin/test/products-list.test.tsx`, `apps/admin/test/catalog-permissions.test.tsx`.

**Interfaces:**
- `hasPermission(session: AuthSession | null | undefined, permission: string): boolean` reads `staff.permissions`; `PermissionGate({ permission }: { permission: string })` uses existing session state and renders an Outlet or Thai access-denied state. Place it beneath ActiveStaffGate.
- `catalogKeys.all`, `.lists()`, `.list(query: CatalogListInput)`, `.detail(id: string)`; `productsQuery(query)` and `productQuery(id)` return query options using `catalogApi`.
- `useCursorPagination(filterNames: readonly string[])` returns `{ cursor, limit, canPrevious, next(nextCursor: string), previous(), first(), setLimit(limit), setFilters(values: Record<string,string | undefined>) }`. URL owns filters/cursor/limit; router history state owns the previous-cursor trail and matching filter signature.
- `ServerDataTable<T>` props: `columns`, `data`, `getRowId`, `isPending`, `isRefreshing`, `error`, `onRetry`, `emptyTitle`, `emptyDescription`, `pagination: { limit, nextCursor, canPrevious, onNext, onPrevious, onFirst, onLimitChange }`. Uses TanStack Table v9 installed APIs and shared Table; no client sorting/filtering/pagination models or row selection unless a later real action needs it.
- `QueryState({ kind, message?, onRetry? })`, where kind is `loading | error | not-found | forbidden | empty`; messages and controls are Thai.

- [ ] **Step 1: Add failing UI tests.** Render through a memory data router with owner/fulfillment/support session query fixtures and spies on `catalogApi.list/get`. Assert API records replace fixture names; 300 ms search debounce; status filter; page size 25; next request carries the returned cursor; filter change removes it; browser back restores the matching filter/trail. Direct page-two links offer first-page recovery without fake previous cursors. Row detail links and detail reload must load real fields and variants. Assert no total-page label, bulk checkbox, or price/stock total absent from the response.

```ts
expect(calls.at(-1)).toMatchObject({ q: 'มะม่วง', status: 'draft', limit: 25 })
expect(calls.at(-1)?.cursor).toBeUndefined() // after filter change
expect(view.queryByRole('button', { name: 'เพิ่มสินค้า' })).toBeNull() // fulfillment
```

- [ ] **Step 2: Run** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/cursor-pagination.test.tsx apps/admin/test/products-list.test.tsx apps/admin/test/catalog-permissions.test.tsx`; verify failure names correspond to missing behavior.
- [ ] **Step 3: Implement the list, read-only detail, and shared navigation.** Route `/products` and `/products/:productId` under `catalog:read`; translate its navigation title to `สินค้า`. Defer create entry and `/products/new` until Task 3 provides the working form. Header title matching must support nested product paths. Use QueryState and server table, explicitly typed row IDs, image fallback, and per-row detail links. The detail shows API fields/variants without mutation controls at this stage. Preserve old `AdminDataTable` for unrelated pages.
- [ ] **Step 4: Rerun Step 2 tests**, including delayed responses resolving out of order: changing filters must not display the previous result under the new filter label. Expect Thai error/retry and empty states, and denied direct routes without catalog requests.
- [ ] **Step 5: Commit** with subject `Connect product list with cursor navigation`.

### Task 3: Complete product and variant editing and publication

**Files:**
- Create: `apps/admin/src/lib/format.ts`, `apps/admin/src/lib/catalog/forms.ts`, `apps/admin/src/hooks/use-unsaved-changes.tsx`.
- Create: `apps/admin/src/pages/products/product-create-page.tsx`.
- Create: `apps/admin/src/pages/products/_components/product-form.tsx`, `apps/admin/src/pages/products/_components/variant-dialog.tsx`, `apps/admin/src/pages/products/_components/product-actions.tsx`.
- Add shared component: `packages/ui/src/components/textarea.tsx` (inspect/add through the repository shadcn workflow; preserve customized files).
- Modify: `apps/admin/src/pages/products/product-detail-page.tsx`, `apps/admin/src/pages/products/products-page.tsx`, `apps/admin/src/lib/catalog/queries.ts`, `apps/admin/src/router.tsx`.
- Test: `apps/admin/test/catalog-forms.test.ts`, `apps/admin/test/product-editor.test.tsx`, `apps/admin/test/unsaved-changes.test.tsx`.

**Interfaces:**
- `parseBahtToSatang(value: string): number` accepts nonnegative plain decimal strings with at most two fractional digits and safe integer result; throws on invalid input. Product form adds the API's positive/range validation. `formatMoney(satang: number): string`, `formatTimestamp(value: string | Date): string`, `formatDateOnly(value: string): string` use THB / `th-TH-u-ca-gregory` / Bangkok.
- `productCreateSchema`, `productEditSchema`, `variantCreateSchema`, `variantEditSchema`; `toProductCreateInput`, `toProductUpdateInput`, `toVariantCreateInput`, `toVariantUpdateInput` convert validated form values to Task 1's inferred inputs. Forms carry `priceBaht` instead of a floating-point price.
- `invalidateCatalog(client: QueryClient, productId?: string): Promise<void>` invalidates catalog list/detail and the inventory root for eligibility-changing mutations.
- `useUnsavedChanges(dirty: boolean)` returns a confirmation-dialog element to render and installs route blocking plus beforeunload only while dirty. Clear dirty state before successful post-create navigation.

- [ ] **Step 1: Add failing form and behavior tests.** Assertions include exact money, optional-field clearing to null, no slug/SKU update payload, retained fields on API errors, and read-only fulfillment. Test last-active-variant archive prevention and server rejection handling. Test dirty route navigation cancel/confirm and successful save navigation without an extra discard prompt.

```ts
expect(parseBahtToSatang('19.90')).toBe(1990)
expect(parseBahtToSatang('0.01')).toBe(1)
expect(() => parseBahtToSatang('1.001')).toThrow()
expect(() => parseBahtToSatang('1e3')).toThrow()
// UI: published product + one active variant => archive control disabled with reason.
// UI: fulfillment sees product fields/prices; no mutation button or editable form.
```

- [ ] **Step 2: Run** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/catalog-forms.test.ts apps/admin/test/product-editor.test.tsx apps/admin/test/unsaved-changes.test.tsx`; confirm new cases fail.
- [ ] **Step 3: Implement editor routes/components.** Cover every spec field and all ten catalog operations. Register `/products/new` before the ID route and expose its list entry only to `catalog:create`. Creation goes to detail so variants can be added. Show a publication checklist, inactive/archived variants, immutable identity fields, and archive/unpublish confirmations. Use the installed shared dialogs/fields/toast and a shared textarea. Add stock links when the stock destination ships in Task 4; until then do not show an inert link. Validate HTTPS images and alt text, and preserve fallback display for load failures.
- [ ] **Step 4: Run Step 2 tests and** `bun --filter @workspace/ui typecheck`. Verify all mutation outcomes invalidate the right queries, 404 has a return path, and unknown network outcome on non-idempotent creation advises checking records before another attempt. Ensure ordinary control focus/keyboard behavior is exercised by user-event, not only direct event dispatch.
- [ ] **Step 5: Commit** with subject `Add product and variant management workflows`.

### Task 4: Deliver inventory reads, variant selection, and stock history

**Files:**
- Create: `apps/admin/src/lib/inventory/api.ts`, `apps/admin/src/lib/inventory/queries.ts`, `apps/admin/src/lib/inventory/forms.ts`.
- Create: `apps/admin/src/components/product-variant-picker.tsx`.
- Create: `apps/admin/src/pages/inventory/inventory-page.tsx`, `apps/admin/src/pages/inventory/lot-detail-page.tsx`, `apps/admin/src/pages/inventory/variant-stock-page.tsx`, `apps/admin/src/pages/inventory/movements-page.tsx`.
- Create: `apps/admin/src/pages/inventory/_components/inventory-navigation.tsx`, `apps/admin/src/pages/inventory/_components/stock-summary.tsx`, `apps/admin/src/pages/inventory/_components/lot-table.tsx`, `apps/admin/src/pages/inventory/_components/movement-table.tsx`.
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/layout/app-sidebar.tsx`, `apps/admin/src/components/layout/site-header.tsx`, `apps/admin/src/pages/products/product-detail-page.tsx`, `apps/admin/src/lib/format.ts`.
- Test: `apps/admin/test/inventory-api.test.ts`, `apps/admin/test/inventory-reads.test.tsx`, `apps/admin/test/product-variant-picker.test.tsx`, `apps/admin/test/inventory-dates.test.ts`.

**Interfaces:**
- `createInventoryApi(client: ApiClient = api)` initially produces `warehouse()`, `summary(variantId)`, `lots(query)`, `lot(lotId)`, `movements(query)`; export singleton `inventoryApi` and aliases `Warehouse`, `Lot`, `StockSummary`, `Movement`, `LotListInput`, `MovementListInput` inferred from calls.
- `inventoryKeys.all` and resource key builders from the execution map; factories `warehouseQuery()`, `stockSummaryQuery(variantId)`, `lotsQuery(query)`, `lotQuery(id)`, `movementsQuery(query)`.
- `VariantSelection = { productId: string; variant: Variant; productName: string }`; `ProductVariantPicker({ value, onChange, disabled? })` with `value: VariantSelection | null` and `onChange(selection: VariantSelection | null): void`. Product search is paginated; choose product then an active variant. Pass `productId` in stock links for reloadable optional display context, but verify the selected variant belongs to that product before labeling it.
- `bangkokInputToIso(value: string): string` validates calendar/time components and converts `YYYY-MM-DDTHH:mm` with explicit `+07:00`; no browser-local Date interpretation. Empty received-at is handled by omission in Task 5.

- [ ] **Step 1: Add failing adapter/read UI tests.** Assert all five read endpoints and filters, MAIN from response, zero-stock rows retained, quarantined/expired rows retained, proper positive/negative deltas, and variant IDs displayed when metadata is absent. Assert selection performs catalog search then one selected detail request, never a whole-catalog scan or per-row detail fetching. Cover stock detail reload without router state and support denial.

```ts
expect(bangkokInputToIso('2026-10-02T00:30')).toBe('2026-10-01T17:30:00.000Z')
expect(() => bangkokInputToIso('2026-02-30T12:00')).toThrow()
// formatDateOnly('2026-10-02') must show day 2 in Gregorian 2026 under any browser TZ.
```

- [ ] **Step 2: Run** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/inventory-api.test.ts apps/admin/test/inventory-reads.test.tsx apps/admin/test/product-variant-picker.test.tsx apps/admin/test/inventory-dates.test.ts`; confirm missing behavior failures.
- [ ] **Step 3: Implement inventory read routes and catalog links.** Put all inventory routes beneath `inventory:read`, add `สต็อก` navigation, and use Task 2's cursor/table/state components. Context nav links lots and movements; add reservations only in Task 6. Summary labels distinguish physical, held, eligible, and sellable values. Map wire statuses to Thai without deriving false quantities. Lot history uses its actual lot filter, not client filtering. Received/expiry fields use Task 3/4 formatters.
- [ ] **Step 4: Rerun Step 2 tests.** Also execute the date test with `TZ=UTC` and `TZ=America/Los_Angeles`; results must preserve Bangkok semantics and date-only values. Check keyboard product selection and lack of duplicate or stale selection when search changes.
- [ ] **Step 5: Commit** with subject `Add inventory views and variant selection`.

### Task 5: Implement stock commands with recoverable retries

**Files:**
- Create: `apps/admin/src/lib/inventory/command-attempt.ts`, `apps/admin/src/hooks/use-inventory-command.ts`.
- Create: `apps/admin/src/pages/inventory/receive-lot-page.tsx`, `apps/admin/src/pages/inventory/_components/lot-command-dialog.tsx`.
- Modify: `apps/admin/src/lib/inventory/api.ts`, `apps/admin/src/lib/inventory/queries.ts`, `apps/admin/src/lib/inventory/forms.ts`, `apps/admin/src/pages/inventory/inventory-page.tsx`, `apps/admin/src/pages/inventory/lot-detail-page.tsx`, `apps/admin/src/router.tsx`.
- Test: `apps/admin/test/inventory-command.test.ts`, `apps/admin/test/inventory-forms.test.ts`, `apps/admin/test/inventory-mutations.test.tsx`; extend `apps/admin/test/inventory-api.test.ts`.

**Interfaces:**
- Extend adapter with `receive(input,key)`, `quarantine(lotId,{ reason },key)`, `releaseQuarantine(lotId,key)`, `writeOff(lotId,input,key)`, `adjustCount(lotId,input,key)`. Infer `ReceiveInput`, `WriteOffInput`, `CountAdjustmentInput` from Eden methods.
- `invalidateInventory(client: QueryClient): Promise<void>` invalidates `['inventory']` and catalog lists/details whose purchase eligibility may change; broad inventory invalidation is intentional because quarantine can cancel other reservations.
- `createCommandAttempt<T>()` returns an in-memory controller: `prepare(command: string,payload:T): { key:string; payload:T }`, `markUncertain()`, `complete()`, `reject()`, `snapshot()`. State is `idle | prepared | uncertain`. Preparing identical command/payload reuses its immutable key and deep-cloned payload; changed input while prepared/uncertain throws `UNRESOLVED_COMMAND`. `complete/reject` clear it only after a known outcome.
- `useInventoryCommand<TInput,TResult>({ command, execute })` returns `{ submit(input), retry(), isPending, error, uncertain, result }`, where execute takes `(input,key) => Promise<TResult>`. Its controller is owned by the mounted page above dialogs; closing/reopening does not reset it. status 0 and 5xx remain uncertain; known 4xx are rejected outcomes, followed by refresh for conflicts. Every new request must pass permission/status checks again.
- `receiveLotSchema`, `writeOffSchema`, `countAdjustmentSchema`, `quarantineSchema` validate API limits; count reason pattern is `^[a-z][a-z0-9._-]{0,99}$`. All receipt selection sends the server-resolved MAIN ID.

- [ ] **Step 1: Add failing command and UI tests.** Capture POST requests to cover same-key retry, JSON `{}` for release, duplicate clicks, field preservation, no auto-retry, and changed payload blocked while unresolved. Include this state-machine assertion:

```ts
const attempt = createCommandAttempt<{ quantity: number }>()
const original = attempt.prepare('receipt', { quantity: 3 })
attempt.markUncertain()
expect(attempt.prepare('receipt', { quantity: 3 }).key).toBe(original.key)
expect(() => attempt.prepare('receipt', { quantity: 4 })).toThrow('UNRESOLVED_COMMAND')
attempt.complete()
expect(attempt.prepare('receipt', { quantity: 4 }).key).not.toBe(original.key)
```

  UI tests simulate successful server mutation followed by dropped response, close/reopen the dialog, explicitly retry, and assert one logical stock change and the same submitted key. Test quarantine warning mentions cancelled holds, count adjustment is an absolute count including zero, and write-off requires one of the three supported reasons.
- [ ] **Step 2: Run** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/inventory-command.test.ts apps/admin/test/inventory-forms.test.ts apps/admin/test/inventory-mutations.test.tsx apps/admin/test/inventory-api.test.ts`; confirm targeted failures.
- [ ] **Step 3: Implement receipt and lot dialogs.** Use Thai pending/success/error copy, RHF/Zod, permission checks, confirmation summaries, and Task 3 dirty-form protection. Receipt defaults received-at to omitted; optional quarantine requires a reason only when enabled. Warn on expired receipt without inventing a prohibition the API lacks. Read-only/terminal state rules reflect existing backend behavior; rejected commands refetch and explain the new state. Refetch is not proof an uncertain POST never committed; do not silently clear an unresolved attempt merely because a refresh succeeded.
- [ ] **Step 4: Rerun Step 2 tests.** Verify receipt/adjustments refresh lot, stock, history, and reservation query roots; closing a dialog does not cancel an already-sent command. On page reload, show normal fresh records and document that the previous in-memory retry key is no longer recoverable; do not implement secret/payload localStorage persistence or imply cross-reload exactly-once guarantees.
- [ ] **Step 5: Commit** with subject `Add inventory receipt and adjustment commands`.

### Task 6: Complete manual reservation workflows

**Files:**
- Create: `apps/admin/src/pages/inventory/reservation-lookup-page.tsx`, `apps/admin/src/pages/inventory/reservation-create-page.tsx`, `apps/admin/src/pages/inventory/reservation-detail-page.tsx`.
- Create: `apps/admin/src/pages/inventory/_components/reservation-lines.tsx`.
- Modify: `apps/admin/src/lib/inventory/api.ts`, `apps/admin/src/lib/inventory/queries.ts`, `apps/admin/src/lib/inventory/forms.ts`, `apps/admin/src/pages/inventory/_components/inventory-navigation.tsx`, `apps/admin/src/router.tsx`.
- Test: `apps/admin/test/reservation-forms.test.ts`, `apps/admin/test/reservation-flow.test.tsx`; extend `apps/admin/test/inventory-api.test.ts`.

**Interfaces:**
- Extend adapter with `reserve(input,key)`, `reservation(id)`, `confirmReservation(id,key)`, `releaseReservation(id,key)`; export inferred `ReserveInput`, `Reservation`.
- `reservationQuery(id)` uses `inventoryKeys.reservation(id)` and dynamic 30-second visible-page refetch while active, no background interval; refetch on window focus. Detail schedules expiry refetch from the server timestamp and clears timers on route change/unmount.
- `reservationSchema` validates 1–50 distinct variant IDs, quantities 1–1,000,000, optional nonblank external reference up to 255 characters. Reuse picker, command hook, and dirty-form hook.

- [ ] **Step 1: Add failing flow tests.** Assert create redirects to returned ID, lookup rejects malformed UUID without HTTP, allocation rows retain lot IDs, copying ID reports success/failure, and no fake reservation list is rendered. Invalid forms cover zero lines, 51 lines, duplicate variants, and quantity bounds.

```ts
// At active expiry: commands disable and exactly one expiry refetch is requested.
// After response status='expired': no confirm/release button may submit a command.
// A successful confirm sends '{}' and the retained Idempotency-Key, then refreshes stock/history.
```

  Use controlled clocks/fake timers rather than real 30-second sleeps. Assert no polling while document hidden and no timer activity after unmount; a focus refetch can report quarantine cancellation. Confirmation copy explicitly states physical stock consumption.
- [ ] **Step 2: Run** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/reservation-forms.test.ts apps/admin/test/reservation-flow.test.tsx apps/admin/test/inventory-api.test.ts`; confirm missing behavior failures.
- [ ] **Step 3: Implement all three routes.** Reserve and confirm/release require `inventory:adjust`; lookup/detail require read. Use the MAIN ID and let the server allocate lots. Include external reference, expiry, allocations, and status labels for all five statuses. Guard active commands with current server status and displayed expiry; on conflict refresh instead of guessing the transition. Add inventory navigation links and product/lot contextual links only where API data supports them.
- [ ] **Step 4: Rerun Step 2 tests** and Task 5 command tests to ensure reservation actions use the same retry discipline. Check an insufficient-stock error retains lines and does not turn a failed multi-line reservation into separate requests.
- [ ] **Step 5: Commit** with subject `Connect manual inventory reservation workflows`.

### Task 7: Provide the repeatable catalog and stock demo seed

**Files:**
- Create: `apps/api/src/cli/seed-demo.ts`, `apps/api/src/cli/demo/fixtures.ts`, `apps/api/src/cli/demo/seed.ts`.
- Modify: `apps/api/package.json`, `apps/api/README.md`, `apps/admin/README.md`.
- Test: `apps/api/test/unit/seed-demo.test.ts`, `apps/api/test/integration/seed-demo.test.ts`.

**Interfaces:**
- `parseDemoSeedOptions(argv: string[], environment: string | undefined): DemoSeedOptions`, where options are `{ databaseName:string; actorEmail:string; imageBaseUrl:string }`. Require explicit development/test env and exactly the three named CLI arguments in the spec. HTTPS image base must have no credentials/query/hash; normalize a trailing slash so relative paths append correctly.
- `demoId(kind: 'product'|'variant'|'lot'|'operation'|'movement'|'audit', index:number): string`: UUID `d3e00000-0000-4000-8000-` followed by 12 lowercase hex digits of kind offset plus one-based index. Offsets are 0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000 respectively. This manifest also powers completeness/collision checks.
- `buildDemoFixtures({ now, warehouseId, actorId, imageBaseUrl })` returns typed insert rows and the manifest. Pure function, uses existing schema insert types/policy checks and Bangkok calendar helper; no HTTP/email/Stripe imports.
- `seedDemo(db: Database, options: DemoSeedOptions, now?: Date): Promise<{ status:'created'|'already-seeded'; products:number; variants:number; lots:number; movements:number }>` checks real DB name, locks transaction with `pg_advisory_xact_lock(20261002,1)`, validates owner/MAIN, checks all fixture IDs/collisions, inserts atomically, and returns counts. Timestamp defaults to invocation time.
- CLI uses `createDatabase`, local env loading matching other scripts, the pure parser, and `seedDemo`; closes connection in finally. Script value: `bun --env-file=.env.local src/cli/seed-demo.ts`.

**Fixture decisions:**

| Product index | Thai name / category / status | Relative image path | Variants |
| --- | --- | --- | --- |
| 1 | มะม่วงน้ำดอกไม้ / fresh / published | `mango.jpg` | 1–2 |
| 2 | ส้มสายน้ำผึ้ง / fresh / published | `orange.jpg` | 3–4 |
| 3 | อะโวคาโด / fresh / published | `avocado.jpg` | 5–6 |
| 4 | มะม่วงอบแห้ง / processed / published | `products/dried-mango/detail.webp` | 7–8 |
| 5 | แยมส้ม / processed / published | `products/orange-jam/ingredient.webp` | 9 |
| 6 | อะโวคาโดสเปรด / processed / published | `products/avocado-spread/ingredient.webp` | 10 |
| 7 | ชุดผลไม้ทดลอง / fresh / draft | `fruit-hero.jpg` | 11 |
| 8 | แยมส้มรุ่นเดิม / processed / archived | `products/orange-jam/ingredient.webp` | 12 (archived) |

Use slugs `demo-v1-product-01` through `08`, SKUs `DEMO-V1-01` through `12`; variant names `ขนาดเล็ก`/`ขนาดใหญ่` for pairs and `ขนาดมาตรฐาน` for singles. Units are `แพ็ก`; prices are `5000 + variantIndex * 1000` satang, display order is local zero-based order, minimum shelf life two days for fresh and seven for processed. Enable sales for active variants. Supply Thai description and alt text; published/archived timestamps match seeded states. Existing source assets are under `apps/storefront/public/images/`; user-provided image base points to their HTTPS-hosted equivalent, not to an invented public host.

Lots 1–16 use variant `((lotIndex - 1) % 10) + 1`, codes `DEMO-V1-LOT-01`…`16`, received-at one day before now. Lots 1–10 are eligible with 100 units and expiry Bangkok today +60 days; 11–12 are expired with 20 units and expiry yesterday; 13–14 are quarantined with 15 units, future expiry and a Thai reason; 15–16 are depleted by receipt of ten followed by a write-off of ten. All reserved/reversible quantities start at zero. There are sixteen receipt and two loss operations/movements (18 movements total). Use supported audit actions/metadata for creations, receipts, quarantine/loss and final publication/archive transitions; validate metadata with the existing audit helper. No orders, reservations, outbox, external sends, or settings changes are seeded.

- [ ] **Step 1: Add failing parser/fixture tests.** Assert counts 8/12/16/18, six published/one draft/one archived, zero held/reversible quantities, publication validity via the existing helper, total per-lot movement delta equals on-hand, deterministic IDs, valid operation references, and Bangkok-relative expiry. Assert production/absent env, malformed args, and non-HTTPS base rejection.
- [ ] **Step 2: Run** `bun --filter api test:unit`; confirm the new fixture/guard cases fail for absent implementation.
- [ ] **Step 3: Add integration tests using existing DB helpers.** Follow `createTestDatabase`, lock/reset/migrate lifecycle and verify the real `_test` DB. Create an owner fixture only inside tests. Assert first run creates, second run is a no-op including timestamps, user edits survive, a missing manifest row rejects without repair, a reserved slug/SKU collision rejects, wrong actor/database rejects, injected transaction failure rolls back, and concurrent seed calls yield one created and one already-seeded outcome. No test uses a development DB reset.
- [ ] **Step 4: Implement the fixture builder, transaction, and CLI.** Use valid insert rows/foreign keys and supported audit metadata. For already-seeded detection count all manifest table IDs, not just products; do not compare mutable current values to fixtures. Partial presence always fails. Never invoke destructive test helpers from seed code. Do not import runtime `src/index.ts` or start maintenance loops. Preserve current singleton settings. Document exact setup, HTTPS assets, required explicit env, repeat-run behavior, and later order-seed extension.
- [ ] **Step 5: Run** `bun --filter api test:unit`, `bun --filter api typecheck`, `bun --filter api lint`; then from `apps/api`, `bun test/require-test-database.ts && bun test test/integration/seed-demo.test.ts` with a verified `_test` URL. Expect all assertions passing. Assert no fetch/email/gateway path is invoked and there are no seed outbox rows.
- [ ] **Step 6: Commit** with subject `Add repeatable catalog and stock demo seed`.

### Task 8: Verify the complete browser workflow and document delivery

**Files:**
- Create: `apps/admin/test/catalog-inventory-flow.test.tsx`, `docs/reports/2026-10-02-admin-catalog-inventory-verification.md`.
- Modify as needed within scope: prior task files and their tests; `apps/admin/README.md`, `apps/api/README.md` for final usage instructions.

**Interfaces:**
- Consumes all feature routes/adapters and seed CLI above.
- Produces a verification report mapping the spec's 24 method/path operations to a UI entry point and test, with command results and browser evidence. No unsupported claim that later admin sub-projects are complete.

- [ ] **Step 1: Add a cross-page regression test.** Use real route components, a fresh QueryClient/session fixture, and a controlled HTTP boundary rather than mocking successful button handlers. Cover list → detail → create/edit variant → publication → receipt → stock → reserve/release and reserve/confirm, then verify affected queries refetch. A separate fulfillment scenario reads catalog/works inventory while product writes stay absent. Keep server authorization covered by Task 1 route tests, not just hidden-button assertions.
- [ ] **Step 2: Run focused cross-page test** with `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/catalog-inventory-flow.test.tsx`; fix only demonstrated in-scope defects and run affected tests again. Check `rg` finds no `data.json` imports or obsolete template actions in the catalog/inventory pages.
- [ ] **Step 3: Run required aggregate checks once after changes settle.** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test`; `bun --filter admin lint`; `VITE_API_URL=http://localhost:6767 bun --filter admin build`; `bun --filter @workspace/ui typecheck`; `bun --filter api typecheck`; `bun --filter api lint`; `bun --filter api test:unit`; `bun --filter api test:integration` only with verified `_test` DB. If shared UI changed, also run `bun --filter storefront build` and `bun --filter storefront lint` for the affected consumer. Record blocked checks honestly.
- [ ] **Step 4: Verify missing-production-URL rejection** in an isolated temporary copy without `.env*`, using existing dependency links, never by removing the user's local env. Invoke its production build with `VITE_API_URL` unset; expect failure naming that variable. A valid explicit URL must build successfully. Pure parser tests supplement but do not substitute for this build integration check.
- [ ] **Step 5: Perform real-browser acceptance** on a migrated development database, using an existing owner and the documented seed inputs. Do not manufacture credentials or disable MFA. If login/image host is not available, request only those missing inputs and finish independent checks meanwhile. Exercise the exact spec acceptance flow at 1440px desktop and 390px mobile widths, keyboard-only dialogs/picker, direct-link reload, no-session and forbidden routes, network failure/retry, image fallback, dirty navigation, and expiry refresh. Capture relevant screenshots in the report using actual returned artifact paths.
- [ ] **Step 6: Self-review the whole diff and record outcomes.** Check each of the five Review Focus items against its tests, endpoint coverage against spec section 5, and fixture/inert-action removal only in delivered surfaces. Do not add customer/order APIs or unrelated visual redesign to make coverage appear complete. Preserve all user files. Use the selected execution workflow's final independent review before reporting delivery.
- [ ] **Step 7: Commit the verified in-scope changes/report** with subject `Verify admin catalog and inventory workflows`. Report checks, remaining environmental limitations, and which approved sub-project comes next; do not deploy, merge, or push unless separately authorized.

## Plan self-review and handoff

The task boundaries cover spec sections 1–8: shared behavior and role/API config in
Tasks 1–2; catalog in Task 3; inventory reads and picker in Task 4; commands in
Task 5; reservations in Task 6; seed in Task 7; end-to-end acceptance and coverage
in Task 8. All 24 catalog/inventory operations are assigned. No response types,
query-key contracts, or retry controllers require a later task to invent their
shared interface. Source API limits remain the validation source of truth.

Review this plan before execution. Recommended execution method is **Native**:
the eight tasks share adapters, query keys, forms, and retry state, so one
implementer retains useful context; perform a fresh whole-branch review at the
end using the selected workflow. **Subagent-driven** is also available, with a
fresh implementer/reviewer per task and more review/context cost. The human selected Subagent-driven execution with gpt-6-luna and xhigh reasoning on 2026-10-02.
