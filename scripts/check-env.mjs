/**
 * Report what Next.js actually loaded from .env.local — without printing secrets.
 *
 *   npm run check-env          shape checks only
 *   npm run check-env:live     also calls GitHub / Drive / Mongo with each credential
 *
 * Pattern from portfolio-admin/scripts/check-env.mjs.
 */

// @next/env is CommonJS — it has no named ESM exports.
import nextEnv from '@next/env'
const { loadEnvConfig } = nextEnv

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })

const live = process.argv.includes('--live')

const mask = (value) =>
  !value
    ? ''
    : value.length <= 12
      ? '•'.repeat(value.length)
      : `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`

let problems = 0
const fail = (line) => {
  console.log(`  BROKEN    ${line}`)
  problems += 1
}

function check({ name, required, validate, hint, secret = true }) {
  const value = process.env[name] || ''
  if (!value) {
    if (required) {
      console.log(`  MISSING   ${name}`)
      if (hint) console.log(`            ${hint}`)
      problems += 1
    } else {
      console.log(`  unset     ${name}  (optional)`)
    }
    return
  }
  const problem = validate ? validate(value) : null
  if (problem) {
    fail(`${name} — ${problem}`)
    console.log(`            got: ${secret ? mask(value) : value}`)
    if (hint) console.log(`            ${hint}`)
    return
  }
  console.log(`  ok        ${name}  ${secret ? mask(value) : value}`)
}

function originList(value) {
  for (const item of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    let url
    try {
      url = new URL(item)
    } catch {
      return `"${item}" is not a URL`
    }
    if (url.pathname !== '/' || url.search) return `"${item}" has a path — use the origin only`
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return `"${item}" is not https`
  }
  return null
}

console.log('\nEmbedding\n')
check({ name: 'ALLOWED_ORIGINS', required: true, validate: originList, secret: false })
check({ name: 'ALLOWED_ORIGIN_PATTERNS', required: false, secret: false })
check({ name: 'ALLOW_LOCALHOST', required: false, secret: false })
if (process.env.ALLOW_LOCALHOST === 'true' && process.env.VERCEL_ENV === 'production') {
  fail('ALLOW_LOCALHOST is true in production')
}

console.log('\nGitHub stores\n')
const stores = []
for (let n = 1; n <= 20; n++) {
  const repo = process.env[`IMG_STORE_${n}_REPO`]
  if (!repo) break
  const store = {
    n,
    repo,
    token: process.env[`IMG_STORE_${n}_TOKEN`] || '',
    branch: process.env[`IMG_STORE_${n}_BRANCH`] || 'main',
    dir: (process.env[`IMG_STORE_${n}_DIR`] || 'img').replace(/^\/+|\/+$/g, ''),
    mode: process.env[`IMG_STORE_${n}_MODE`] || 'ro',
  }
  stores.push(store)
  const issues = []
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) issues.push('REPO is not owner/repo')
  if (!store.token) issues.push('TOKEN missing')
  if (!['rw', 'ro'].includes(store.mode)) issues.push(`MODE "${store.mode}" is not rw/ro`)
  if (issues.length) fail(`store ${n} (${repo}): ${issues.join(', ')}`)
  else console.log(`  ok        store ${n}  ${repo}@${store.branch}/${store.dir}  [${store.mode}]  token ${mask(store.token)}`)
}
if (stores.length === 0) fail('no stores — set IMG_STORE_1_REPO and IMG_STORE_1_TOKEN')

console.log('\nDrive\n')
const driveIds = (process.env.DRIVE_FOLDER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
if (driveIds.length === 0) {
  console.log('  off       DRIVE_FOLDER_IDS is blank')
} else {
  check({ name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', required: true, secret: false })
  check({
    name: 'GOOGLE_PRIVATE_KEY_B64',
    required: true,
    validate: (v) =>
      Buffer.from(v, 'base64').toString('utf8').includes('PRIVATE KEY')
        ? null
        : 'does not decode to a PEM private key',
  })
  console.log(`  ok        ${driveIds.length} folder(s)`)
}

console.log('\nMongoDB\n')
check({
  name: 'MONGODB_URI',
  required: false,
  validate: (v) =>
    v.startsWith('mongodb://') || v.startsWith('mongodb+srv://')
      ? null
      : 'does not look like a MongoDB connection string',
})

console.log('\nSign-in\n')
check({
  name: 'AUTH_SECRET',
  required: true,
  validate: (v) => (v.length < 32 ? 'shorter than 32 chars — regenerate' : null),
  hint: 'openssl rand -base64 32',
})
check({
  name: 'ADMIN_PASSWORD_HASH',
  required: false,
  validate: (v) => {
    if (v.startsWith("'") || v.endsWith("'") || v.startsWith('"')) return 'contains literal quote characters'
    if (!v.startsWith('$argon2')) return 'does not start with $argon2 — the $ signs were eaten by variable expansion'
    if (v.split('$').length < 6) return 'looks truncated'
    return null
  },
  hint: 'In .env.local every $ must be escaped as \\$. Re-run: npm run hash-password',
})
check({ name: 'AUTH_GITHUB_ID', required: false })
check({ name: 'AUTH_GITHUB_SECRET', required: false })
check({ name: 'ALLOWED_GITHUB_ID', required: false, validate: (v) => (/^\d+$/.test(v) ? null : 'must be the numeric id, not the username'), secret: false })

const github = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET)
const password = process.env.ADMIN_PASSWORD_HASH?.startsWith('$argon2')
if (github && !process.env.ALLOWED_GITHUB_ID) fail('GitHub OAuth is on but ALLOWED_GITHUB_ID is unset — every sign-in is rejected')
if (!github && !password) fail('no sign-in method is usable — set ADMIN_PASSWORD_HASH')

console.log('\nOther\n')
check({
  name: 'PUBLIC_BASE_URL',
  required: false,
  secret: false,
  validate: (v) => {
    try {
      const url = new URL(v)
      return url.pathname === '/' ? null : 'use the origin only, no path'
    } catch {
      return 'not a URL'
    }
  },
})
check({ name: 'REFRESH_SECRET', required: false })

if (live) {
  console.log('\nLive checks\n')
  const gh = (token, url) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'portfolio-img-hosting-check-env',
      },
    })

  for (const store of stores) {
    if (!store.token) continue
    const repoRes = await gh(store.token, `https://api.github.com/repos/${store.repo}`)
    if (!repoRes.ok) {
      fail(`store ${store.n}: GitHub ${repoRes.status} — token can't see ${store.repo}`)
      continue
    }
    const repo = await repoRes.json()
    if (!repo.private) fail(`store ${store.n}: ${store.repo} is PUBLIC — anyone can bypass the guard via raw links`)
    const dirRes = await gh(
      store.token,
      `https://api.github.com/repos/${store.repo}/contents/${store.dir}?ref=${encodeURIComponent(store.branch)}`
    )
    if (dirRes.status === 404) {
      console.log(`  note      store ${store.n}: ${store.dir}/ doesn't exist yet (created by the first upload)`)
    } else if (!dirRes.ok) {
      fail(`store ${store.n}: GitHub ${dirRes.status} reading ${store.dir}/`)
    } else {
      console.log(`  ok        store ${store.n}: reachable, private, ${store.dir}/ present`)
    }
    const limit = repoRes.headers.get('x-ratelimit-remaining')
    if (limit) console.log(`            rate limit remaining this hour: ${limit}`)
  }

  if (process.env.MONGODB_URI) {
    try {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 })
      await client.connect()
      await client.db(process.env.MONGODB_DB || 'portfolio').command({ ping: 1 })
      await client.close()
      console.log('  ok        MongoDB reachable')
    } catch (error) {
      fail(`MongoDB: ${error.message}`)
    }
  }

  if (driveIds.length > 0) {
    try {
      const { JWT } = await import('google-auth-library')
      const client = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64 || '', 'base64').toString('utf8'),
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
      const { token } = await client.getAccessToken()
      for (const id of driveIds) {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (res.ok) {
          const body = await res.json()
          console.log(`  ok        Drive folder "${body.name}" readable`)
        } else {
          fail(`Drive folder ${id.slice(0, 6)}…: ${res.status} — is it shared with the service account?`)
        }
      }
    } catch (error) {
      fail(`Drive: ${error.message}`)
    }
  }
}

console.log()
if (problems > 0) {
  console.error(`${problems} problem(s) found.\n`)
  process.exit(1)
}
console.log('Environment looks good.\n')
