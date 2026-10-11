/**
 * Generate an Argon2id hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-password
 *
 * Reads the password from stdin so it never lands in shell history or argv.
 * Prints only the hash — the plaintext is never stored anywhere.
 *
 * Outputs TWO forms, because they are genuinely different:
 *
 *   .env.local  — every `$` must be escaped as `\$`. Next.js runs dotenv-expand
 *                 over .env files, so an unescaped `$argon2id$v=19$m=...` is read
 *                 as variable references and collapses to "=19=19456,t=2,p=1".
 *                 Quote style does not save you; escaping is what matters.
 *
 *   Vercel etc. — paste the raw hash with no escaping and no quotes. Platform
 *                 env vars are injected directly into process.env and are never
 *                 expanded.
 */

import { hash } from '@node-rs/argon2'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const rl = createInterface({ input: stdin, output: stdout })

const password = await rl.question('Password to hash: ')
rl.close()

if (!password || password.length < 12) {
  console.error('\nRefusing: use at least 12 characters.')
  process.exit(1)
}

// OWASP-recommended Argon2id parameters.
const digest = await hash(password, {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
})

const escaped = digest.replaceAll('$', '\\$')

console.log('\n' + '─'.repeat(72))
console.log('FOR .env.local  — $ escaped as \\$ (required, or the hash is mangled)')
console.log('─'.repeat(72))
console.log(`ADMIN_PASSWORD_HASH=${escaped}`)

console.log('\n' + '─'.repeat(72))
console.log('FOR VERCEL / hosting dashboard — paste raw, no quotes, no escaping')
console.log('─'.repeat(72))
console.log(digest)

console.log('\nVerify a .env.local value loaded correctly with:')
console.log('  npm run check-env\n')
