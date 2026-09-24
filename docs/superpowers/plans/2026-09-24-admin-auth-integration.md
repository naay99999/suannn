# Admin Authentication Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the admin app to the existing staff invitation, MFA, session, and sign-out API flows so only active staff can enter protected pages.

**Architecture:** A focused admin auth adapter uses Eden Treaty for application-owned routes and credentialed fetch for Better Auth routes. One TanStack Query session entry drives route gates and staff identity display. The API remains the authority for session validity and permissions.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, Eden Treaty, React Hook Form, Zod, shared shadcn UI, Bun, Elysia/Better Auth API.

**Spec:** `docs/superpowers/specs/2026-09-24-admin-auth-integration-design.md`

## Global Constraints

- Password recovery and staff management screens are outside this integration.
- Use the existing API routes and exported `App` type; change the API only if a specific response cannot represent a required state.
- Keep all cookies browser managed with `credentials: 'include'`; never store credentials, invitation tokens, TOTP secrets, backup codes, or session tokens in local storage.
- Keep the API's exact-origin CORS, JSON mutation, CSRF, permission, idle-timeout, and absolute-timeout policies intact.
- Never expose raw Better Auth enrollment, backup-code generation, or Admin plugin HTTP endpoints to the admin client.
- Use app-local `@/` imports, shared `@workspace/ui` components, semantic Tailwind tokens, and Hugeicons.
- Preserve existing user edits in `apps/api/AGENTS.md` and the untracked `docs/openapi.json` unless an API contract change specifically requires an OpenAPI update.

## Review Focus

1. A customer session at `/dashboard` must never show admin content; Task 2 pins this in a route test.
2. A transient failure from `get-session` must show retry, not silently redirect to login; Task 2 pins this in a route test.
3. An MFA challenge cookie that expires between login and code entry must return the staff member to login with a clear message; Task 3 pins this in a form test.
4. Refreshing an invitation page after its token was removed from the address bar must fail safely and explain how to reopen the email link; Task 4 pins this in a page test.
5. Signing out must erase cached staff and private query data before navigation; Task 5 pins this in an interaction test.

## File map

| File | Responsibility |
| --- | --- |
| `apps/admin/src/lib/api.ts` | Export the existing Eden client with credentialed requests. |
| `apps/admin/src/lib/auth-client.ts` | Wrap Better Auth HTTP routes and typed staff routes; normalize safe errors. |
| `apps/admin/src/lib/auth-session.ts` | Own session query key, server state classification, and query invalidation. |
| `apps/admin/src/lib/return-to.ts` | Validate an internal return path. |
| `apps/admin/src/components/auth/auth-gate.tsx` | Gate protected and onboarding routes without content flash. |
| `apps/admin/src/pages/login/*` | Connect password login and MFA challenge forms. |
| `apps/admin/src/pages/staff/*` | Invitation acceptance and MFA enrollment pages. |
| `apps/admin/src/router.tsx` | Add auth routes and route gates. |
| `apps/admin/src/components/layout/app-sidebar.tsx` | Show session identity and provide sign-out. |
| `apps/admin/src/lib/query-provider.tsx` | Expose one query client for auth invalidation. |
| `apps/admin/test/*` | Focused client, state, route, and interaction tests. |
| `apps/admin/test/setup.ts` | Register a DOM for React interaction tests under Bun. |

---

### Task 1: Credentialed auth adapter and session model

**Files:**
- Modify: `apps/admin/src/lib/api.ts`
- Create: `apps/admin/src/lib/auth-client.ts`
- Create: `apps/admin/src/lib/auth-session.ts`
- Create: `apps/admin/src/lib/return-to.ts`
- Test: `apps/admin/test/auth-client.test.ts`
- Test: `apps/admin/test/auth-session.test.ts`
- Test: `apps/admin/test/return-to.test.ts`

**Interfaces:**
- Produces: `AuthSession = { session; user; staff? }`, `AuthState = 'anonymous' | 'onboarding' | 'active' | 'customer'`, `getSession(): Promise<AuthSession | null>`, `signIn(email, password): Promise<'challenge' | 'session'>`, `verifyTotp(code)`, `verifyBackupCode(code)`, `signOut()`, `acceptInvitation(input)`, `getOnboarding()`, `beginTotp(password)`, `verifyEnrollment(code)`, `authSessionQuery`, `refreshAuthSession(queryClient)`, and `safeReturnTo(value)`.
- Consumes: `App` from `api`, the API routes in the spec, and `VITE_API_URL`.

```ts
export interface AuthSession {
  session: { id: string; expiresAt: string }
  user: {
    id: string; name: string; email: string; emailVerified: boolean
    image: string | null; accountType: 'customer' | 'staff'
  }
  staff?: {
    role: 'owner' | 'admin' | 'catalog_manager' | 'fulfillment' | 'support'
    permissions: string[]
  }
}

export class AuthRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}
```

- [ ] **Step 1: Write failing adapter and state tests.** Use Bun tests with an injected fake `fetch` so requests and responses are deterministic. Assert that every auth request includes credentials, JSON mutations use `Content-Type: application/json`, sign-in distinguishes `{ twoFactorRedirect: true }` from a completed sign-in, and `get-session` maps a valid staff projection, null, and `SESSION_EXPIRED` correctly. Assert safe error mapping for 400/401, 410, 429, and 500 without returning raw exception text. The state test should include:

```ts
const makeSession = (accountType: 'customer' | 'staff', active = false): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-09-24T12:00:00.000Z' },
  user: {
    id: 'user-1', name: 'Sam', email: 'sam@example.com',
    emailVerified: true, image: null, accountType,
  },
  ...(active ? { staff: { role: 'owner' as const, permissions: [] } } : {}),
})

expect(classifySession(null)).toBe('anonymous')
expect(classifySession(makeSession('customer'))).toBe('customer')
expect(classifySession(makeSession('staff'))).toBe('onboarding')
expect(classifySession(makeSession('staff', true))).toBe('active')
expect(safeReturnTo('https://evil.example')).toBe('/dashboard')
expect(safeReturnTo('//evil.example')).toBe('/dashboard')
expect(safeReturnTo('/orders?status=open')).toBe('/orders?status=open')
```

- [ ] **Step 2: Run the focused tests and confirm they fail** because the adapter and helpers are absent: `bun test apps/admin/test/auth-client.test.ts apps/admin/test/auth-session.test.ts apps/admin/test/return-to.test.ts`.
- [ ] **Step 3: Implement the adapter.** Set `fetch: { credentials: 'include' }` in the Eden client config. Build the Better Auth URL from `VITE_API_URL` with `/api/v1/auth/` and call `fetch(..., { credentials: 'include', ... })`. Parse the documented session projection, not the broad generated Better Auth user schema. Keep response type guards narrow:

```ts
export type SignInOutcome = 'challenge' | 'session'
export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const result = await authJson('/sign-in/email', { email, password })
  return result?.twoFactorRedirect === true ? 'challenge' : 'session'
}

export function classifySession(session: AuthSession | null): AuthState {
  if (!session) return 'anonymous'
  if (session.user.accountType !== 'staff') return 'customer'
  return session.staff ? 'active' : 'onboarding'
}
```

  Use the typed Eden paths `api.auth.staff.invitations.accept.post`, `api.auth.staff.onboarding.get`, `api.auth.staff.onboarding.totp.post`, and `api.auth.staff.onboarding.totp.verify.post` for app-owned routes. Inspect inferred body and error types before finalizing wrappers. Do not add a parallel auth client dependency.
- [ ] **Step 3a: Define query refresh semantics.** Set the auth query to `staleTime: 0`, `refetchOnWindowFocus: 'always'`, and `retry: false`. Make `refreshAuthSession(queryClient)` invalidate the auth query and fetch its fresh result before navigation; it returns the classified server state. Treat a documented `SESSION_EXPIRED` response as anonymous and leave network/server failures as query errors.
- [ ] **Step 4: Run the focused tests, `bun --filter admin build`, and `bun --filter admin lint`.** Fix type or lint failures before continuing.
- [ ] **Step 5: Commit only Task 1 files** with subject `Add admin auth client and session model`.

### Task 2: Protected route gates and session refresh

**Files:**
- Create: `apps/admin/src/components/auth/auth-gate.tsx`
- Modify: `apps/admin/src/router.tsx`
- Modify: `apps/admin/src/lib/query-provider.tsx`
- Modify: `apps/admin/package.json` and `bun.lock` only if the route test dependencies are absent
- Create: `apps/admin/test/setup.ts`
- Test: `apps/admin/test/auth-gate.test.tsx`

**Interfaces:**
- Consumes: `authSessionQuery`, `classifySession`, `getOnboarding`, and `safeReturnTo` from Task 1.
- Produces: `AuthGate({ allow: 'active' | 'onboarding' })`, thin `ActiveStaffGate` and `OnboardingStaffGate` wrappers for React Router, and an exported `queryClient` for auth mutations.

- [ ] **Step 1: Add route tests** using React Testing Library with a memory router and mocked session query. Cover loading without admin content flash; active staff entering `/dashboard`; customer redirect; limited staff redirect to `/staff/onboarding`; anonymous redirect preserving an internal destination; onboarding endpoint rejection; and a thrown network error showing a retry button rather than login. Also cover a focus or route-entry refetch after a revoked session.
- [ ] **Step 2: Set up and run React tests.** Add `@testing-library/react`, `@testing-library/user-event`, `happy-dom`, and `@happy-dom/global-registrator` as admin dev dependencies only if absent; keep the Bun lockfile. Create this preload file:

```ts
// apps/admin/test/setup.ts
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()
```

  Run `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/auth-gate.test.tsx`; confirm the new cases fail before implementing the gate.
- [ ] **Step 3: Implement route gates.** Put `/login`, `/login/mfa`, and `/staff/invitations/accept` outside the protected tree. Wrap the existing `AdminLayout` children with the active-staff gate and the onboarding page with the limited-staff gate. Use the session query's loading and error states explicitly:

```tsx
if (query.isPending) return <AuthLoading />
if (query.isError) return <AuthRetry onRetry={() => void query.refetch()} />
if (state === 'active' && allow === 'active') return <Outlet />
if (state === 'onboarding' && allow === 'onboarding') return <Outlet />
return <Navigate to={destinationFor(state)} replace state={{ from: location }} />
```

  Confirm an onboarding candidate with `getOnboarding()` before rendering enrollment. Use a fixed fallback `/dashboard` for untrusted return paths. Keep the route gate independent of sidebar internals. The two wrapper components pass `allow="active"` and `allow="onboarding"` to this same gate.
- [ ] **Step 3a: Add the concrete auth route tree.** Put a pathless `{ Component: ActiveStaffGate, children: [{ Component: AdminLayout, children: [...] }] }` around every existing admin page. Add `/staff/onboarding` under `OnboardingStaffGate`. Keep the existing not-found page outside the admin layout; ensure unknown admin paths do not reveal protected layout content.
- [ ] **Step 4: Run focused tests, `bun --filter admin build`, and `bun --filter admin lint`.** Review the route tree to ensure no protected sibling bypasses the gate.
- [ ] **Step 5: Commit Task 2 files** with subject `Protect admin routes with staff session`.

### Task 3: Password login and MFA challenge

**Files:**
- Modify: `apps/admin/src/pages/login/_components/login-form.tsx`
- Modify: `apps/admin/src/pages/login/login-page.tsx`
- Create: `apps/admin/src/pages/login/mfa-page.tsx`
- Create: `apps/admin/src/pages/login/_components/mfa-form.tsx`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/test/login-flow.test.tsx`

**Interfaces:**
- Consumes: `signIn`, `verifyTotp`, `verifyBackupCode`, `refreshAuthSession`, `safeReturnTo`, and the router destination state.
- Produces: working `/login` and `/login/mfa` screens.

- [ ] **Step 1: Write failing form tests.** Assert submit loading and disabled repeat submission; invalid credentials displayed at the form; `twoFactorRedirect` navigation to `/login/mfa`; active staff navigation to the safe return destination; customer response denied admin entry; TOTP and backup-code modes; successful challenge refresh; invalid code stays on the form; and an expired challenge returns to login with an explanation. Include the Review Focus expired-cookie case.
- [ ] **Step 2: Run `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/login-flow.test.tsx` and confirm the cases fail.**
- [ ] **Step 3: Connect the existing React Hook Form login form.** Keep its field components, add an async submit handler, display a form-level error, and update password validation to the API's 12-character minimum only where that applies to a newly created password; existing staff login must allow the submitted password without a client-side minimum that could reject legacy credentials. After `signIn`, route challenge outcomes to `/login/mfa`; for session outcomes call `refreshAuthSession` and require `active` before entering the admin tree.
- [ ] **Step 4: Implement the MFA challenge form** with a six-digit TOTP input and a separate backup-code mode. Submit only `{ code }`; never send `trustDevice`. Keep a safe return destination through the challenge route. On missing/expired challenge, send the user to `/login` with a clear message. Use shared `Field`, `Input`, and `Button` components, labels, `aria-invalid`, and pending states.
- [ ] **Step 5: Run the focused tests, build, and lint; then commit** with subject `Connect admin login and MFA challenge`.

### Task 4: Invitation acceptance and authenticator enrollment

**Files:**
- Create: `apps/admin/src/pages/staff/invitation-page.tsx`
- Create: `apps/admin/src/pages/staff/onboarding-page.tsx`
- Create: `apps/admin/src/pages/staff/_components/invitation-form.tsx`
- Create: `apps/admin/src/pages/staff/_components/totp-enrollment.tsx`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/test/staff-onboarding.test.tsx`

**Interfaces:**
- Consumes: `acceptInvitation`, `getOnboarding`, `beginTotp`, `verifyEnrollment`, `refreshAuthSession`, and the onboarding route gate.
- Produces: `/staff/invitations/accept` and `/staff/onboarding` screens.

- [ ] **Step 1: Write failing onboarding tests.** Cover missing token; token removed from visible URL after being read; acceptance payload `{ token, name, password }`; expired/revoked invitation showing a request-new-invite message; acceptance routing to onboarding; password confirmation before enrollment; TOTP URI presentation; backup codes visible and copyable only in component memory; a save acknowledgement before verification; invalid TOTP stays on the screen; successful verification refreshes the staff session; reload after URL cleanup fails safely with an email-link explanation. Confirm no secret is written to `localStorage` or `sessionStorage`.
- [ ] **Step 2: Run `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/staff-onboarding.test.tsx` and confirm the cases fail.**
- [ ] **Step 3: Build the invitation form.** Read the token once from the query string into page memory, then replace the URL without the token. Validate name and password with the API's 1–100 and 12–256 character bounds. Submit through Eden, handle 410 distinctly, and refresh the session before navigating to onboarding. If the page reloads after URL cleanup, show instructions to reopen the invitation email rather than submitting an empty token.
- [ ] **Step 4: Build MFA enrollment.** Obtain onboarding state from the API. Ask for the staff password and call `beginTotp`. Display the returned `totpURI` as selectable text and a link compatible with authenticator apps; show backup codes in a copyable list and require explicit save acknowledgement. Hold URI and codes only in React component memory. Call `verifyEnrollment({ code })`, refresh the session query, and enter `/dashboard` only when the server returns an active staff projection.
- [ ] **Step 5: Run the focused tests, build, and lint; then commit** with subject `Add staff invitation and MFA onboarding`.

### Task 5: Staff identity, sign-out, and final integration

**Files:**
- Modify: `apps/admin/src/components/layout/app-sidebar.tsx`
- Modify: `apps/admin/src/lib/query-provider.tsx`
- Modify: `apps/admin/src/lib/auth-session.ts`
- Modify: `apps/admin/src/lib/api.ts`
- Test: `apps/admin/test/logout-session.test.tsx`

**Interfaces:**
- Consumes: active `AuthSession`, `signOut`, `refreshAuthSession`, and exported `queryClient`.
- Produces: visible staff identity, sign-out action, and centralized response-to-session-expiry behavior for protected API requests.

- [ ] **Step 1: Write failing integration tests.** Assert sidebar name/email come from the session; sign-out disables its control while pending, clears all private cached queries, and navigates to login; a 401 `SESSION_EXPIRED` from a protected API request invalidates the session and routes away; a 403 `PERMISSION_DENIED` leaves the session intact and shows an access message. Include the Review Focus cache-clearing case.
- [ ] **Step 2: Run `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/logout-session.test.tsx` and confirm the cases fail.**
- [ ] **Step 3: Replace sidebar placeholders and wire sign-out.** Use the active session query for name/email. On successful sign-out, call `queryClient.clear()`, then navigate to `/login` with history replacement. On sign-out network failure, keep the existing session state and show a retryable safe error. Centralize handling for protected Eden responses so `SESSION_EXPIRED` refreshes the auth query; preserve 403 permission failures as action-level errors.
- [ ] **Step 3a: Connect the Eden response hook.** Use the supported `onResponse` option in `treaty<App>(url, { fetch: { credentials: 'include' }, onResponse })`. For a protected response with status 401 and code `SESSION_EXPIRED`, inspect a cloned response body and schedule an auth query refresh through the exported query client. Do not turn a 403 permission response into logout. Avoid parsing or logging request bodies, tokens, or cookies.
- [ ] **Step 4: Run all admin tests, build, and lint.** Commands: `bun test --preload ./apps/admin/test/setup.ts apps/admin/test`, `bun --filter admin build`, and `bun --filter admin lint`. If the API changed for a proven contract gap, also run `bun --filter api typecheck`, `bun --filter api lint`, and its relevant unit tests. Run database integration tests only with a verified `_test` database URL.
- [ ] **Step 5: Inspect the final diff and commit Task 5 files** with subject `Finish admin staff session integration`. Verify `apps/api/AGENTS.md` and the untracked `docs/openapi.json` have not been included inadvertently.

## Final acceptance walkthrough

- Open a protected deep link while signed out; after login and MFA, return to that internal path.
- Accept an emailed invitation, save backup codes, verify TOTP, and enter the dashboard.
- Reload as active staff and remain in the protected app without a content flash.
- Sign in with a customer account and confirm the admin tree stays closed.
- Revoke or expire the staff session and confirm the next server check returns to login.
- Sign out and confirm the sidebar identity and cached private data disappear.
