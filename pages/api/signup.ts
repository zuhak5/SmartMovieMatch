import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@/lib/supabaseServer'
import crypto from 'crypto'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { username, display_name, password, avatarBase64, avatarFileName } = req.body

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const salt = crypto.randomBytes(16).toString('hex')
    const password_hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
    const now = new Date().toISOString()

    let avatar_path: string | null = null
    let avatar_url: string | null = null

    if (avatarBase64 && avatarFileName) {
      const buffer = Buffer.from(avatarBase64, 'base64')
      const safeName = String(avatarFileName).replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${username}/${Date.now()}-${safeName}`

      const { error: upErr } = await supabaseServer.storage.from('avatars').upload(path, buffer, {
        contentType: 'image/*',
        upsert: false
      })
      if (upErr) {
        console.error('Upload error', upErr)
        return res.status(400).json({ error: 'Avatar upload failed' })
      }

      avatar_path = path
      const { data: pub } = supabaseServer.storage.from('avatars').getPublicUrl(path)
      avatar_url = pub?.publicUrl ?? null
    }

    const { error: insErr } = await supabaseServer
      .from('auth_users')
      .insert({
        username,
        display_name,
        password_hash,
        salt,
        created_at: now,
        avatar_path,
        avatar_url
      })
    if (insErr) {
      console.error(insErr)
      return res.status(400).json({ error: 'User insert failed' })
    }

    const token = crypto.randomBytes(24).toString('hex')
    const { error: sessErr } = await supabaseServer
      .from('auth_sessions')
      .insert({
        token,
        username,
        created_at: now,
        last_active_at: now
      })
    if (sessErr) {
      console.error(sessErr)
      return res.status(400).json({ error: 'Session creation failed' })
    }

    return res.status(200).json({ token })
  } catch (e:any) {
    console.error(e)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
