# give.koivikko.org on snswserver

The donation page (`site/`) runs as a small nginx container on snswserver, behind the shared
nginx-proxy + Let's Encrypt stack, like the other SNSW sites. The donation backend (Stripe,
counter) stays on Cloudflare Workers; the page calls it directly.

```
GitHub push (site/ or deploy/snsw/)
  -> Actions: build + smoke test + push ghcr.io/south-nsw-conference-office/koivikodonation:latest
  -> snswserver site-pull (every 2 min) pulls it and restarts koivikko-give
  -> nginx-proxy: https://give.koivikko.org -> koivikko-give:8080
```

## Files

| File | What it is |
|---|---|
| `Dockerfile` | nginx-unprivileged (non-root, port 8080) + `site/`. Drops `_headers` and the demo checkout. |
| `site.conf` | Routes (`/`, `/en`, `/fi`, `/thank-you`, `/donate-cancelled`), caching, dot-file block, GET/HEAD only. |
| `security-headers.conf` | Security headers on every response. Same as `site/_headers` minus HSTS (the proxy adds HSTS). |
| `docker-compose.yml` | Goes to `/etc/site-pull/koivikko-give/` on the server. |
| `../../.github/workflows/snsw-image.yml` | Builds and pushes the image. |
| `../../.dockerignore` | Only `site/` and `deploy/snsw/` go into the build. |

## One-time setup

**1. GitHub:** the repo is `South-NSW-Conference-Office/koivikodonation` (public). Push to `main`;
the workflow runs and publishes the package `koivikodonation`.
The package is **private** (the organisation does not allow public packages). The account behind
the server's read-only GHCR token (`/etc/site-pull/docker/config.json`) needs **Read** access:
Org > Packages > koivikodonation > Package settings > Manage access (or add that account to the
repo, since the package inherits the repo's access).

**2. DNS (Namecheap, koivikko.org):** add `A  give  107.155.65.229` (TTL automatic).
Check: `dig +short give.koivikko.org` shows `107.155.65.229`.

**3. snswserver (root):**

```sh
docker network create edge-koivikko
docker network connect edge-koivikko <nginx-proxy container name>
docker network connect edge-koivikko <acme-companion container name>   # only if it uses networks to reach containers
mkdir -p /etc/site-pull/koivikko-give
cp docker-compose.yml /etc/site-pull/koivikko-give/docker-compose.yml   # this folder's file
chown -R root:root /etc/site-pull/koivikko-give
site-pull koivikko-give        # first start now instead of waiting 2 minutes
tail -n 3 /var/log/site-pull.log
```

Do step 2 before step 3 (or the first certificate attempt fails; acme-companion retries later).

**4. Check (from anywhere):**

```sh
curl -sI https://give.koivikko.org/ | head -20
LIVE=https://give.koivikko.org node frontend-tests/headers.test.mjs
```

## Before real donations (launch settings, separate step)

The page still points at the **sandbox** backend and test Turnstile key. Switch in `site/config.js`
(`apiBase`, `turnstileSiteKey`), add the live backend to `connect-src` in the CSP `<meta>` of
`index.html` and `thank-you.html`, bump the `?v=` numbers, deploy the live backend first
(`ALLOWED_ORIGINS`, `SUCCESS_URL`, `CANCEL_URL` already say give.koivikko.org), then push the site.

## Rollback

Pin the previous image: `echo IMAGE_TAG=<older git sha> > /etc/site-pull/koivikko-give/.env`, then
`site-pull koivikko-give`. Remove the line to follow `latest` again.

## Test locally

```sh
docker build -f deploy/snsw/Dockerfile -t koivikko-give:local .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL -p 127.0.0.1:8088:8080 koivikko-give:local
# http://127.0.0.1:8088/en  (HSTS is missing locally on purpose: the server's proxy adds it)
```
