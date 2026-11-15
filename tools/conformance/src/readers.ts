// "The outputs reopen in an independent reader" (phase 9): readers that do not use the kit.
// khp check knows common formats; for others it says it has no reader, and the kit's own
// `<prefix>_inspect` of a created file is checked instead.

import { decodePng } from './image.ts'

type Reader = (bytes: Buffer) => string | undefined

const startsWith = (bytes: Buffer, text: string) => bytes.subarray(0, text.length).toString('latin1') === text

const zip: Reader = (bytes) => {
  if (bytes.readUInt32LE(0) !== 0x04034b50) return 'not a ZIP archive'
  if (bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) return 'a ZIP archive without its end record'
  return undefined
}

const READERS: Record<string, Reader> = {
  png: (bytes) => {
    try {
      decodePng(bytes)
      return undefined
    } catch (error) {
      return `not a PNG: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  jpg: (bytes) => (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 ? undefined : 'not a complete JPEG'),
  webp: (bytes) => (startsWith(bytes, 'RIFF') && bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? undefined : 'not a WebP'),
  gif: (bytes) => (startsWith(bytes, 'GIF8') ? undefined : 'not a GIF'),
  pdf: (bytes) => (startsWith(bytes, '%PDF-') && bytes.subarray(-1024).includes('%%EOF') ? undefined : 'not a complete PDF'),
  svg: (bytes) => (/<svg[\s>]/.test(bytes.subarray(0, 4096).toString('utf8')) ? undefined : 'not an SVG'),
  json: (bytes) => {
    try {
      JSON.parse(bytes.toString('utf8'))
      return undefined
    } catch {
      return 'not JSON'
    }
  },
  mp4: (bytes) => (bytes.subarray(4, 8).toString('latin1') === 'ftyp' ? undefined : 'not an MP4'),
  mov: (bytes) => (bytes.subarray(4, 8).toString('latin1') === 'ftyp' ? undefined : 'not a QuickTime movie'),
  docx: zip,
  xlsx: zip,
  pptx: zip,
  zip,
  html: (bytes) => (/<html[\s>]|<!doctype html/i.test(bytes.subarray(0, 4096).toString('utf8')) ? undefined : 'not HTML'),
  csv: (bytes) => (bytes.includes(0) ? 'a CSV with NUL bytes' : undefined),
  txt: (bytes) => (bytes.includes(0) ? 'text with NUL bytes' : undefined),
  md: (bytes) => (bytes.includes(0) ? 'Markdown with NUL bytes' : undefined),
}
READERS.jpeg = READERS.jpg as Reader

/** `undefined` when the bytes read as `extension`; a reason when they do not; `null` for no reader. */
export function readIndependently(extension: string, bytes: Buffer): string | undefined | null {
  const reader = READERS[extension.toLowerCase()]
  if (!reader) return null
  if (bytes.length === 0) return 'the file is empty'
  return reader(bytes)
}
