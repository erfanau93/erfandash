import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://etiaoqskgplpfydblzne.supabase.co'
export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aWFvcXNrZ3BscGZ5ZGJsem5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzI0NzAsImV4cCI6MjA4MjgwODQ3MH0.c-AlsveEx_bxVgEivga3PRrBp5ylY3He9EJXbaa2N2c'

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

