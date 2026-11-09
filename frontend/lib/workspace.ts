export type WorkspaceEntry = {
  path: string
  name: string
  kind: 'file' | 'dir'
}

export type RunResult = {
  path: string
  ok: boolean
  output: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 404 && url.startsWith('/api/files')) {
      throw new Error(
        'the backend is running an older build without the file API — restart or redeploy it',
      )
    }
    const payload = data as { detail?: string; error?: string } | null
    const detail =
      (payload && (payload.detail || payload.error)) ||
      `Request failed with HTTP ${response.status}`
    throw new Error(detail)
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Lightweight reachability probe; also keeps a sleeping backend warm. */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

export async function listWorkspace(): Promise<WorkspaceEntry[]> {
  const data = await request<{ files: WorkspaceEntry[] }>('/api/files/tree', {
    cache: 'no-store',
  })
  return data.files ?? []
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const data = await request<{ content: string }>(
    `/api/files/read?path=${encodeURIComponent(path)}`,
    { cache: 'no-store' },
  )
  return data.content ?? ''
}

export async function writeWorkspaceFile(
  path: string,
  code: string,
): Promise<WorkspaceEntry[]> {
  const data = await request<{ files: WorkspaceEntry[] }>(
    '/api/files/write',
    json({ path, code }),
  )
  return data.files ?? []
}

export async function renameWorkspacePath(
  path: string,
  newPath: string,
): Promise<WorkspaceEntry[]> {
  const data = await request<{ files: WorkspaceEntry[] }>(
    '/api/files/rename',
    json({ path, new_path: newPath }),
  )
  return data.files ?? []
}

export async function removeWorkspacePath(
  path: string,
): Promise<WorkspaceEntry[]> {
  await request<{ removed: boolean }>('/api/files/rm', json({ path }))
  return listWorkspace()
}

export async function makeWorkspaceDir(
  path: string,
): Promise<WorkspaceEntry[]> {
  await request<{ created: boolean }>('/api/files/mkdir', json({ path }))
  return listWorkspace()
}

export async function runWorkspaceFile(path: string): Promise<RunResult> {
  return request<RunResult>('/api/files/run', json({ path }))
}

/** Joined display path used by the breadcrumb in the title bar. */
export function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}
