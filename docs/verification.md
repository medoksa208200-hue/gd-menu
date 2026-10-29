# Verification record — 2026-10-29

## Applied database

- Connected account chosen by the user: Supabase.
- Project: gd menu, reference uaozbculriwhfilzklyr.
- Four migrations applied successfully; local migration filenames match the
  actual Supabase migration versions.
- 30 application tables; RLS enabled on all 30.
- Zero anonymous SELECT grants on application base tables.
- Two private buckets, 20 MiB each: catalog-media and factory-files.
- Four staff roles, reference company settings and three reference colors.
- No factory staff accounts, real products or invented sales seeded.

## Tests actually run

15 embedded PostgreSQL/PGlite integration tests passed locally and in
[GitHub Actions](https://github.com/medoksa208200-hue/gd-menu/actions/runs/40874565416).

A separate live PostgreSQL test passed on Supabase. It inserted a temporary Auth
identity, profile and role inside a transaction, then checked automatic mold child
records, draft invisibility, publication visibility, anonymous internal-table and
report denial, maintenance/chrome inserts and production cycle/unit aggregates.
The complete transaction was rolled back. A follow-up query confirmed zero
persisted integration-test molds. No invitation or email was sent.
The reproducible SQL is supabase/tests/live-smoke.sql.

## Advisor findings reviewed

The security advisor still flags these deliberate access patterns; this is not a
claim that every advisor finding is cleared:

- Eight [view-owner projections](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).
  These use explicit public column allowlists and publication/approval filters
  while denying anonymous access to every source table. Default view-owner
  behavior is intentional here; changes require isolation review and tests.
- Two [anonymous SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable):
  bounded public catalog search and homepage collection resolution.
- Six [authenticated SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
  Factory/report/access mutations check live permissions inside the function.
- [No RLS policy on private.system_settings](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  is intentional deny-all for ordinary callers; it has no client grants.

## Remaining work and verification limits

No Next.js UI, public media-signing handler, invitation/password-reset flow,
image byte validation, Excel import/export, PDFs or QR printing has been implemented.
Hosted Auth signup/redirect/SMTP settings have not been changed by these SQL
migrations; local config.toml does not configure hosted Auth. No real Auth HTTP
session or Storage HTTP upload was exercised. Review those settings and verify
those APIs before calling the complete application production-ready.

GitHub publication was explicitly authorized by the user for the Public gd-menu
repository. Credentials are absent from the repository.
