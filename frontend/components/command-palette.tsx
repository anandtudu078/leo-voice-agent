import { useState } from 'react'
import { Search } from 'lucide-react'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recentCommands, setRecentCommands] = useState([
    { name: 'New Project', description: 'Create a new project' },
    { name: 'Open File', description: 'Open an existing file' },
    { name: 'Refactor', description: 'Refactor selected code' },
    { name: 'Debug', description: 'Debug current execution' },
    { name: 'New Terminal', description: 'Open a new terminal' },
  ])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
  }

  const executeCommand = (command: string) => {
    setOpen(false)
    setQuery('')
    // Execute the command
    console.log('Executing:', command)
  }

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4" />
        <span>Cmd+K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0">
          <div className="relative min-h-screen flex items-start justify-center p-6 pb-20 overflow-hidden">
            <div className="w-full max-w-lg bg-card rounded-xl shadow-lg space-y-6">
              <div className="flex items-center justify-between pb-2 border-b">
                <h2 className="text-xl font-semibold">Command Palette</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 hover:bg-accent"
                  aria-label="Close command palette"
                >
                  <span className="slash-through line-through opacity-40">
                    /
                  </span>
                </button>
              </div>

              <div>
                <input
                  type="search"
                  placeholder="Search commands or quick actions..."
                  onChange={handleSearch}
                  className="flex-1 rounded-lg border border-input p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  defaultValue="/"
                />
              </div>

              <ul className="space-y-1 max-h-80 overflow-y-auto">
                {recentCommands.map((cmd) => (
                  <li
                    key={cmd.name}
                    onClick={() => executeCommand(cmd.name)}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent/50 transition-colors"
                  >
                    <div className="w-3 h-3 rounded-full bg-primary" />
                    <span className="flex-1">{cmd.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {cmd.description}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="pt-4 border-t text-sm text-muted-foreground">
                <p>Type / for more commands</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
