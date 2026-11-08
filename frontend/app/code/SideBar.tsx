'use client'

import { useState } from 'react'

interface FileNode {
  path: string
  kind: 'file' | 'dir'
  name: string
}

interface SideBarProps {
  files: FileNode[]
  activeFile: string | null
  onOpenFile: (path: string) => void
  onCreateFile: () => void
}

export function SideBar({
  files,
  activeFile,
  onOpenFile,
  onCreateFile,
}: SideBarProps) {
  const [collapsed, setCollapsed] = useState(false)

  const fileList = files.filter((f) => f.kind === 'file')
  const dirList = files.filter((f) => f.kind === 'dir')

  return (
    <>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-3 w-6 h-6 rounded-md bg-[#2d2d2d] border border-white/10 text-white/50 flex items-center justify-center hover:text-white hover:border-white/20 transition-colors"
        aria-label="Collapse sidebar"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? (
            <polyline points="15 18 9 12 15 6" />
          ) : (
            <polyline points="9 18 15 12 9 6" />
          )}
        </svg>
      </button>

      <aside
        className={`ide-sidebar fixed left-[44px] top-56 bottom-0 z-40 w-64 h-full ${
          collapsed ? 'translate-x-[-220px]' : ''
        } transition-transform duration-200`}
      >
        <div className="ide-sidebar-title">EXPLORER</div>

        <div className="p-1">
          <button
            onClick={onCreateFile}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white rounded transition-colors"
            title="New File"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2" />
              <path d="M12 2v20M2 12h20" />
            </svg>
            New File
          </button>
        </div>

        {dirList.length > 0 && (
          <>
            <div className="ide-sidebar-title mt-2">FOLDERS</div>
            <div className="p-1">
            {dirList.map((dir) => (
              <div
                key={dir.path}
                className="ide-sidebar-item"
                onClick={() => onOpenFile(dir.path)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 20v-6a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v6" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                </svg>
                {dir.name}
              </div>
            ))}
          </div>
          </>
        )}

        <div className="ide-sidebar-title mt-3">OPEN EDITORS</div>
        <div className="p-1">
          {fileList.length === 0 ? (
            <div className="text-xs text-white/30 p-2 italic">No files</div>
          ) : (
            fileList.map((file) => (
              <div
                key={file.path}
                className={`ide-sidebar-item ${activeFile === file.path ? 'active' : ''} file`}
                onClick={() => onOpenFile(file.path)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                {file.name}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  )
}
