# Setup and verification

## Current status

The four schema migrations are applied to the selected `gd menu` project.
The live PostgreSQL smoke test passed and rolled back all test data. Hosted
application features, HTTP APIs, Auth emails and Storage byte validation are
not implemented or verified. Never execute platform-fixture.sql on Supabase.

## Local Supabase

Install the current Supabase CLI and Docker from their official documentation.
Discover commands with `supabase --help` and the relevant subcommand `--help`.
From the repository root:

```bash
supabase start
supabase db reset
```

`db reset` is for the disposable local development database only. Do not point a
reset command at an existing remote factory database. The local config disables
public sign-up and includes empty application data plus reference colors.

## Hosted Supabase

1. Identify the correct connected account and project. Inspect existing tables
   and migration history. Do not choose an unrelated project based only on access.
2. Link the CLI to that exact project or apply the ordered migrations through the
   connected Supabase migration tool. Review the pending migration list first.
3. Apply core, security, catalog/reports and storage migrations in that order.
   Preserve each successful migration in history; do not replay successful DDL.
4. Apply `supabase/seed.sql` once if reference colors and company settings are wanted.
5. In the hosted Auth settings, explicitly disable public sign-ups and anonymous
   sign-ins. **Local config.toml does not automatically configure hosted Auth.**
6. Set the real site URL, approved password-reset/invitation redirect URLs, SMTP
   sender, password policy, session settings and appropriate Auth rate limits.
7. Ensure only public API schemas are exposed; never expose `private`. Confirm
   all factory tables have RLS and no anonymous base-table grants.
8. Obtain the project URL and publishable key for the frontend configuration.
   Store the secret/service key only in server secrets, never in source control.
9. Run Supabase security/performance advisors. Investigate deliberate view-owner
   projections against the documented allowlists and denied base-table reads.
10. Verify the live Auth/Storage/Data APIs with real staff sessions and an anon key.

## First Super Admin

No default username, password or seeded administrator exists.

Use the Supabase Auth admin API to create or invite the initial owner deliberately.
After the Auth user exists, a **trusted server service client** may call:

```sql
select public.bootstrap_super_admin('ACTUAL_AUTH_USER_UUID', 'Actual staff name');
```

This example intentionally has a non-executable placeholder. Replace it with the
actual created Auth user's UUID. The function is executable only by service_role,
serializes bootstrap, and refuses to run after a Super Admin already exists.

For subsequent staff, implement a server route that verifies the current caller
is an active Super Admin, creates an Auth invitation, and provisions the profile
and initial role using the service client. Do not expose that client to a browser.
Subsequent role/permission changes can use set_staff_access after sign-in.

Profile provisioning and invitation sending are **not implemented** in this
schema-only delivery. Do not enable public registration to bypass this work.
Password reset/session UI and server-side identity validation also remain future
application work. SQL cannot verify an email delivery or a redirect workflow.

## Post-application smoke checks

- Inspect every base table's RLS and every function's EXECUTE grants.
- Anonymous Data API: published public projections allowed; molds, costs, events,
  audit records and private settings denied.
- Authenticated non-staff: no private rows; cannot create a profile or role grant.
- Supervisor: may append allowed events; cannot publish or edit finalized history.
- Viewer: no writes. Disabled staff: immediate data access denial.
- Public media IDs: only approved published content is signed; private/draft IDs
  return 404. Guessed Storage object keys never grant access.
- Test valid image uploads and invalid/oversized/mislabeled files through the real
  Storage API. Embedded database tests do not exercise MIME/size handling.
- Add a draft mold, inspect public absence, publish and inspect public presence.
- Record a maintenance and chrome event and verify dates/totals/reminders.
- Run dashboard and collection queries with realistic data and EXPLAIN ANALYZE.

Do not describe Auth, hosted APIs, uploads, imports, QR or the UI as verified until
those checks have actually been implemented and run.
