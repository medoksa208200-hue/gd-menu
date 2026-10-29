# GD TABLEWARE INDUSTRY — gd-menu

Bilingual commercial catalog and private mold-management application.

## Hosting

The frontend is a static React/TypeScript build hosted on **Cloudflare Pages**.
PostgreSQL, staff authentication, row-level authorization, private Storage and
privileged account-management functions run on **Supabase**. No Cloudflare Worker
or Pages Function is required. This deployment uses Vite for the static frontend;
it does not depend on a Next.js server runtime.

| Cloudflare Pages setting | Value |
| --- | --- |
| Production branch | main |
| Framework preset | None |
| Build command | pnpm run build |
| Build output directory | dist-pages |
| Root directory | repository root |
| Node | 22.16.0 or newer |
| pnpm | 11.25.0 |

Build environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Only a publishable API key belongs in the frontend. Never add a secret or service
key to a VITE_ variable. The current Pages project is connected to this GitHub repo
and is configured with the project URL and publishable key. No credentials are
committed. The `_redirects` file makes direct catalog and admin URLs resolve.

## Run locally

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
# Populate the two public Supabase configuration values.
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

## Application features

- Arabic/English, RTL/LTR, original GD logo and responsive public/admin layouts.
- Published-only catalog, bilingual code/name search, database pagination,
  dimension/category/color filters, galleries, comparisons and enquiries.
- Configurable categories, public contact settings and marketing collections.
- Username/password staff accounts: no invitations or confirmation emails.
- One-time owner setup protected by an expiring random secret; only its hash is
  stored in private server settings. Ordinary user creation is Super Admin-only.
- Staff creation, role changes, disable/enable and administrator password resets.
- Mold create/edit, transactional specifications/categories/colors/machines,
  draft/publication workflow, duplication, soft deletion and restore.
- Public/private images with client image decoding and re-encoding, storage MIME
  and size restrictions, publication approval, ordering and main-image selection.
- PDF technical documents, private by default, with explicit public approval.
- Historical maintenance/chrome and append-only production logs, photos,
  operating-life aggregates, date/cycle schedules and currency-separated costs.
- Actual dashboard metrics, charts, activity history and printable reports.
- Excel template, import preview and per-row results, Excel exports, QR cards,
  browser printing / Save as PDF. Imports are atomic per mold, not per entire batch.
- Published-only event ingestion on a rate-limited Supabase function; view totals
  deduplicate per visitor hash/day. No raw IP addresses are stored.

The editorial hero artwork is AI-generated and labeled as illustrative. Product
records and sales figures are never fabricated. The live catalog remains empty
until the factory adds and publishes its actual products.

## Supabase deployment

The eight timestamped migrations in `supabase/migrations` were applied in order to
the selected `gd menu` project. Reference colors and company settings are seeded.
Functions in `supabase/functions` are deployed separately on Supabase:

- `gd-owner`: validates the one-use setup secret and provisions the first owner.
- `gd-staff`: validates the caller's current session and Super Admin permission,
  then creates username/password accounts or resets a password.
- `gd-events`: accepts only valid public catalog events and applies a database
  rate limit. It has no access-management behavior.

Functions use Supabase's injected `SUPABASE_SECRET_KEYS` and
`SUPABASE_PUBLISHABLE_KEYS` environment maps, with legacy server-variable fallbacks.
`verify_jwt=false` is intentional: gd-staff verifies the user JWT itself;
gd-owner verifies the one-time setup secret; gd-events is public, rate-limited
analytics. No function treats the absence of a gateway JWT check as authorization.

The internal Auth identity uses a synthetic `username@staff.gd.invalid` identifier.
It is created confirmed by the trusted backend, never mailed, and never requested
from the user. Users interact exclusively with username/password fields.

## Verification and limits

See `docs/verification.md` for actual test evidence and remaining deployment checks.
Database/RLS tests execute in embedded PostgreSQL, with Supabase Auth/Storage table
fixtures. `supabase/tests/live-smoke.sql` is an additional rollback-only live test.
Never execute `platform-fixture.sql` against a real Supabase project.

Image/PDF uploads enforce format/size checks, but this delivery does not provide an
antivirus or external document-conversion service. PDF reports use browser print /
Save as PDF. Default email sign-up settings in Supabase do not grant factory roles:
there is no public registration UI and no anonymous profile/role provisioning.
Owner setup secrets must never be added to this repository or application logs.
