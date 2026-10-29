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
