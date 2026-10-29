# Verification record — 2026-10-29

## Database

Supabase project: gd menu (`uaozbculriwhfilzklyr`). Eight ordered migrations
are applied. All application tables have RLS. Anonymous users have no direct
SELECT grants on factory base tables. Both media buckets remain private.

The earlier rollback-only live smoke test verified temporary mold creation,
automatic child rows, publication isolation, anonymous private-table/report denial,
maintenance/chrome inserts and production cycle/unit aggregates. No test product
remained after rollback.

The local integration suite covers RLS, publication, history immutability,
constraints, storage-path ownership, username provisioning restrictions,
transactional bundle rollback and service-only analytics ingestion.

## Application

TypeScript compilation and the Cloudflare Pages static production build are run
before delivery. Public homepage, bilingual layout and empty catalog states were
inspected in the browser. Staff function denial was checked through the actual
HTTP endpoint (401 without a staff session); owner setup rejected an invalid secret
with HTTP 403. No owner account is fabricated, and no confirmation email is sent.

Actual owner account creation is intentionally left to the recipient of the private
one-time setup link so they choose and enter their password themselves. Tests do
not claim that a real user's password/login was exercised before they create it.

## Deliberate advisor notices

The catalog's [view-owner projections](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
use explicit public columns and publication/approval filters, while base-table
access stays denied. This is intentional and covered by isolation tests.

Public catalog search/collection RPCs are intentionally anonymous; privileged
staff/report RPCs validate live permissions. See the
[function-execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
Private server settings and analytics rate-limit tables have RLS with no client
policy, intentionally denying all ordinary access.

## Practical limits

This is a static React/TypeScript frontend on Pages, not a Next.js server deployment.
PDF exports use browser printing. Imports are transactional per row with visible
per-row failures. File validation includes image decoding/re-encoding, PDF signature,
MIME and size checks, but no external antivirus service. Factory products and sales
must be supplied by authorized staff. Email invitations are replaced with usernames
and passwords by the user's explicit request.
