import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || 'maschinen-medien'

if (!url || !key) {
  console.error('VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY fehlt in der .env-Datei.')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } }
})

/** Öffentliche URL einer Datei im Medien-Bucket. */
export function mediaUrl(path) {
  if (!path) return null
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Datei hochladen, gibt den Speicherpfad zurück. */
export async function uploadFile(file, prefix) {
  const ext = file.name.split('.').pop()
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
  const path = `${prefix}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe || 'datei.' + ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined
  })
  if (error) throw error
  return path
}
