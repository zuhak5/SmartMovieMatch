import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseServer } from '@/lib/supabaseServer'
import crypto from 'crypto'
import { promisify } from 'util'
import fallbackAvatars, { FamousAvatar } from '../../lib/fallbackAvatars'
import { downloadRandomCelebrityAvatar } from '../../lib/tmdbCelebrity'

const PBKDF2_ITERATIONS = 100000
const pbkdf2Async = promisify(crypto.pbkdf2)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { username, display_name, password, avatarBase64, avatarFileName } = req.body

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const salt = crypto.randomBytes(16).toString('hex')
    const derivedKey = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, 64, 'sha512')
    const password_hash = derivedKey.toString('hex')
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

    if (!avatar_url) {
      try {
        const celebrityAvatar = await downloadRandomCelebrityAvatar()
        if (celebrityAvatar) {
          const tmdbPath = `${username}/tmdb-${celebrityAvatar.personId}-${Date.now()}${celebrityAvatar.extension}`
          const { error: tmdbUploadErr } = await supabaseServer.storage
            .from('avatars')
            .upload(tmdbPath, celebrityAvatar.buffer, {
              contentType: celebrityAvatar.contentType,
              upsert: false
            })
          if (tmdbUploadErr) {
            console.warn('TMDB avatar upload failed', tmdbUploadErr)
          } else {
            avatar_path = tmdbPath
            const { data: tmdbPub } = supabaseServer.storage.from('avatars').getPublicUrl(tmdbPath)
            avatar_url = tmdbPub?.publicUrl ?? null
          }
        }
      } catch (error) {
        console.warn('TMDB celebrity avatar skipped', error)
      }
    }

    if (!avatar_url) {
      const fallbackAvatar = pickFallbackAvatar()
      if (fallbackAvatar) {
        avatar_path = `preset:${fallbackAvatar.id}`
        avatar_url = fallbackAvatar.imageUrl
      }
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

function pickFallbackAvatar(): FamousAvatar | null {
  if (!Array.isArray(fallbackAvatars) || fallbackAvatars.length === 0) {
    return null
  }
  const index = crypto.randomInt(0, fallbackAvatars.length)
  return fallbackAvatars[index] ?? null
}
