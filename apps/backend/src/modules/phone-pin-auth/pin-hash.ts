import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto"

// scrypt cost — Node's default N with a 64-byte key. Stored with the hash so
// the cost can be raised later without breaking existing PINs.
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function scrypt(pin: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(pin, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

/** "scrypt$N$r$p$<salt b64>$<hash b64>" */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pin, salt, N, R, P)
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$")
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = String(stored).split("$")
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, "base64")
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Exactly 6 digits, and not trivially guessable. */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return "The PIN must be exactly 6 digits."
  }
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    return "That PIN is too easy to guess. Avoid repeated or sequential digits."
  }
  return null
}
