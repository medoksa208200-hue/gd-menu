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

**Catalog (public URL, shown in person to customers).** A private, read-only mold catalog: browse by
category, search by code or name, filter by color/shape/dimensions (centimeters), or scan a mold's QR
card with the phone camera to open it. There is no contact, ordering, WhatsApp or marketing content,
and the site is excluded from search engines (`robots.txt`, `noindex` meta and `X-Robots-Tag`).

**Workspace (`/admin`, staff only).**
- Molds: photos, codes, names, categories, colors (palette, custom hex, "available in all colors"),
  dimensions, website visibility switch, QR card to share with a customer.
- Customer tags per mold: New, Best seller, Featured, Trending, Exclusive, Limited, Coming soon. Cards show
  two, the mold page shows all, and the catalog filter can narrow by tag.
- Categories & colors, homepage sections, staff accounts and change history.
- Maintenance & chrome: the last maintenance and last chrome date of every mold, logged in one tap.
- Vehicles & fuel (`/admin/fleet`): vehicles by plate and type (double cab, dababa, ...), fuel fills with odometer
  before/after and photos, expenses and service history (oil, parts, tyres, licences...), a dashboard with cost and
  consumption charts, and alerts for high consumption, odometer errors, unlogged distance, repeated part
  replacements and overdue oil changes.

**Rep tracking (`/admin/tracking`) and the rep app (`/rep`, Android app).**
- Reps are staff accounts with the **Sales rep** role (Staff page). They sign in to the rep app, start the day by
  choosing a vehicle (or "no vehicle") with an odometer reading and photo, and end it with the odometer again.
- During a shift the phone records a GPS point when the rep moves 20 m or every two minutes, queues points on the
  phone and uploads them in batches (nothing is lost without a connection). The Android app (`android/`, built with
  Capacitor and `@capacitor-community/background-geolocation`) keeps recording with the screen off through a
  foreground service; the browser/installed web app records while it is on screen.
- Fuel fills and expenses logged from the phone go into the same fleet tables, in the rep's name.
- Managers see: live positions; every shift with GPS km vs odometer km (a large gap is flagged), new areas, stops of
  5+ minutes, fuel and expenses; each route drawn with known streets in blue and first-time streets in orange; and a
  coverage map of 150 m cells coloured by rep, by visit frequency, or new-in-period, with area per rep.
- Database: `rep_shifts`, `rep_locations`, `rep_cells` (migration `20261104100000_rep_tracking.sql`); reps write only
  through `rep_*` functions that act on their own shift. Tests: `scripts/tracking.test.mjs`.

### Building the Android app

```bash
pnpm build                       # needs the two VITE_ variables
npx cap sync android
cd android && ./gradlew assembleDebug   # needs the Android SDK (ANDROID_HOME) and JDK 21
cp app/build/outputs/apk/debug/app-debug.apk ../public/downloads/gd-rep.apk
```

The APK is published with the site at `/downloads/gd-rep.apk`; the rep app links to it.

## Supabase deployment

The timestamped migrations in `supabase/migrations` are applied in order to
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

The internal Auth identity uses a synthetic `username@<Supabase project hostname>` identifier.
It is created confirmed by the trusted backend, never mailed, and never requested
from the user. Users interact exclusively with username/password fields.

## Performance, caching and hardening

- Public visitors download only the catalog bundle (~140 KB gzip). The staff workspace, charts,
  Excel and QR code libraries are separate chunks loaded on demand; vendor chunks keep stable hashes.
- `public/_headers` sets a strict Content-Security-Policy, HSTS and isolation headers, caches hashed
  `/assets/*` for a year (immutable) and brand/editorial images for 30 days. HTML is revalidated.
- Catalog images are fetched per grid in one query, signed in one batched request and reused from an
  in-memory cache (1 hour public, 5 minutes private) so the browser HTTP cache is effective. Uploads
  are stored with a one-year Cache-Control because object names are random and immutable.
- Catalog search is debounced; search and view analytics are sent once per settled query / page load.
- Edge Functions share `_shared/http.mjs`: 16 KiB JSON body limit, cached CORS preflight, proxy-set
  client IP for rate limiting. Set the `ALLOWED_ORIGINS` function secret (comma-separated site
  origins) to restrict browser callers; without it all origins are accepted.
- Database: covering FK indexes, RLS helpers evaluated once per statement, literal (escaped) LIKE
  search, one-call lifecycle report, 180-day retention for raw search text, and no implicit API-role
  privileges on future objects. Public catalog projections are SELECT-only.

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
