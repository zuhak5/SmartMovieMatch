import type { Buffer } from 'buffer'

export type DownloadedCelebrityAvatar = {
  buffer: Buffer
  contentType: string
  extension: string
  personId: number
  filePath: string
}

export declare const CELEBRITY_PERSON_IDS: number[]

export declare function downloadRandomCelebrityAvatar(options?: {
  fetchImpl?: typeof fetch
}): Promise<DownloadedCelebrityAvatar | null>
