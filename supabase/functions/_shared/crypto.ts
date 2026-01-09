function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

async function getAesKey() {
  const keyB64 = Deno.env.get('BANK_ENCRYPTION_KEY') || ''
  if (!keyB64) throw new Error('Missing BANK_ENCRYPTION_KEY')
  const raw = decodeBase64(keyB64)
  if (raw.length !== 32) throw new Error('BANK_ENCRYPTION_KEY must be base64 for 32 bytes')
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptString(plain: string): Promise<string> {
  const key = await getAesKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plain)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded))

  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return `v1:${encodeBase64(out)}`
}

export async function decryptString(enc: string): Promise<string> {
  if (!enc) return ''
  const key = await getAesKey()
  const raw = enc.startsWith('v1:') ? decodeBase64(enc.slice('v1:'.length)) : decodeBase64(enc)
  const iv = raw.slice(0, 12)
  const cipher = raw.slice(12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher))
  return new TextDecoder().decode(plain)
}


