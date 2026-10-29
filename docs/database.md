# Database and security contract

## Entity groups

| Group | Tables |
| --- | --- |
| Staff and authorization | profiles, roles, permissions, role_permissions, user_roles, user_permissions |
| Mold master | molds, mold_specifications, mold_internal_details |
| Catalog taxonomy | categories, colors, mold_categories, mold_colors |
| Media and documents | mold_images, mold_documents, event_attachments |
| Factory events | maintenance_records, chrome_records, production_logs |
| Equipment | machines, mold_machine_compatibility |
| Marketing | homepage_sections, homepage_section_items |
| Real analytics | mold_views, mold_search_events, sales_statistics |
| Administration | notifications, audit_logs, company_settings |
| Private server settings | private.system_settings |

Every mold insert creates its specification and internal-details rows atomically.
The UUID and creation metadata cannot be modified. Codes are unique ignoring case,
trimmed, and may change without breaking the permanent UUID or history.

`publication_status` and `operational_status` are independent. Taking a physical mold
out of service does not automatically unpublish its listing. `deleted_at` controls
soft deletion separately. Restoring a published record requires publication permission.

Dimensions are millimeters, product weights grams, capacities milliliters, and
financial fields decimal amounts with a three-letter currency code. Missing
measurements are NULL rather than zero. Rejects are included in total produced
quantity and cannot exceed it. Press cycles and units produced are separate fields.

Opening cycles have a baseline date. Production logs must follow that date, and
the opening-cycle baseline becomes immutable once production logs exist.

## Public read surface

Anonymous visitors may only read these explicit allowlist views:

- catalog_molds, catalog_categories, catalog_mold_categories, catalog_colors
- catalog_images, catalog_documents, catalog_homepage_sections, catalog_company

`search_catalog(...)` provides parameterized bilingual name/code search, optional
category/shape/color/dimension filters, bounded pagination and real ranking sources.
`get_homepage_collection(section)` resolves manual or automatic published sections.
A best-selling section is empty until actual sourced sales exist.

**Intentional view-owner access:** public views bypass source-table RLS so visitors
can read the public projection without source-table grants. Each view has an
explicit column allowlist and publication/deletion/approval filters, and uses
`security_barrier`. No public view selects internal details. Tests assert both
allowed reads and denied base-table access. Do not add columns or joins without
reviewing public/private isolation; do not convert a projection to `SELECT *`.

## Staff access

Signing in alone grants no factory access. An active profile plus an assigned role
or explicit permission is required. Policies read live database permissions rather
than editable user metadata or stale role claims. Disabling a profile removes
its private data privileges on its next query, even with an unexpired JWT.

The seeded roles are Super Admin, Admin, Supervisor and Viewer. Supervisors can
append operational events but cannot publish catalog content or modify completed
history. Viewers read permitted factory data. Admins manage content and operations;
only Super Admins can modify access through `set_staff_access`.

Authorization tables have no client INSERT/UPDATE/DELETE grants. Only trusted
server provisioning and the checked access RPC may modify membership. Reports are
additionally gated by `reports.view`; audit-log reads require `activity.view`.

`set_mold_archived(id, archived)` checks archive permission, locks the row, and
requires publication permission when restoring an already-published mold.

Completed maintenance/chrome events and all production logs are immutable for
ordinary clients. There are no staff hard-delete grants on molds or history.
An erroneous finalized operational entry needs an explicitly designed corrective
workflow before production use; silently editing completed costs is unsupported.
Audit logs store actor, operation, record reference and changed column names,
not secret payloads or full before/after snapshots. Audit writes are automatic.

## Storage and public media delivery

Current application note: an additional SELECT policy permits anonymous access
only to catalog-media objects whose exact path is present in an approved public
projection. The browser requests a 60-second signed URL under this policy. The
bucket remains private; guessed draft/private paths remain denied.


Both `catalog-media` and `factory-files` are private buckets. An approved public
metadata row does not turn its raw Storage URL into a public URL.

| Bucket | Object path | Staff authorization |
| --- | --- | --- |
| catalog-media | molds/UUID/unique-file.ext | media.manage upload; molds.view read |
| catalog-media | categories/UUID/unique-file.ext | categories.manage |
| factory-files | molds/UUID/unique-file.ext | media.manage upload; molds.view read |
| factory-files | maintenance/EVENT_UUID/unique-file.ext | maintenance.create upload; maintenance.view read |
| factory-files | chrome/EVENT_UUID/unique-file.ext | chrome.create upload; chrome.view read |

Use random immutable filenames and `upsert:false`. No ordinary client can overwrite
or delete stored objects. This preserves approved content and historical evidence.
Media metadata and event attachment paths must match their referenced entity.

The future public media endpoint must:

1. Receive a **media ID**, never an arbitrary bucket/key or a caller-supplied URL.
2. Query catalog_images/catalog_documents, or a visible category cover, using a
   public/session client. Return 404 when the record is absent or unapproved.
3. Use a server-only service client to sign **only that returned path** for a short
   duration (for example 60 seconds).
4. Return only the resulting approved public media. Apply rate limits and sensible
   caching; a previously issued signed URL remains valid until its expiry.

Private download endpoints must validate the user's current session and relevant
permission before signing a private path. They must never rely on knowing a UUID.

Buckets enforce 20 MiB and an allowlist of images/PDF (plus XLSX for private files).
The future upload handler still needs magic-byte validation, image decoding and
re-encoding, PDF handling, malicious-file scanning where appropriate and optimized
image variants. SQL alone cannot verify that uploaded bytes match their MIME type.
SVG/HTML are intentionally not accepted.

## Operational reports

`get_mold_lifecycle(UUID)` and `get_factory_dashboard()` check reports.view inside
the database before reading private aggregate sources. Maintenance/chrome totals
are grouped by currency. Lifecycle reminders use the latest **completed** event,
its explicit recommended date or the mold's configured interval. Production-based
reminders use cycles, never assumed units produced. No dates are fabricated when
both history and a baseline date are absent.

The date fields use the database's current_date. Set the intended factory time
zone during deployment if calendar-day reminders must align with Egypt.

Analytics ingestion needs a rate-limited server. Anonymous direct inserts to view,
search and sales tables are denied. Raw search queries are private and must not
contain unnecessary personal data; establish a retention policy before launch.
