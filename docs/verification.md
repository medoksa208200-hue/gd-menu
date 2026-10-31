# Verification record — 2026-10-29

## Database

Supabase project: gd menu (`uaozbculriwhfilzklyr`). Ordered migrations
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

## 2026-10-30 security fix

The public catalog views had inherited Supabase's default ALL privileges. Simple projections were
auto-updatable, so the anon role could UPDATE/INSERT/DELETE company settings, categories and homepage
sections through them (verified in a rolled-back transaction). `20261029230624_lock_public_views`
restores SELECT-only access and removes implicit default privileges; the test fixture now mirrors
Supabase defaults and a regression test covers writes through every projection.

## 2026-10-30 performance, colors and R2 update

`20261030091000_performance_and_hardening` and `20261030100000_colors_and_r2_media` were applied to
production by the owner through the SQL editor (the combined, idempotent script). Verified afterwards:
`molds.all_colors` and `catalog_molds.all_colors` exist, `get_lifecycle_report`, the editor color
policy, the R2 image constraint and the new indexes are present, no public policy evaluates auth
helpers per row, anonymous search works and the public projections remain read-only. Both files are
idempotent, so re-running them (e.g. `supabase db push`) is harmless.

## 2026-10-30 R2 media connection

The `gd-media` bucket has public r2.dev access and a CORS rule allowing `PUT` (content-type,
cache-control) from `https://gd-menu.pages.dev` and `http://localhost:5173`. With the bucket's
scoped API token, a query-signed PUT built exactly like `gd-media` passed the browser preflight
from the Pages origin, uploaded, was served from the public URL as `image/webp` with the immutable
Cache-Control, and was then deleted. The deployed `gd-media` function matches the repository, and
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_PUBLIC_URL` are set
as Supabase function secrets. A staff upload from `/admin` then created a `mold_images` row with
`bucket_id = 'r2'` (key `molds/<mold id>/<uuid>.webp`); the object is served from the public URL as
`image/webp` (48 KB, immutable Cache-Control) and appears in `catalog_images` for the anon role.

## 2026-10-30 Media cleanup and thumbnails

Deleting a photo in the workspace now goes through `gd-media` (`action: "delete"`): the row is deleted as the
caller (RLS and the approved-media guard still apply), then the file is removed from R2 (with its thumbnail)
or from Supabase Storage with the server key, unless another row still references the same object.
New R2 uploads also store a ~640px WebP thumbnail (`mold_images.thumb_key`, migration
`20261030150000_image_thumbnails`, applied to production); catalog cards and workspace lists load it and fall
back to the full image when it is missing. A schema test covers the thumbnail constraint and its public view.

## 2026-10-31 Mold tags

`20261030160000_mold_tags` adds `molds.tags` (best_seller, trending, exclusive, limited, coming_soon; checked),
exposes it in `catalog_molds`, and adds `search_catalog_tagged(..., tag_filter)`. `search_catalog` keeps its
signature and delegates to it, so nothing is dropped and older clients keep working. `save_mold_bundle` saves
`tags` only when the payload includes it. Applied to production; verified as `anon` through PostgREST that
`search_catalog` and `search_catalog_tagged` return the published molds, `tag_filter=>'new'` returns only the new
mold, and `catalog_molds.tags` is readable. A schema test covers allowed values, de-duplication and the filter.
