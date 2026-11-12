import { Fragment, type ReactNode } from 'react'

interface MarkdownProps {
  text: string
}

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link'
  value: string
  href?: string
}

const INLINE_PATTERN =
  /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let lastIndex = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, index) })
    }
    const [full, bold, boldUnderscore, code, italic, italicUnderscore, linkLabel, linkHref] = match
    if (bold !== undefined || boldUnderscore !== undefined) {
      tokens.push({ type: 'bold', value: bold ?? boldUnderscore })
    } else if (code !== undefined) {
      tokens.push({ type: 'code', value: code })
    } else if (italic !== undefined || italicUnderscore !== undefined) {
      tokens.push({ type: 'italic', value: italic ?? italicUnderscore })
    } else if (linkLabel !== undefined && linkHref !== undefined) {
      tokens.push({ type: 'link', value: linkLabel, href: linkHref })
    } else {
      tokens.push({ type: 'text', value: full })
    }
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return tokens
}

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    if (token.type === 'bold') return <strong key={index}>{token.value}</strong>
    if (token.type === 'italic') return <em key={index}>{token.value}</em>
    if (token.type === 'code') return <code key={index}>{token.value}</code>
    if (token.type === 'link') {
      return (
        <a key={index} href={token.href} target="_blank" rel="noreferrer">
          {token.value}
        </a>
      )
    }
    return <Fragment key={index}>{token.value}</Fragment>
  })
}

interface ListBlock {
  kind: 'ul' | 'ol'
  items: string[]
}

type TableAlign = 'left' | 'center' | 'right' | null

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; list: ListBlock }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][]; align: TableAlign[] }
  | { kind: 'hr' }

const ITEM_PATTERN = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function isTableStart(line: string, nextLine: string | undefined): boolean {
  if (!nextLine || !line.includes('|')) return false
  return TABLE_SEPARATOR_PATTERN.test(nextLine)
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function parseAlignment(line: string): TableAlign[] {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function parseTable(lines: string[], startIndex: number): { block: Block; next: number } {
  const header = splitTableRow(lines[startIndex])
  const align = parseAlignment(lines[startIndex + 1])
  const rows: string[][] = []
  let index = startIndex + 2
  while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
    rows.push(splitTableRow(lines[index]))
    index += 1
  }
  return { block: { kind: 'table', header, rows, align }, next: index }
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (/^\s*```/.test(line)) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', text: codeLines.join('\n') })
      continue
    }

    if (/^\s*$/.test(line)) {
      index += 1
      continue
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2] })
      index += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n') })
      continue
    }

    const itemMatch = line.match(ITEM_PATTERN)
    if (itemMatch) {
      const ordered = /\d/.test(itemMatch[2])
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index]
        const currentMatch = current.match(ITEM_PATTERN)
        if (currentMatch && /\d/.test(currentMatch[2]) === ordered) {
          items.push(currentMatch[3])
          index += 1
        } else if (
          current.trim() !== '' &&
          !/^\s*```/.test(current) &&
          !isTableStart(current, lines[index + 1]) &&
          items.length > 0
        ) {
          items[items.length - 1] += ` ${current.trim()}`
          index += 1
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', list: { kind: ordered ? 'ol' : 'ul', items } })
      continue
    }

    if (isTableStart(line, lines[index + 1])) {
      const { block, next } = parseTable(lines, index)
      blocks.push(block)
      index = next
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      !/^\s*$/.test(lines[index]) &&
      !/^\s*```/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !ITEM_PATTERN.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*(?:[-*_]\s*){3,}$/.test(lines[index]) &&
      !isTableStart(lines[index], lines[index + 1])
    ) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case 'paragraph':
        return <p key={index}>{renderInline(block.text)}</p>
      case 'heading': {
        const Tag = `h${Math.min(block.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
        return <Tag key={index}>{renderInline(block.text)}</Tag>
      }
      case 'list': {
        const Tag = block.list.kind === 'ol' ? 'ol' : 'ul'
        return (
          <Tag key={index}>
            {block.list.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </Tag>
        )
      }
      case 'code':
        return (
          <pre key={index}>
            <code>{block.text}</code>
          </pre>
        )
      case 'quote':
        return <blockquote key={index}>{renderInline(block.text)}</blockquote>
      case 'table':
        return (
          <div key={index} className="table-wrap">
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? 'left' }}>
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? 'left' }}>
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'hr':
        return <hr key={index} />
      default:
        return null
    }
  })
}

function Markdown({ text }: MarkdownProps): React.JSX.Element {
  return <div className="markdown-body">{renderBlocks(parseBlocks(text))}</div>
}

export default Markdown
