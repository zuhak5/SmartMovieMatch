const crypto = require('crypto')
const path = require('path')

const { FALLBACK_AVATARS } = require('./fallbackAvatars')

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const DEFAULT_IMAGE_SIZE = 'w780'

const CELEBRITY_PERSON_IDS = FALLBACK_AVATARS.map((avatar) => avatar && avatar.tmdbId)
  .filter((value) => Number.isInteger(value))
  .map((value) => Number(value))

function buildPersonImagesUrl(personId, apiKey) {
  const url = new URL(`${TMDB_API_BASE}/person/${personId}/images`)
  if (apiKey) {
    url.searchParams.set('api_key', apiKey)
  }
  return url.toString()
}

function guessExtension(filePath, contentType) {
  if (typeof filePath === 'string') {
    const ext = path.extname(filePath)
    if (ext) {
      return ext
    }
  }
  if (typeof contentType === 'string') {
    const lower = contentType.toLowerCase()
    if (lower.includes('png')) return '.png'
    if (lower.includes('webp')) return '.webp'
    if (lower.includes('gif')) return '.gif'
  }
  return '.jpg'
}

async function fetchPersonImages(personId, fetchFn, token, apiKey) {
  const headers = { Accept: 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetchFn(buildPersonImagesUrl(personId, apiKey), { headers })
  if (!res || !res.ok) {
    throw new Error(`TMDB images request failed (${res && res.status})`)
  }
  return res.json()
}

async function fetchImageBlob(filePath, fetchFn) {
  const target = `${TMDB_IMAGE_BASE}/${DEFAULT_IMAGE_SIZE}${filePath}`
  const res = await fetchFn(target, { headers: { Accept: 'image/*' } })
  if (!res || !res.ok) {
    throw new Error(`TMDB image download failed (${res && res.status})`)
  }
  const arrayBuffer = await res.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('TMDB image response was empty')
  }
  const buffer = Buffer.from(arrayBuffer)
  const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/jpeg'
  const extension = guessExtension(filePath, contentType)
  return { buffer, contentType, extension }
}

async function downloadRandomCelebrityAvatar(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return null
  }
  const readToken = process.env.TMDB_API_READ_ACCESS_TOKEN
  const apiKey = process.env.TMDB_API_KEY
  if (!readToken && !apiKey) {
    return null
  }
  if (!CELEBRITY_PERSON_IDS.length) {
    return null
  }

  const attempts = Math.min(CELEBRITY_PERSON_IDS.length, 6)
  for (let i = 0; i < attempts; i += 1) {
    const personId = CELEBRITY_PERSON_IDS[crypto.randomInt(0, CELEBRITY_PERSON_IDS.length)]
    try {
      const imageListing = await fetchPersonImages(personId, fetchImpl, readToken, apiKey)
      const profiles = Array.isArray(imageListing && imageListing.profiles) ? imageListing.profiles : []
      if (!profiles.length) {
        continue
      }
      const profile = profiles[crypto.randomInt(0, profiles.length)]
      const filePath = profile && profile.file_path
      if (!filePath) {
        continue
      }
      const { buffer, contentType, extension } = await fetchImageBlob(filePath, fetchImpl)
      return { buffer, contentType, extension, personId, filePath }
    } catch (error) {
      // Try the next candidate, but keep logging for observability
      console.warn('TMDB celebrity avatar attempt failed', error && error.message ? error.message : error)
    }
  }

  return null
}

module.exports = {
  CELEBRITY_PERSON_IDS,
  downloadRandomCelebrityAvatar
}
