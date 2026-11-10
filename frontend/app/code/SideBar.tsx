'use client'

import { useMemo, useState } from 'react'

import type { WorkspaceEntry } from '@/lib/workspace'

interface SideBarProps {
  files: WorkspaceEntry[]
  activeFile: string | null
  dirtyPaths: string[]
  view: string
  loading?: boolean
  offline?: boolean
  onOpenFile: (path: string) => void
  onCreateFile: (dir: string) => void
  onCreateFolder: (dir: string) => void
  onOpenFolder: () => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onRefresh: () => void
  onToggle: () => void
  onSelectView: (view: string) => void
}

const VIEW_TITLES: Record<string, string> = {
  explorer: 'EXPLORER',
  search: 'SEARCH',
  'source-control': 'SOURCE CONTROL',
  'run-debug': 'RUN & DEBUG',
  extensions: 'EXTENSIONS',
  voice: 'VOICE',
}

type TreeNode = WorkspaceEntry & { children: TreeNode[] }

function buildTree(entries: WorkspaceEntry[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const entry of [...entries].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const node: TreeNode = { ...entry, children: [] }
    map.set(entry.path, node)
    const slash = entry.path.lastIndexOf('/')
    const parent = slash === -1 ? '' : entry.path.slice(0, slash)
    const parentNode = parent ? map.get(parent) : undefined
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) sort(node.children)
  }
  sort(roots)
  return roots
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />
    </svg>
  )
}

function IconFile() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconFolderPlus() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

function IconOpenFolder() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6" />
      <path d="m9 14 3-3 3 3" />
    </svg>
  )
}

export function SideBar({
  files,
  activeFile,
  dirtyPaths,
  view,
  loading = false,
  offline = false,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onOpenFolder,
  onRename,
  onDelete,
  onRefresh,
  onToggle,
  onSelectView,
}: SideBarProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [query, setQuery] = useState('')

  const tree = useMemo(() => buildTree(files), [files])
  const dirty = useMemo(() => new Set(dirtyPaths), [dirtyPaths])
  const isExplorer = view === 'explorer'
  const isSearch = view === 'search'

  const toggleDir = (path: string) =>
    setCollapsed((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return files
      .filter(
        (entry) =>
          entry.kind === 'file' && entry.path.toLowerCase().includes(q),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [files, query])

  const newFileIn = parentOfActive(activeFile)

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isDir = node.kind === 'dir'
    const isOpen = !collapsed.includes(node.path)
    const isActive = node.path === activeFile

    return (
      <div key={node.path}>
        <div
          className={`ide-tree-row group ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => (isDir ? toggleDir(node.path) : onOpenFile(node.path))}
          title={node.path}
          role="treeitem"
          aria-expanded={isDir ? isOpen : undefined}
          aria-selected={isActive}
        >
          <span className="ide-tree-arrow w-3 flex items-center justify-center">
            {isDir ? <IconChevron open={isOpen} /> : null}
          </span>
          <span className={isDir ? 'text-[#dcb67a]' : 'text-white/45'}>
            {isDir ? <IconFolder /> : <IconFile />}
          </span>
          <span
            className={`truncate flex-1 text-[13px] ${isActive ? 'text-white' : 'text-white/75'}`}
          >
            {node.name}
          </span>
          {!isDir && dirty.has(node.path) && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#635bff] shrink-0"
              title="Unsaved changes"
            />
          )}
          <span className="ide-tree-actions flex items-center gap-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRename(node.path)
              }}
              className="ide-tree-action"
              title={`Rename ${node.name}`}
              aria-label={`Rename ${node.name}`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(node.path)
              }}
              className="ide-tree-action hover:!text-[#f48771]"
              title={`Delete ${node.name}`}
              aria-label={`Delete ${node.name}`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </span>
        </div>
        {isDir &&
          isOpen &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="ide-sidebar w-60 shrink-0 flex flex-col">
      <div className="ide-sidebar-title flex items-center justify-between">
        <span>{VIEW_TITLES[view] || 'EXPLORER'}</span>
        <button
          onClick={onToggle}
          className="w-5 h-5 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {isSearch && (
        <div className="p-2 border-b border-white/5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files by name"
            className="w-full bg-[#3c3c3c] border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 outline-none focus:border-[#635bff]"
          />
        </div>
      )}

      {(isExplorer || isSearch) && (
        <>
          {isExplorer && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5">
              <button
                onClick={() => onCreateFile(newFileIn)}
                className="flex-1 flex items-center justify-center gap-1.5 px-1.5 py-1 text-[11px] text-white/60 hover:bg-white/5 hover:text-white rounded transition-colors"
                title="New File"
              >
                <IconPlus />
                File
              </button>
              <button
                onClick={() => onCreateFolder(newFileIn)}
                className="flex-1 flex items-center justify-center gap-1.5 px-1.5 py-1 text-[11px] text-white/60 hover:bg-white/5 hover:text-white rounded transition-colors"
                title="New Folder"
              >
                <IconFolderPlus />
                Folder
              </button>
              <button
                onClick={onOpenFolder}
                className="w-6 h-6 flex items-center justify-center text-white/50 hover:bg-white/5 hover:text-white rounded transition-colors"
                title="Open Folder from System"
                aria-label="Open Folder from System"
              >
                <IconOpenFolder />
              </button>
              <button
                onClick={onRefresh}
                className="w-6 h-6 flex items-center justify-center text-white/50 hover:bg-white/5 hover:text-white rounded transition-colors"
                title="Refresh Explorer"
                aria-label="Refresh Explorer"
              >
                <IconRefresh />
              </button>
            </div>
          )}

          <div className="ide-section-body flex-1 py-1">
            {loading && files.length === 0 && (
              <div className="text-xs text-white/35 p-2">
                Loading workspace…
              </div>
            )}

            {!loading && files.length === 0 && (
              <div className="mx-2 mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/55">
                <div className="mb-1 text-sm font-medium text-white/80">Your workspace is empty</div>
                <p className="mb-3 text-white/45">
                  Create a file, make a folder, or import a folder from your system to get started.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onCreateFile('')}
                    className="rounded-md bg-[#635bff]/20 px-2.5 py-1.5 text-left text-[#d7d2ff] hover:bg-[#635bff]/30 transition-colors"
                  >
                    + New file
                  </button>
                  <button
                    onClick={onOpenFolder}
                    className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    Open folder from system
                  </button>
                </div>
              </div>
            )}

            {isExplorer && files.length > 0 && (
              <div role="tree" aria-label="Workspace files">
                {tree.map((node) => renderNode(node, 0))}
              </div>
            )}

            {isSearch && query.trim() !== '' && (
              <div className="px-1">
                <div className="px-2 py-1 text-[11px] text-white/35">
                  {matches.length} {matches.length === 1 ? 'result' : 'results'}
                </div>
                {matches.map((entry) => (
                  <div
                    key={entry.path}
                    className={`ide-tree-row group ${entry.path === activeFile ? 'active' : ''}`}
                    style={{ paddingLeft: 10 }}
                    onClick={() => onOpenFile(entry.path)}
                    title={entry.path}
                  >
                    <span className="text-white/45">
                      <IconFile />
                    </span>
                    <span className="truncate flex-1 text-[13px] text-white/75">
                      {entry.path}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!isExplorer && !isSearch && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <span className="text-xs text-white/40">
            {VIEW_TITLES[view] || view} is not available yet.
          </span>
          <button
            onClick={() => onSelectView('explorer')}
            className="text-xs px-2 py-1 rounded bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            Back to Explorer
          </button>
        </div>
      )}

      {offline && (
        <div className="px-3 py-2 border-t border-white/5 text-[11px] text-amber-300/80 leading-snug">
          Backend unreachable. Files are read-only until it reconnects.
        </div>
      )}
    </aside>
  )
}

function parentOfActive(path: string | null): string {
  if (!path) return ''
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}
