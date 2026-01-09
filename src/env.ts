// Centralized, typed access to Vite env vars.
// IMPORTANT: Never put server-only secrets in VITE_* env vars (they end up in the browser bundle).

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,

  // Mapbox public token (still public, but should not be hardcoded)
  mapboxToken: (import.meta.env.VITE_MAPBOX_TOKEN ||
    import.meta.env.VITE_MAPBOX_API_KEY ||
    import.meta.env.VITE_MAPBOX) as string | undefined,

  googleReviewUrl: import.meta.env.VITE_GOOGLE_REVIEW_URL as string | undefined,
} as const

export function assertClientEnv() {
  const missing: string[] = []
  if (!env.supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!env.supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')} (set them in .env.local)`)
  }
}


