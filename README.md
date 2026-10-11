# portfolio-img-hosting

Private image host for the portfolio. Images live in **private GitHub repos**
(optionally also private Google Drive folders). This app serves them at
`https://<host>/i/<folder>/<file>`, and **only** to `<img>` tags on the domains
listed in `ALLOWED_ORIGINS`. If someone opens a link in a new tab, an incognito
window or with curl, or if another site hotlinks it, they get a random
404/403/410.

A login-protected gallery at `/` lets you upload, browse, copy links, rename,
move and delete images. GitHub is the source of truth, so changes you make
directly on github.com also appear in the gallery.

Serverless on Vercel (Next.js 16). No separate server.

## How a request is decided

```
GET /i/projects/hero.webp?w=640
 ├─ Sec-Fetch-Dest must be "image"         ← a browser tab sends "document"
 ├─ Referer origin must be allowed         ← no referrer = refused
 ├─ path + ?w= must match the rules
 ├─ IP not over the miss budget            ← 30 misses / 10 min
 ├─ find the path: Mongo mapping → store 1, 2, … → Drive
 └─ 200, Cache-Control: private            ← never public, so the CDN can't leak it
any failure → random 404 / 403 / 410, same as a real miss
```

GitHub is hit about once per image per `CACHE_SECONDS` (Next data cache, tagged
per path), so the 5,000 requests/hour token limit doesn't matter.

**Limits.** This stops hotlinking, direct opens and casual sharing. It is not
DRM: anyone on your site can still save an image or take a screenshot, and a
script can fake both headers.

## Setup

1. **Image store.** Create a **private** repo, e.g. `portfolio-img-store`.
   It can be empty; the first upload creates `img/`.
2. **Store token.** Create a fine-grained PAT with *Repository access: only
   that repo* and *Contents: Read and write*. Put it in `IMG_STORE_1_TOKEN`.
3. **This app.** Create a private repo, import it as a new Vercel project, add
   a domain (e.g. `img.escanor244.tech`), and set the env vars from
   `.env.example`.
4. **Sign-in.** Run `npm run hash-password` and set `ADMIN_PASSWORD_HASH`.
   GitHub OAuth is optional: create an OAuth App with callback
   `https://<host>/api/auth/callback/github`, then set `AUTH_GITHUB_ID`,
   `AUTH_GITHUB_SECRET` and `ALLOWED_GITHUB_ID`.
5. **MongoDB (optional).** Needed for alt text and tags, and to cache which
   store holds each path. Create a dedicated Atlas user whose custom role
   allows `find, insert, update, remove, createIndex` on `portfolio.images`
   only. The admin's `content` collection is never touched.
6. Locally: `cp .env.example .env.local`, fill it in, then
   `npm run check-env:live`. This checks each token can see its repo, that the
   repo is private, and that Mongo and Drive are reachable. It never prints
   secret values.

Don't enable Vercel Deployment Protection on this project. It would block the
public `/i/*` links too.

## Day to day

| Task | How |
|---|---|
| Add an image | Gallery → choose store + folder → drop files. They're converted to WebP, EXIF/GPS is stripped, and the link works immediately (no redeploy). Or commit to `img/` on github.com. |
| Get a link | Gallery → **Copy link** (pick a width for `?w=`) or copy the `<img>` tag |
| Replaced a file on github.com | Card → refresh icon, or `POST /api/refresh` with header `x-refresh-secret` and body `{"path":"..."}` |
| New portfolio/admin domain | Add it to `ALLOWED_ORIGINS`, redeploy, and keep the old one until it's retired |
| New image-host domain | Add it to the Vercel project next to the old one, update `PUBLIC_BASE_URL` and the links in admin, then remove the old domain |
| Repo getting full | Add `IMG_STORE_2_*` env vars and redeploy. Links don't include the store, so nothing breaks. |
| Add Google Drive | Set `DRIVE_FOLDER_IDS` and the service-account vars (see `.env.example`). Drive is read-only here. |

## Rules for paths

The path in the URL mirrors the path in the repo under `IMG_STORE_n_DIR`:

- Up to 3 folders, then a file name
- Lowercase `a-z 0-9 - _` (file names may also contain `.`)
- Extensions: `webp png jpg jpeg gif avif svg`

Files that don't follow these rules are ignored. If the same path exists in
two stores, the earlier store wins, and the gallery marks the other copy as
shadowed.

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck`, `npm run lint` | |
| `npm run hash-password` | Argon2id hash for `ADMIN_PASSWORD_HASH` (prints the `.env.local` and Vercel forms) |
| `npm run check-env` / `check-env:live` | Checks env shape / also tests the credentials live |
