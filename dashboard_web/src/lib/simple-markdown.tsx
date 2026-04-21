import React from 'react'

/**
 * Mini rendu Markdown pour les annonces (news).
 * Supporte : titres (# / ## / ###), paragraphes, listes (-/*), gras (**),
 * italique (*), code inline (`), liens [txt](url), séparateurs (---).
 *
 * Volontairement minimal — aucune lib externe, safe-by-design
 * (les balises HTML sont échappées, seuls les styles markdown reconnus
 * produisent du formatage).
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Regex couvrant : gras, italique, code, lien
  const regex = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const [, , bold, italic, code, linkText, linkUrl] = match
    const key = `${keyPrefix}-${i++}`
    if (bold !== undefined) {
      parts.push(<strong key={key} className="font-semibold text-[var(--color-text-primary)]">{bold}</strong>)
    } else if (italic !== undefined) {
      parts.push(<em key={key}>{italic}</em>)
    } else if (code !== undefined) {
      parts.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-[var(--color-background-secondary)] text-[12px] font-mono">{code}</code>
      )
    } else if (linkText !== undefined && linkUrl !== undefined) {
      const isExternal = /^https?:\/\//i.test(linkUrl)
      parts.push(
        <a
          key={key}
          href={linkUrl}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          className="text-emerald-600 dark:text-emerald-400 underline hover:no-underline"
        >
          {linkText}
        </a>
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export function renderMarkdown(source: string): React.ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let blockIndex = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockIndex++}`} className="my-5 border-[var(--color-border-tertiary)]" />)
      i++
      continue
    }

    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (h) {
      const level = h[1].length
      const content = h[2]
      const key = `h-${blockIndex++}`
      const classes: Record<number, string> = {
        1: 'text-xl font-bold text-[var(--color-text-primary)] mt-4 mb-2',
        2: 'text-lg font-semibold text-[var(--color-text-primary)] mt-4 mb-2',
        3: 'text-[15px] font-semibold text-[var(--color-text-primary)] mt-3 mb-1.5',
        4: 'text-sm font-semibold text-[var(--color-text-primary)] mt-3 mb-1',
        5: 'text-sm font-semibold text-[var(--color-text-primary)] mt-2 mb-1',
        6: 'text-xs font-semibold text-[var(--color-text-primary)] mt-2 mb-1',
      }
      const cls = classes[level] || classes[3]
      const inner = renderInline(content, key)
      if (level === 1) blocks.push(<h1 key={key} className={cls}>{inner}</h1>)
      else if (level === 2) blocks.push(<h2 key={key} className={cls}>{inner}</h2>)
      else if (level === 3) blocks.push(<h3 key={key} className={cls}>{inner}</h3>)
      else if (level === 4) blocks.push(<h4 key={key} className={cls}>{inner}</h4>)
      else if (level === 5) blocks.push(<h5 key={key} className={cls}>{inner}</h5>)
      else blocks.push(<h6 key={key} className={cls}>{inner}</h6>)
      i++
      continue
    }

    // Listes : regroupe les lignes consécutives commençant par - ou *
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      const key = `ul-${blockIndex++}`
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-1.5 my-2 text-[var(--color-text-secondary)]">
          {items.map((it, idx) => (
            <li key={`${key}-${idx}`} className="leading-relaxed">{renderInline(it, `${key}-${idx}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Paragraphe : lignes consécutives jusqu'à une ligne vide
    const paraLines: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|[-*]\s|---+$)/.test(lines[i].trim())) {
      paraLines.push(lines[i])
      i++
    }
    const key = `p-${blockIndex++}`
    blocks.push(
      <p key={key} className="my-2 leading-relaxed text-[var(--color-text-secondary)]">
        {renderInline(paraLines.join(' ').trim(), key)}
      </p>
    )
  }

  return blocks
}
