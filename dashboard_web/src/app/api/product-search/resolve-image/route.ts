import { NextResponse } from 'next/server'

const ALLOWED_HOSTS = new Set([
  'autotrader.ca',
  'www.autotrader.ca',
])

const IMAGE_META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
]

const SRCSET_PATTERN = /<(?:source|img)\b[^>]+(?:srcset|data-srcset)=["']([^"']+)["'][^>]*>/i
const IMG_PATTERN = /<img\b[^>]+(?:data-src|data-original|src)=["']([^"']+)["'][^>]*>/i

function isAllowedListingUrl(url: URL) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname.toLowerCase())
}

function isUsableImageUrl(value: string | null | undefined) {
  if (!value) return false
  const lower = value.trim().toLowerCase()
  return (
    !!lower &&
    !lower.startsWith('data:') &&
    !lower.includes('placeholder') &&
    !lower.includes('blank.gif') &&
    !lower.includes('transparent.gif') &&
    !lower.includes('1x1.gif')
  )
}

function firstSrcsetUrl(srcset: string) {
  const candidates = srcset
    .split(',')
    .map((chunk) => chunk.trim().split(/\s+/, 1)[0])
    .filter(Boolean)

  for (let i = candidates.length - 1; i >= 0; i--) {
    if (isUsableImageUrl(candidates[i])) return candidates[i]
  }
  return ''
}

function absolutizeImageUrl(value: string, baseUrl: URL) {
  const trimmed = value.trim()
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return new URL(trimmed, baseUrl).toString()
}

function extractImageUrl(html: string, baseUrl: URL) {
  for (const pattern of IMAGE_META_PATTERNS) {
    const match = html.match(pattern)
    if (isUsableImageUrl(match?.[1])) return absolutizeImageUrl(match![1], baseUrl)
  }

  const srcsetMatch = html.match(SRCSET_PATTERN)
  const srcsetUrl = firstSrcsetUrl(srcsetMatch?.[1] || '')
  if (srcsetUrl) return absolutizeImageUrl(srcsetUrl, baseUrl)

  const imgMatch = html.match(IMG_PATTERN)
  if (isUsableImageUrl(imgMatch?.[1])) return absolutizeImageUrl(imgMatch![1], baseUrl)

  return ''
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')

  if (!rawUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  let listingUrl: URL
  try {
    listingUrl = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }

  if (!isAllowedListingUrl(listingUrl)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }

  try {
    const res = await fetch(listingUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      next: { revalidate: 60 * 60 * 6 },
    })

    if (!res.ok) {
      return NextResponse.json({ image: '' }, { status: 200 })
    }

    const html = await res.text()
    const image = extractImageUrl(html, listingUrl)
    return NextResponse.json({ image })
  } catch {
    return NextResponse.json({ image: '' }, { status: 200 })
  }
}
