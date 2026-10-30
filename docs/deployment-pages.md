# Cloudflare Pages deployment

The application is deployed as a static Pages project, with no Worker runtime.

Build command: `pnpm run build`.
Output directory: `dist-pages`.
Production branch: `main`.
Framework preset: None.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as Pages build variables.
These are browser-safe configuration values. Never use a service/secret key.

The repository is connected to the Pages project `gd-menu`. A push to main triggers
a new build. Deep links are supported by public/_redirects. Headers disallow
framing and MIME sniffing and disable unused device permissions.

Supabase functions are independent deployments; their source is included under
supabase/functions. They read server secrets from Supabase's injected environment.

The one-time owner setup link contains a secret in a URL fragment. Fragments are
not sent in the HTTP request to Pages. The app removes the fragment from the
address bar after reading it, then submits the secret to gd-owner only when the
owner chooses their username/password. The database stores only SHA-256 of the
secret, with a seven-day expiry; it is consumed after successful provisioning.
Never publish or commit the private setup link. After setup, use /admin/login.

Account recovery uses the Super Admin's password-reset control. There are no
invitation or confirmation emails in the username/password account workflow.

## Cloudflare R2 for catalog images (optional, recommended)

Public catalog photos can be stored in R2 and served from its public URL (edge-cached, immutable,
no egress fees). Private factory photos and PDF documents stay in private Supabase Storage. Until
R2 is configured, uploads automatically keep using Supabase Storage.

1. Cloudflare dashboard → R2 → create a bucket (e.g. `gd-media`).
2. Bucket → Settings → Public access: connect a custom domain (e.g. `media.example.com`) or enable
   the r2.dev URL.
3. Bucket → Settings → CORS policy:
   ```json
   [{"AllowedOrigins":["https://gd-menu.pages.dev"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type","cache-control"],"MaxAgeSeconds":86400}]
   ```
4. R2 → Manage API tokens → create a token with "Object Read & Write" on that bucket only.
5. Supabase → Edge Functions → Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`, `R2_PUBLIC_URL`. Deploy the `gd-media` function.
6. Pages → Settings → Environment variables: `VITE_R2_PUBLIC_URL` (same public URL), then redeploy.

`gd-media` issues a five-minute upload URL for one server-chosen key under `molds/<mold id>/`, only to
active staff with `media.manage`.
