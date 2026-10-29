# GD TABLEWARE INDUSTRY · gd-menu

أساس قاعدة بيانات Supabase لكتالوج أسطمبات الميلامين ونظام إدارة المصنع.

**Current delivery: database foundation only.** The Next.js application, login UI,
invitation/reset handlers, file-processing endpoints, imports/exports, PDFs, QR
printing and live deployment are not implemented yet. No live Supabase migration
has been applied by this repository's initial delivery.

## What is included

- PostgreSQL schema, ordered transactional migrations, constraints and indexes.
- Separate public catalog projections and confidential internal records.
- Role and granular-permission checks through database RLS.
- Draft/publication workflow, automatic specification and internal records,
  immutable mold identity, soft archive/restore and metadata-only audit events.
- Append-only production history and protected completed maintenance/chrome events.
- Date/cycle reminders, real analytics/sales sources and currency-separated costs.
- Dynamic categories and independent homepage collections.
- Two **private** storage buckets, path authorization, allowed MIME types and size limits.
- Original supplied GD logo, copied without modification.
- Embedded PostgreSQL tests, GitHub Actions workflow, configuration and setup notes.

## Files

| Path | Purpose |
| --- | --- |
| `supabase/migrations/20261029000100_core.sql` | Entities, relations, types, constraints, indexes |
| `supabase/migrations/20261029000200_security.sql` | Roles, RLS, guarded mutations, access RPCs, auditing |
| `supabase/migrations/20261029000300_catalog_and_reports.sql` | Public allowlist views, search/collections, private reports |
| `supabase/migrations/20261029000400_storage.sql` | Private buckets, file-path policies, event attachment validation |
| `supabase/seed.sql` | Company name and three reference colors; no fictitious sales |
| `supabase/tests/platform-fixture.sql` | Test-only Auth/Storage approximation; never run on Supabase |
| `scripts/schema.test.mjs` | Executable PostgreSQL schema/authorization tests |
| `docs/database.md` | Data model, access rules and media-serving contract |
| `docs/setup.md` | Applying migrations, staff bootstrap, configuration and remaining verification |
| `public/brand/gd-original.jpg` | Original user-supplied logo |

## Run the tests

Requires Node.js 22+ and npm:

```bash
npm ci --ignore-scripts
npm test
```

The tests run **real embedded PostgreSQL through PGlite**, including the actual
migration SQL, pg_trgm, grants, RLS and triggers. Auth/Storage platform tables and
JWT request settings are emulated. This does not verify hosted Supabase Auth,
HTTP/PostgREST, Storage MIME enforcement, signed URLs, emails or concurrent traffic.

## Apply to Supabase

Read `docs/setup.md` first. Select the intended Supabase account and project before
making any changes. These migrations target a **new application database**; they
are not an automatic upgrade for an unrelated existing schema.

No API keys, passwords, account emails or project credentials are included. The
`.env.example` contains only empty configuration slots. Local `.env` files are ignored.

## استكمال المشروع

بعد تحديد مشروع Supabase وتطبيق المايجريشن والتحقق منها، تأتي واجهة الكتالوج
ولوحة الإدارة ثم سير الدعوات ورفع الصور والتقارير وExcel وQR. وجود الاسكيما
لا يعني أن واجهات هذه الوظائف تم تنفيذها أو اختبارها بعد.
