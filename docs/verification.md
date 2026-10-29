# Verification record — 2026-10-29

15 automated integration/security tests passed using embedded PostgreSQL (PGlite),
with the actual four migration files and the pg_trgm extension.

The checks cover public projection isolation; private/draft Storage visibility;
non-staff denial; read-only enforcement; draft/publication/search/homepage flows;
granular publication permissions; maintenance/chrome/production calculations;
immutable completed history; constraints and category cycles; archive/restore;
audit immutability; immediate disabled-staff denial; absence of fake sales;
trusted service insertion with automatic child rows; and file-path ownership.

Supabase Auth/Storage platform tables and request claims are test fixtures.
No live Supabase migrations, Auth emails, Storage upload byte validation, signed
URLs or application UI have been applied or verified.

The existing GitHub repository was verified as medoksa208200-hue/gd-menu and Public.
The user explicitly approved publication of the database and security design
to this Public repository after the initial automatic review rejection. Source
publication is authorized; the actual Git commit is verified during delivery.

Two Supabase connections are available, named Supabase and Primary. The intended
connection and project must be identified before applying a live migration.
