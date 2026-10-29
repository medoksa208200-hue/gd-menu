# Owner and staff setup

The private one-time owner setup link is delivered separately to the project owner.
It is not in this repository. Open it, choose a staff display name, username and
password, and submit once. The expiring setup secret is consumed atomically.

After setup, sign in at /admin/login. The Super Admin creates other users under
/admin/users by entering a username, password and role. No invitation, email input
or email confirmation is used. Forgotten passwords are reset by the Super Admin.

Usernames use 3–40 lowercase letters/digits/dot/dash/underscore. Passwords must be
8–128 characters with uppercase, lowercase, a number and a special character. Neither password values nor setup secrets belong in source
control, logs, spreadsheets or screenshots.

Storage remains private. Public media downloads are allowed only for paths with
approved media metadata on a currently published, non-deleted mold. Uploads use
immutable random object names; private factory files never receive anonymous
read access.

See deployment-pages.md for Pages build settings and verification.md for actual
checks and limits. Supabase frontend configuration is limited to the project URL
and publishable key. Server secrets are injected into Supabase Edge Functions.

To use a new Supabase project, apply migrations in order, deploy gd-owner, gd-staff
and gd-events, configure a new one-time owner secret hash through a trusted
backend, and configure the two public Pages build environment variables.
