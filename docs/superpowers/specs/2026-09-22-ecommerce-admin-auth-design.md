# Ecommerce and Admin Authentication Design

**Date:** 2026-09-22

**Status:** Revised after security review; awaiting written-spec re-review

**Scope:** `apps/api` authentication and authorization subsystem

## 1. Purpose

Design a single authentication subsystem for Suannn's customer storefront and
single-tenant admin backoffice. The system must keep customer and staff
identities distinct while reusing one Better Auth instance and one user table.
It must support customer email/password authentication, invite-only staff
onboarding, mandatory staff MFA, fixed backoffice roles with granular
permissions, differentiated session policies, and auditable privileged actions.

Success means:

- storefront customers can register, sign in, and check out without being
  forced to verify their email first;
- guests can check out without an account and later claim an order only after
  proving ownership of the matching email;
- nobody can self-register as staff or change their own account type or role;
- a pending staff invitation atomically reserves its normalized email against
  customer sign-up;
- every staff API request is authorized server-side using explicit permissions;
- every active staff account uses TOTP-based MFA with backup codes;
- staff sessions expire after 30 minutes of inactivity or eight hours absolute;
- privileged security and business events are traceable without logging
  credentials or tokens.

## 2. Existing Context

`apps/api` is a Bun/Elysia API using PostgreSQL, Drizzle ORM, and Better Auth
1.7.5. Better Auth is mounted at `/api/v1/auth`, currently supports
email/password sign-up and sign-in, and exposes a basic Elysia `auth` macro.
The generated schema contains Better Auth's core `user`, `session`, `account`,
and `verification` tables. CORS and Better Auth trusted origins already share
the configured exact-origin allowlist.

The production deployment is expected to use:

- `example.com` for the storefront;
- `admin.example.com` for the backoffice;
- `api.example.com` for the API.

## 3. Decisions and Non-goals

### 3.1 Decisions

- Use one Better Auth instance and one user table.
- Every user has exactly one account type: `customer` or `staff`.
- An email address cannot be both a customer identity and a staff identity.
- Staff accounts are invitation-only.
- Use fixed roles backed by granular permissions.
- Require TOTP and backup codes for all staff accounts.
- Use Better Auth's Admin, 2FA, OpenAPI, and built-in rate-limit capabilities.
- Treat the Admin plugin as a server-side primitive; do not expose its raw HTTP
  administration endpoints as backoffice APIs.
- Route customer sign-up through an application-owned endpoint so it shares
  email-identity serialization and application rate limiting with staff flows.
- Configure email/password sign-up with `autoSignIn: false` and a complete
  `customSyntheticUser` response while keeping `requireEmailVerification:
  false`.
- Configure the Admin plugin with `defaultRole: 'customer'` and enforce exactly
  one role per identity.
- Disable Better Auth session cookie caching explicitly for the first release.
- Send authentication email through Resend SDK calls in Better Auth email
  hooks.
- Store production rate-limit counters in PostgreSQL for the first release.
- A browser profile can have only one active identity at a time. Staff who need
  to test with a customer account must use another browser profile or private
  window.
- Do not require step-up authentication for individual privileged actions once
  the staff session has passed MFA.

### 3.2 Non-goals

- Social login, magic links, and email OTP sign-in.
- Runtime-created roles or a custom-role editor.
- Multiple organizations, merchants, tenants, brands, or branch-specific teams.
- Separate customer and staff Better Auth instances.
- Simultaneous customer and staff identities in one browser profile.
- Trusted-device MFA bypass.
- Security questions or support-agent MFA bypass.
- Building the ecommerce order model itself. This design defines the identity
  and authorization contract required by guest-order claiming; the order
  subsystem owns order and claim-token persistence.

## 4. Architecture

Better Auth remains responsible for identity, credential hashing, email
verification tokens, password reset tokens, sessions, TOTP, backup codes, and
plugin schemas. Application code remains responsible for account-type policy,
staff invitation state, ecommerce permissions, differentiated staff session
enforcement, business invariants, and audit logs.

The API is divided into the following units:

- `src/plugins/auth/auth.ts` composes Better Auth and its plugins.
- `src/plugins/auth/access-control.ts` is the canonical permission statement
  and fixed role mapping.
- `src/plugins/auth/staff-provisioning.ts` exposes a server-only Better Auth
  provisioning primitive with access to the configured password hasher and
  internal auth adapter; it has no HTTP route.
- `src/plugins/auth/index.ts` integrates Better Auth with Elysia and exposes
  a default-deny HTTP endpoint policy plus route guards/macros.
- `src/modules/customer-auth/` owns the serialized customer sign-up endpoint.
- `src/modules/identity-claims/` owns normalized-email reservation and locking.
- `src/modules/staff-invitations/` owns invite, resend, cancel, accept, and
  bootstrap operations.
- `src/modules/staff/` owns staff role, suspension, session, and MFA-management
  routes.
- `src/modules/audit/` owns append-only audit recording and authorized queries.
- `src/database/schema/auth.ts` remains generated by the Better Auth CLI.
- identity-claim, invitation, application-rate-limit, and audit schemas live in
  separate files so auth generation cannot overwrite them.

The Elysia integration exposes four levels of protection:

- `auth: true` requires a valid session;
- `customerAuth: true` additionally requires a customer account;
- `staffAuth: true` additionally requires active staff status, verified email,
  completed MFA enrollment, and a valid staff session lifetime;
- `permission: { resource: ['action'] }` additionally requires every declared
  permission.

Admin route authorization follows this order:

1. validate the Better Auth session;
2. require `accountType=staff`;
3. reject banned or inactive staff;
4. require a verified email;
5. require completed MFA enrollment;
6. enforce staff idle and absolute timeouts;
7. evaluate the endpoint's permission declaration.

Frontend permission checks only control presentation. They are never an
authorization boundary.

### 4.1 Better Auth HTTP exposure policy

The Better Auth catch-all handler is not an unrestricted public surface. The
Elysia adapter applies an explicit allowlist before forwarding requests to
`auth.handler`.

The allowlist is a version-controlled set of method/path pairs covering only
the approved email/password sign-in, sign-out, session inspection/revocation,
email verification, password reset, and account-maintenance flows. Tests
snapshot the set. Newly introduced plugin or Better Auth endpoints remain
denied until intentionally reviewed and added; unused social linking,
impersonation, user creation, and administrative paths are not exposed.

- Every `/api/v1/auth/admin/*` HTTP endpoint is denied. Application-owned staff
  routes apply `staffAuth`, permission checks, target invariants, transactions,
  and audit before calling a Better Auth server API or an application
  repository.
- Raw `/api/v1/auth/sign-up/email` is denied. The storefront calls the
  application-owned customer sign-up route.
- Email/password sign-in remains a Better Auth endpoint, but a pre-request hook
  rejects authentication while the normalized email is reserved as
  `pending_staff`; an invitation cannot temporarily sign in as a customer.
- Only the 2FA challenge endpoints required during sign-in are forwarded
  directly: TOTP verification and backup-code verification. A Better Auth
  request hook rejects `trustDevice: true` on both paths and permits the raw
  endpoints only when Better Auth is completing a pending sign-in challenge,
  not when the caller already has an onboarding or active session.
- TOTP enrollment and backup-code regeneration are exposed only through
  application-owned routes. Raw disable, enrollment, and regeneration paths
  are denied.
- Server-only Better Auth APIs are never surfaced by the HTTP adapter.

The Admin plugin supplies schema, access-control helpers, and server APIs. Its
built-in ACL does not replace Suannn's guards or domain invariants.

## 5. Data Model

### 5.1 Better Auth user extensions

The generated `user` model gains server-controlled fields:

- `accountType`: required enum-like string, `customer` or `staff`, defaulting to
  `customer`;
- `role`: supplied by the Admin plugin; customers use `customer`, while staff
  have exactly one configured staff role;
- `staffActivatedAt`: nullable timestamp set only after successful TOTP
  enrollment;
- `sourceInvitationId`: nullable, unique invitation ID for idempotent staff
  creation and recovery after a partially completed acceptance request.

The Admin plugin also supplies ban fields. The 2FA plugin supplies
`twoFactorEnabled` and its supporting table. Public sign-up input cannot set
`accountType`, `role`, `staffActivatedAt`, ban fields, or 2FA state.

Every application-owned user field must declare its input/output behavior
explicitly. At minimum:

- `accountType` uses `input: false`, `returned: true`, defaults to `customer`,
  and is returned in the authenticated session;
- `staffActivatedAt` uses `input: false` and `returned: false`;
- `sourceInvitationId` uses `input: false` and `returned: false`.

Plugin-owned authorization and security fields must retain equivalent
server-owned behavior. The generated schema and runtime configuration are both
reviewed because a database column constraint alone does not stop Better Auth
from accepting an additional field as API input.

Application services change these fields through narrowly scoped repository
methods or the server-only staff-provisioning primitive. They do not make a
field client-writable merely so a server-side Better Auth call can supply it.

### 5.2 Session extensions

The generated `session` model gains nullable fields:

- `lastActivityAt` for staff idle-time enforcement;
- `absoluteExpiresAt` for the staff eight-hour ceiling.

Both fields explicitly use `input: false` and `returned: false`. In particular,
the public Better Auth `update-session` endpoint cannot extend or initialize
either timeout.

Customer sessions use a Better Auth session lifetime of 30 days. Staff sessions
are additionally rejected when either custom timestamp has expired. A staff
request updates `lastActivityAt` only when its stored value is at least 60
seconds old, avoiding a database write for every request while preserving the
30-minute idle-time guarantee to minute-level precision.

Staff session validation is fail-closed. If either `lastActivityAt` or
`absoluteExpiresAt` is null, the request is rejected and the session is
revoked; it never falls back to customer-like lifetime behavior. Better Auth
cookie caching is explicitly configured with `session.cookieCache.enabled:
false` so role changes, suspension, MFA resets, and revocation take effect on
the next request.

### 5.3 Email identity claims

`identityEmailClaim` is the serialization point for a normalized email. Its
primary key is the normalized email and its state is exactly one of:

- `customer`, linked to one customer user;
- `pending_staff`, linked to one pending invitation and no user;
- `staff`, linked to one staff user.

Database check constraints enforce the valid user/invitation reference for
each state. All identity-creating paths—customer sign-up, staff invitation,
invitation acceptance, owner bootstrap, and any future administrative user
creation—must call the same identity-claim service. Raw Better Auth user-creation
HTTP endpoints are not an alternative path.

The service normalizes the email, starts a PostgreSQL transaction, and obtains
an email-scoped advisory transaction lock before inspecting the claim and user
tables. A new claim row has a unique normalized-email key. This combination
serializes the absent-row case as well as transitions of an existing claim.

- Customer sign-up may transition an unclaimed email to `customer` only after
  Better Auth successfully creates the customer.
- Staff invitation atomically creates `pending_staff` and the invitation.
- Invitation acceptance transitions the same claim from `pending_staff` to
  `staff` after staff creation succeeds.
- A retry repairs a missing active claim from an already-created user while
  holding the same lock; `sourceInvitationId` identifies a partially completed
  staff acceptance.

Because public customer sign-up is application-owned, the email lock remains
held across its Better Auth server call. If post-creation bookkeeping fails,
the unique user email and reconciliation rule keep the email unavailable until
the active claim is repaired. Public callers still receive the generic sign-up
response rather than an identity-state-specific error.

### 5.4 Staff invitations

`staffInvitation` contains:

- ID;
- normalized email;
- assigned role;
- hash of an opaque invitation token;
- inviter user ID;
- creation and expiration timestamps;
- accepted and revoked timestamps;
- created staff user ID after acceptance.

The raw token is never stored. Only one pending invitation may exist per
normalized email. An invitation expires after 48 hours. Resending rotates the
token and invalidates the previous link. Cancelling an invitation releases its
`pending_staff` claim in the same transaction. Customer sign-up or a new invite
may lazily expire an overdue invitation while holding the email lock, then
release and reclaim the email; an expired reservation never blocks the address
forever.

### 5.5 Audit logs

`auditLog` contains:

- ID and timestamp;
- nullable actor user ID; it is null only for explicitly named system events;
- stable action name;
- target type and target ID;
- request ID;
- IP address and user agent for authentication and security events, omitted
  from ordinary business events unless required for an investigation;
- allowlisted JSON metadata.

The application exposes no update or delete route for audit records. Passwords,
cookies, session tokens, invitation/reset/verification tokens, TOTP secrets,
backup codes, and complete authentication URLs are forbidden in audit metadata
and normal logs.

## 6. Roles and Permissions

Routes declare structured resource/action permissions. The initial statement is:

| Resource | Actions |
| --- | --- |
| `catalog` | `read`, `create`, `update`, `delete`, `publish` |
| `inventory` | `read`, `adjust` |
| `order` | `read`, `update`, `cancel`, `fulfill`, `refund` |
| `customer` | `read` |
| `staff` | `read`, `invite`, `change-role`, `suspend`, `revoke-session`, `reset-mfa` |
| `audit` | `read` |
| `settings` | `read`, `update`, `manage-owner` |

The fixed roles are:

| Role | Permissions |
| --- | --- |
| `owner` | Every permission, including `settings:manage-owner` |
| `admin` | Every permission except `settings:manage-owner`; cannot act on an owner |
| `catalog_manager` | Manage catalog and inventory; read orders |
| `fulfillment` | Read orders/customers, update and fulfill orders, read/adjust inventory |
| `support` | Read orders/customers and update/cancel orders; cannot refund |
| `customer` | No backoffice permissions |

The Admin plugin is configured with `defaultRole: 'customer'`. Although the
plugin can represent multiple roles as a comma-separated string, Suannn does
not use that capability. Application validation rejects arrays, commas, and
unknown roles. A database check constraint enforces:

```text
accountType = customer  -> role = customer
accountType = staff     -> role IN
  (owner, admin, catalog_manager, fulfillment, support)
```

Role changes always replace one role with one role; they never append.

The following invariants are separate from the permission matrix:

- at least one active owner must always remain;
- an admin cannot change, suspend, reset MFA for, or revoke sessions of an
  owner;
- users cannot change their own role or account type;
- only an owner can transfer or assign ownership;
- concurrent owner-management requests must not leave the system without an
  active owner;
- only owners and admins may refund orders;
- customer-facing responses never expose auth/plugin fields.

## 7. Customer Authentication

### 7.1 Sign-up and verification

The storefront calls an application-owned email/password sign-up endpoint.
That route applies application rate limiting and the email-identity lock before
calling Better Auth's server-side sign-up API. The raw Better Auth sign-up HTTP
endpoint is denied.

Better Auth is configured with:

```text
emailAndPassword.enabled = true
emailAndPassword.requireEmailVerification = false
emailAndPassword.autoSignIn = false
```

`customSyntheticUser` supplies the complete response shape, including Admin,
2FA, and application-owned fields that are normally returned. A new account
and an existing customer, staff identity, or pending staff claim all receive
the same public status and response shape with no session token. The frontend
then performs an explicit email/password sign-in. For an occupied or reserved
email, the wrapper runs the configured password hash before returning the
synthetic response to reduce timing differences without creating a customer.
A successful new sign-up always creates a customer and sends a verification
email, but verification is not required for that later sign-in or checkout.
Unverified customers cannot claim guest orders or perform other operations that
prove or transfer ownership.

Verification callback URLs must match the configured storefront/admin
allowlist. Duplicate-email behavior, pending staff reservations, and recovery
endpoints return generic responses so callers cannot determine whether an
email belongs to a customer or staff account.

### 7.2 Password reset

Password reset emails use Better Auth's reset hook and a one-hour, one-use
token. Reset completion revokes every other session for the account. A staff
user must still complete MFA at the next sign-in.

### 7.3 Guest checkout integration contract

Guest checkout does not require an auth session. The order subsystem stores a
normalized contact email and a hash of an opaque claim token. To claim an
order, a customer must have a verified email matching the order and present the
claim token. Claiming is transactional and idempotent.

The system never links historical orders solely by matching an email address.
The initial auth implementation provides a reusable verified-customer guard;
the claim endpoint and claim persistence ship with the order subsystem rather
than creating a placeholder order model inside auth.

## 8. Staff Lifecycle

### 8.1 First owner

A server CLI command bootstraps the first owner by creating an invitation
through the same invitation service used by the HTTP API. It does not assign a
password, bypass MFA, or write directly around domain invariants. The bootstrap
event is audited.

### 8.2 Invitation and activation

1. An actor with `staff:invite` submits an email and staff role.
2. The service acquires the normalized email's identity lock and rejects an
   existing customer, pending staff claim, or staff account.
3. One transaction creates the `pending_staff` identity claim and a hashed
   invitation token with a 48-hour expiry.
4. Resend sends a link to `admin.example.com`.
5. The recipient supplies a name and password.
6. While the claim remains `pending_staff`, the server-only Better Auth
   provisioning primitive uses the configured password hasher and auth adapter
   to create the user and credential account with `accountType=staff`, the
   invitation-assigned role, verified email state, and `sourceInvitationId`.
   It does not emit the customer sign-up verification email or issue a session.
7. The application transaction changes the identity claim to `staff` and
   consumes the invitation. Until that transition commits, the sign-in hook
   rejects the pending email.
8. Possession and consumption of the opaque emailed invitation verifies the
   staff email. The API then creates a restricted onboarding session.
9. The restricted session can only enroll and verify TOTP, obtain the initial
   backup codes, sign out, and inspect its onboarding state.
10. Successful TOTP verification sets `staffActivatedAt`; normal staff guards
    then permit access according to role.

Acceptance serializes on both the email identity claim and invitation record.
Database uniqueness on email and `sourceInvitationId` prevents duplicate
accounts, and retry logic recognizes an account already created from the same
invitation before marking the invite accepted. Customer sign-up, invitation
creation, and invitation acceptance cannot claim the same email concurrently.
Concurrent requests therefore yield exactly one identity owner and at most one
successful invitation transition.

### 8.3 Sign-in and session policy

After activation, staff sign-in requires email/password followed by TOTP or a
one-use backup code. Trusted-device bypass is disabled at the server boundary:
TOTP and backup-code verification reject a request containing
`trustDevice: true`; omitting the field or sending `false` never creates the
trusted-device cookie. A staff session starts with `lastActivityAt` set to the
current time and `absoluteExpiresAt` set eight hours later.

Staff sessions are rejected and revoked after 30 minutes without activity or at
the eight-hour absolute deadline. Normal sign-out removes the current session.
Password reset, suspension, role change, and MFA reset revoke all staff
sessions. Staff can list and revoke their own sessions. Authorized owners and
admins can revoke sessions for staff they are allowed to manage.

The Better Auth session-create hook initializes both staff timeout fields on
every path that can issue or rotate a staff session, including password sign-in,
TOTP verification, backup-code verification, and TOTP enrollment. `staffAuth`
rejects and revokes a staff session if either field is missing.

### 8.4 MFA recovery

- owners may reset MFA for any non-self staff account;
- admins may reset MFA only for non-owner staff;
- MFA reset revokes all target sessions and clears `staffActivatedAt`;
- a new enrollment link is sent to the verified staff email;
- the user remains restricted until new TOTP enrollment succeeds;
- no security-question or temporary-MFA-disable path exists;
- recovery for the final owner requires an explicit server CLI command, which
  records an audit event and never reveals existing TOTP secrets or backup
  codes.

Backup codes are displayed once during enrollment and become unusable after a
successful use.

### 8.5 Allowed 2FA operations

The public HTTP surface is purpose-specific:

- onboarding session: enable TOTP, verify the enrollment code, sign out, and
  read onboarding state through application routes;
- sign-in challenge: call the allowlisted Better Auth TOTP or backup-code
  verification endpoint, with trusted-device requests rejected server-side;
  the same raw endpoint is denied when a full session already exists;
- active staff session: regenerate backup codes through an application route
  protected by `staffAuth`; the user must re-enter the account password, old
  codes are invalidated, and the event is audited;
- MFA reset flow: enroll and verify a replacement TOTP secret through the
  restricted recovery session.

Staff cannot self-disable 2FA. Raw enable, disable, TOTP-URI, and backup-code
generation endpoints are not forwarded by the Better Auth HTTP adapter.
`viewBackupCodes` remains server-only and is not called by application code;
stored backup codes are never re-displayed after their initial issuance.

## 9. Email Delivery with Resend

Resend is a bring-your-own email provider called from Better Auth hooks:

- `emailVerification.sendVerificationEmail`;
- `emailAndPassword.sendResetPassword`;
- the staff invitation sender.

Authentication requests do not await provider delivery, reducing timing side
channels. Every detached promise is registered with a background-task tracker
and has an explicit rejection handler; graceful API shutdown gives registered
email sends an opportunity to settle before closing the process. Logs record
only the template type, a provider message ID after provider acceptance, and a
sanitized error. The production sender uses a verified domain.

Required configuration is:

- `RESEND_API_KEY`;
- `AUTH_EMAIL_FROM`;
- `STOREFRONT_URL`;
- `ADMIN_URL`.

Production startup fails when required auth or email configuration is absent.
Delivery failure must be observable and safe to retry through the existing
resend-verification, password-reset request, or invitation-resend operation.
No request should create multiple simultaneously valid tokens unnecessarily.

## 10. Security Controls

### 10.1 Cookies, origins, and redirects

- production auth cookies are `HttpOnly` and `Secure` with an explicit
  `SameSite` policy compatible with same-site subdomains;
- auth cookies remain host-only for `api.example.com` and are not shared across
  every subdomain;
- browser API calls use credentials;
- CORS and Better Auth trusted origins use exact storefront/admin origins;
- redirects and callback URLs are checked against the same explicit allowlist;
- `session.cookieCache.enabled` is pinned to `false` for the first release;
- authorization-sensitive staff state is validated from server-side storage on
  every request.

### 10.2 Rate limiting and abuse resistance

Better Auth's built-in limiter is enabled explicitly and uses PostgreSQL
storage so counters are shared across API instances. Sensitive auth endpoints
that remain client-initiated have tighter custom rules than the global limit,
including sign-in, password reset, verification resend, and 2FA verification.

Better Auth does not apply its limiter to calls made through `auth.api`.
Application-owned routes therefore use a separate PostgreSQL-backed limiter
with namespaced keys. This covers customer sign-up, invitation operations,
staff administration, MFA enrollment/recovery, backup-code regeneration, and
any route that delegates to a Better Auth server API. Sensitive limits are
checked before the delegated call.

Where an email participates in an application-owned rate-limit key, the key
contains a hash rather than the plaintext email. Production must trust a proxy
IP header only when the deployment proxy is configured to overwrite it;
Better Auth's trusted proxy/header configuration and the Elysia limiter must
derive the client IP using the same rule.

### 10.3 Revocation and stale authorization

Role changes, suspension, password reset, and MFA reset revoke relevant
sessions. Staff authorization reads current server-side state. Permission
checks must not depend on client claims or a stale cached role.

### 10.4 Server-owned input enforcement

The HTTP policy and Better Auth schemas provide defense in depth:

- public input cannot write account type, role, staff activation, invitation
  reference, or custom timeout fields;
- the public `update-session` endpoint cannot mutate staff timeout fields;
- role input containing a comma, array, or unknown role is rejected;
- a 2FA verification request with `trustDevice: true` is rejected rather than
  silently accepted;
- raw Admin plugin endpoints cannot be used to bypass Elysia guards or owner
  invariants.

## 11. Error Contract

Application-owned endpoints use the existing `{ code, message }` envelope with
stable codes including:

- `401 AUTHENTICATION_REQUIRED`;
- `401 SESSION_EXPIRED`;
- `403 EMAIL_VERIFICATION_REQUIRED`;
- `403 MFA_ENROLLMENT_REQUIRED`;
- `403 PERMISSION_DENIED`;
- `409 INVITATION_CONFLICT`;
- `410 INVITATION_EXPIRED`.

Public-facing messages do not reveal whether an email exists or which account
type it owns. Better Auth-owned endpoints may retain the Better Auth response
contract so official clients continue to work. Unexpected internal errors are
logged with request IDs and returned through the existing safe error handler.

## 12. Audit Behavior

Business mutations and their audit records share a database transaction when
the operation is application-owned. Better Auth lifecycle events are captured
through supported hooks. The system records successful privileged actions and
denied privileged attempts that are useful for security investigation.

Initial retention is 365 days and remains configurable as an operational
policy. Purging is a privileged maintenance task, not an API available to
backoffice users. Staff invitations, role changes, suspension, MFA reset,
session revocation, owner recovery, product mutation, order status mutation,
and refund operations always identify actor and target.

In production, the normal application database role has insert and authorized
read access to audit data but no update/delete privilege. Retention purge runs
under a separate narrowly scoped database role. If deployment tooling cannot
separate roles initially, the missing database-level protection is recorded as
a production hardening gap rather than treating the absence of HTTP mutation
routes as fully append-only storage.

## 13. Migration and Rollout

1. Configure Admin with `defaultRole: 'customer'`, 2FA, database rate-limit
   storage, `autoSignIn: false`, a complete synthetic user, disabled cookie
   cache, and explicit server-owned user/session fields in Better Auth.
2. Run `bun --filter api auth:generate` and inspect the generated auth schema.
3. Add identity claim, invitation, application rate-limit, and audit schemas
   outside the generated file, including account-type/role check constraints.
4. Run `bun --filter api db:generate` and inspect the SQL migration.
5. Backfill every existing user as `accountType=customer` and role `customer`.
6. Apply the migration in a non-production environment.
7. Create and accept the first owner invitation through the bootstrap CLI.
8. Verify Resend sender-domain configuration and all callback URLs.
9. Deploy the Better Auth HTTP allowlist, identity-claim service, application
   rate limiter, and API guards before exposing admin business endpoints.

No existing user is promoted to staff by migration. Deployment must be safe if
no owner exists briefly before the bootstrap command; in that state all staff
business access remains closed.

## 14. Testing Strategy

Tests use Bun's test runner and inject controllable time and a fake Resend
client. They never send real email.

Required coverage includes:

- each role/permission pair and every denied pair;
- customers failing staff guards even when calling routes directly;
- public sign-up being unable to set account type, role, activation,
  `sourceInvitationId`, ban, or MFA fields;
- `update-session` being unable to mutate `lastActivityAt` or
  `absoluteExpiresAt`;
- default customer role and rejection of arrays, commas, and multi-role input;
- pending staff invitation blocking customer sign-up with the same email while
  returning the generic public response;
- concurrent staff invitation and customer sign-up yielding exactly one email
  identity owner;
- concurrent invitation acceptance and customer sign-up yielding exactly one
  email identity owner;
- invitation conflict, expiry, revocation, resend rotation, and concurrent
  double acceptance;
- cancelled and expired invitations releasing their email reservation;
- the server-only staff-provisioning primitive having no reachable HTTP route;
- direct `/api/v1/auth/admin/*` calls being denied, including with an expired
  custom staff session;
- onboarding sessions being limited to enrollment operations;
- inactive or non-MFA staff being rejected;
- staff sessions with either custom timeout field null being rejected and
  revoked;
- 30-minute idle and eight-hour absolute staff expiry;
- session revocation after role change, suspension, password reset, and MFA
  reset;
- concurrent owner mutations preserving at least one active owner;
- recovery rules preventing admins from resetting owner MFA;
- TOTP and backup-code verification rejecting `trustDevice: true` and never
  creating a trusted-device cookie;
- raw 2FA enable/disable/regeneration paths being denied and application-owned
  paths enforcing their required session state;
- raw TOTP/backup-code verification accepting only a pending sign-in challenge,
  not an onboarding or active session;
- email hooks calling the fake sender and sanitizing logged failures;
- verified-customer guard behavior for the future order-claim integration;
- append-only audit behavior, metadata redaction, and transactional recording;
- Better Auth and application-owned database rate limiting, including delegated
  `auth.api` operations and retry headers;
- a revoked staff session remaining invalid with cookie caching explicitly
  disabled;
- existing OpenAPI generation and hidden internal operations;
- existing health, CORS, error-envelope, and legacy-route behavior.

Validation commands are:

```bash
bun --filter api test
bun --filter api typecheck
bun --filter api lint
```

## 15. Acceptance Criteria

The subsystem is ready for application integration when:

- a customer can sign up, sign in before email verification, verify later,
  reset a password, and maintain a long-lived customer session;
- an external caller cannot create or promote a staff account;
- pending staff invitations reserve their normalized email atomically against
  customer sign-up and invitation acceptance races;
- the first owner and every later staff member enter through an expiring,
  one-use invitation;
- staff cannot use business APIs until email ownership and TOTP enrollment are
  complete;
- staff sessions obey both timeout rules and are promptly revoked after
  security-sensitive account changes;
- all backoffice endpoints declare and enforce permissions server-side;
- raw Better Auth Admin and unsafe 2FA endpoints cannot bypass application
  policy;
- security-sensitive custom fields cannot be supplied through sign-up or
  session-update input;
- public duplicate sign-up is generic while unverified customers can still
  sign in through the explicit second request;
- the fixed role matrix and owner invariants pass automated tests;
- authentication email is sent through Resend without exposing token material;
- rate limits work across API instances through PostgreSQL;
- relevant privileged events appear in redacted, append-only audit logs;
- the API test, typecheck, and lint commands pass.

## 16. Verified Better Auth Behaviors

The security requirements above were checked against Better Auth 1.7.5 in the
workspace and the current official documentation:

- additional fields accept input and are returned by default unless explicitly
  configured otherwise: <https://better-auth.com/docs/concepts/database>;
- generic duplicate sign-up requires email verification or
  `autoSignIn: false`, and plugin fields require a complete synthetic user:
  <https://better-auth.com/docs/authentication/email-password>;
- the Admin plugin defaults to role `user` and represents multiple roles as a
  comma-separated string: <https://better-auth.com/docs/plugins/admin>;
- 2FA verification accepts the client-controlled `trustDevice` option:
  <https://better-auth.com/docs/plugins/2fa>;
- cookie-cached sessions can remain valid until cache expiry after revocation:
  <https://better-auth.com/docs/concepts/session-management>;
- calls through `auth.api` do not consume Better Auth's client-facing rate
  limit: <https://better-auth.com/docs/concepts/rate-limit>.
