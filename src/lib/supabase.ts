import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (prefer .env.local).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type DialpadCall = {
  id: string
  call_id: string
  direction: 'inbound' | 'outbound'
  duration: number
  created_at: string
  transcript?: string | null
  summary?: string | null
  transcript_fetched_at?: string | null
  external_number?: string | null
  internal_number?: string | null
}

export type DialpadSms = {
  id: string
  message_id: string
  direction: 'inbound' | 'outbound'
  created_at: string
  content?: string | null
  summary?: string | null
  external_number?: string | null
  internal_number?: string | null
}

export type DialpadEmail = {
  id: string
  message_id: string
  direction: 'inbound' | 'outbound'
  subject: string | null
  from_email: string | null
  to_email: string | null
  created_at: string
  body?: string | null
  summary?: string | null
}

