import type { ReactNode } from 'react'

/** 在日志正文里高亮关键字，保持大小写不敏感 */
export function highlightText(text: string, keyword: string): ReactNode {
  const kw = keyword.trim()
  if (!kw) return text
  const lower = text.toLowerCase()
  const target = kw.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let index = lower.indexOf(target)
  let key = 0
  while (index >= 0) {
    if (index > from) parts.push(text.slice(from, index))
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-400/30 px-px text-amber-200">
        {text.slice(index, index + kw.length)}
      </mark>,
    )
    from = index + kw.length
    index = lower.indexOf(target, from)
  }
  if (parts.length === 0) return text
  if (from < text.length) parts.push(text.slice(from))
  return parts
}
