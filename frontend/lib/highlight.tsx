import type { ReactNode } from 'react'

// A tiny dependency-free tokenizer. It only needs to be good enough for the
// handful of languages the sandbox can run (Python, JavaScript/TypeScript) and
// common project files (JSON, Markdown, shell).

const KEYWORDS = new Set([
  // Python
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not',
  'and', 'or', 'import', 'from', 'as', 'with', 'try', 'except', 'finally',
  'raise', 'pass', 'break', 'continue', 'lambda', 'yield', 'global', 'nonlocal',
  'assert', 'del', 'is', 'None', 'True', 'False', 'async', 'await', 'match',
  'case', 'self',
  // JavaScript / TypeScript
  'const', 'let', 'var', 'function', 'new', 'typeof', 'instanceof', 'delete',
  'void', 'null', 'undefined', 'this', 'super', 'export', 'default', 'extends',
  'implements', 'interface', 'type', 'enum', 'static', 'public', 'private',
  'protected', 'readonly', 'switch', 'throw', 'catch', 'do', 'of', 'get', 'set',
])

const TOKEN_RE =
  /(#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g

export type Language =
  | 'python'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'shell'
  | 'text'

export function languageForPath(path: string | null): Language {
  if (!path) return 'text'
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'py':
    case 'pyi':
      return 'python'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'sh':
    case 'bash':
      return 'shell'
    default:
      return 'text'
  }
}

export function languageLabel(path: string | null): string {
  switch (languageForPath(path)) {
    case 'python':
      return 'Python'
    case 'javascript':
      return 'JavaScript'
    case 'json':
      return 'JSON'
    case 'markdown':
      return 'Markdown'
    case 'shell':
      return 'Shell'
    default:
      return 'Plain Text'
  }
}

/** Returns highlighted React nodes for the editor overlay. */
export function highlightCode(code: string, language: Language): ReactNode {
  if (language === 'markdown' || language === 'text') return code

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  TOKEN_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(code.slice(lastIndex, match.index))
    }

    const [text, comment, string, number, word] = match
    let className = ''
    if (comment) {
      className = 'syn-comment'
    } else if (string) {
      className = 'syn-string'
    } else if (number) {
      className = 'syn-number'
    } else if (word) {
      if (KEYWORDS.has(word)) {
        className = 'syn-keyword'
      } else if (code[match.index + word.length] === '(') {
        className = 'syn-function'
      }
    }

    nodes.push(
      className ? (
        <span key={key++} className={className}>
          {text}
        </span>
      ) : (
        text
      ),
    )
    lastIndex = match.index + text.length
  }

  if (lastIndex < code.length) nodes.push(code.slice(lastIndex))
  return nodes
}
