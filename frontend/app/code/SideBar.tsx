'use client'

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
  view: string
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

export function SideBar({
  files,
  activeFile,
  onOpenFile,
  onCreateFile,
  view,
  onToggle,
  onSelectView,
}: SideBarProps) {
  const fileList = files.filter((f) => f.kind === 'file')
  const dirList = files.filter((f) => f.kind === 'dir')
  const isExplorer = view === 'explorer'

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {isExplorer ? (
        <>
          <div className="p-1 border-b border-white/5">
            <button
              onClick={onCreateFile}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white rounded transition-colors"
              title="New File"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New File
            </button>
          </div>

          <div className="ide-section-body flex-1 p-1">
            {dirList.length > 0 && (
              <>
                <div className="ide-sidebar-title !border-b-0 !px-2 !py-2">FOLDERS</div>
                {dirList.map((dir) => (
                  <div key={dir.path} className="ide-sidebar-item" onClick={() => onOpenFile(dir.path)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 20v-6a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v6" />
                      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                    </svg>
                    {dir.name}
                  </div>
                ))}
              </>
            )}

            <div className="ide-sidebar-title !border-b-0 !px-2 !py-2 mt-1">OPEN EDITORS</div>
            {fileList.length === 0 ? (
              <div className="text-xs text-white/30 p-2 italic">No files</div>
            ) : (
              fileList.map((file) => (
                <div
                  key={file.path}
                  className={`ide-sidebar-item ${activeFile === file.path ? 'active' : ''}`}
                  onClick={() => onOpenFile(file.path)}
                  title={file.path}
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
        </>
      ) : (
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
    </aside>
  )
}
