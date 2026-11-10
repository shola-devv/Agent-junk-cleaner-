import { randomUUID } from 'crypto'
import { lstat, opendir } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'

export interface CleanupCandidate {
  id: string
  app: string
  name: string
  displayPath: string
  sizeBytes: number
  lastModified: string
  category: 'cache' | 'temporary' | 'build-artifact'
  disposition: 'recreatable' | 'review-only'
  detectionRule: string
  risk: 'low' | 'medium'
  reason: string
}

export interface ScanProgress {
  directoriesScanned: number
  filesFound: number
}

export interface ScanResult {
  candidates: CleanupCandidate[]
  totalBytes: number
  scannedLocations: number
  unavailableLocations: number
  truncated: boolean
  message: string
}

interface CacheRoot {
  app: string
  path: string
  folder: string
}

export interface ScannedFileSnapshot {
  candidate: CleanupCandidate
  path: string
  rootPath: string
  size: number
  modifiedAt: number
  device: number
  inode: number
}

const scannedFiles = new Map<string, ScannedFileSnapshot>()
const MAX_FILES = 1000
const MAX_DIRECTORIES = 2000
const MAX_ENTRIES = 50000
const MAX_DEPTH = 8
const EDITOR_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'ShaderCache']
const PROTECTED_PATH_NAMES = new Set([
  'history',
  'histories',
  'conversation',
  'conversations',
  'memory',
  'memories',
  'models',
  'projects',
  'settings',
  'workspacestorage'
])
const BUILD_DIRECTORY_NAMES = new Set([
  'build',
  'dist',
  'out',
  'target',
  'node_modules',
  '.next',
  '.turbo',
  '.vite'
])

function getCacheRoots(): CacheRoot[] {
  const appData = process.env.APPDATA
  const localAppData = process.env.LOCALAPPDATA
  const home = process.env.USERPROFILE
  const roots: CacheRoot[] = []
  const addRoots = (app: string, base: string | undefined, folders: string[]): void => {
    if (base) {
      roots.push(...folders.map((folder) => ({ app, path: join(base, folder), folder })))
    }
  }

  addRoots('Cursor', appData && join(appData, 'Cursor'), EDITOR_CACHES)
  addRoots('Windsurf', appData && join(appData, 'Windsurf'), EDITOR_CACHES)
  addRoots('VS Code', appData && join(appData, 'Code'), EDITOR_CACHES)

  // Only inspect each tool's explicit cache directory; histories, settings,
  // projects, extension state, and model data are deliberately out of scope.
  addRoots('Claude Code', home && join(home, '.claude'), ['cache'])
  addRoots('OpenCode', home && join(home, '.cache'), ['opencode'])
  addRoots('OpenCode', localAppData && join(localAppData, 'opencode'), ['Cache'])
  addRoots('Codex', home && join(home, '.codex'), ['cache'])
  addRoots('Codex', localAppData && join(localAppData, 'OpenAI', 'Codex'), ['Cache'])
  addRoots(
    'Cline',
    appData && join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
    ['cache']
  )
  addRoots(
    'Cline',
    appData && join(appData, 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
    ['cache']
  )
  return roots.filter((root) => root.folder !== '')
}

export async function scanComputer(
  onProgress: (progress: ScanProgress) => void = () => {}
): Promise<ScanResult> {
  scannedFiles.clear()
  const candidates: CleanupCandidate[] = []
  const roots = getCacheRoots()
  let scannedLocations = 0
  let unavailableLocations = 0
  let directoriesScanned = 0
  let entriesScanned = 0
  let truncated = false

  const reportProgress = (): void => {
    onProgress({ directoriesScanned, filesFound: candidates.length })
  }

  async function scanDirectory(root: CacheRoot, currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || directoriesScanned >= MAX_DIRECTORIES) {
      truncated = true
      return
    }

    let directory
    try {
      const info = await lstat(currentPath)
      if (!info.isDirectory() || info.isSymbolicLink()) return
      directory = await opendir(currentPath)
    } catch {
      unavailableLocations++
      return
    }

    directoriesScanned++
    if (depth === 0) scannedLocations++
    reportProgress()

    try {
      for await (const entry of directory) {
        entriesScanned++
        if (entriesScanned > MAX_ENTRIES || candidates.length >= MAX_FILES) {
          truncated = true
          return
        }

        if (entry.isSymbolicLink()) continue

        const fullPath = join(currentPath, entry.name)
        if (entry.isDirectory()) {
          if (depth >= MAX_DEPTH || directoriesScanned >= MAX_DIRECTORIES) {
            truncated = true
            continue
          }
          await scanDirectory(root, fullPath, depth + 1)
          continue
        }

        if (!entry.isFile()) continue

        try {
          const info = await lstat(fullPath)
          if (!info.isFile() || info.isSymbolicLink()) continue
          const relativePath = relative(root.path, fullPath)
          const pathParts = relativePath.split(/[\\/]/)
          if (pathParts.some((part) => PROTECTED_PATH_NAMES.has(part.toLowerCase()))) continue

          const isBuildArtifact = pathParts
            .slice(0, -1)
            .some((part) => BUILD_DIRECTORY_NAMES.has(part.toLowerCase()))
          const isTemporary = /\.(tmp|temp|part)$/i.test(entry.name)
          const category = isBuildArtifact ? 'build-artifact' : isTemporary ? 'temporary' : 'cache'
          const candidate: CleanupCandidate = {
            id: randomUUID(),
            app: root.app,
            name: entry.name,
            displayPath: fullPath,
            sizeBytes: info.size,
            lastModified: info.mtime.toISOString(),
            category,
            disposition:
              category === 'cache' &&
              ['GPUCache', 'DawnCache', 'ShaderCache', 'Code Cache'].includes(root.folder)
                ? 'recreatable'
                : 'review-only',
            detectionRule: `${root.app} ${root.folder} cache${isBuildArtifact ? ' build output' : isTemporary ? ' temporary file' : ''}`,
            risk:
              category === 'cache' &&
              ['GPUCache', 'DawnCache', 'ShaderCache', 'Code Cache'].includes(root.folder)
                ? 'low'
                : 'medium',
            reason:
              category === 'cache' &&
              ['GPUCache', 'DawnCache', 'ShaderCache', 'Code Cache'].includes(root.folder)
                ? 'Generated cache data that the application can recreate.'
                : 'Potentially useful data; inspect the exact path before deciding.'
          }
          candidates.push(candidate)
          scannedFiles.set(candidate.id, {
            candidate,
            path: fullPath,
            rootPath: root.path,
            size: info.size,
            modifiedAt: info.mtimeMs,
            device: info.dev,
            inode: info.ino
          })
          reportProgress()
        } catch {
          unavailableLocations++
        }
      }
    } catch {
      unavailableLocations++
    }
  }

  reportProgress()
  for (const root of roots) {
    if (truncated) break
    await scanDirectory(root, root.path, 0)
  }

  candidates.sort((a, b) => b.sizeBytes - a.sizeBytes)
  const totalBytes = candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0)
  const message =
    candidates.length > 0
      ? `Found ${candidates.length} cache files (${formatBytes(totalBytes)}). Nothing was changed.`
      : roots.length === 0
        ? 'Scanning is available on Windows user accounts; no cache locations were configured.'
        : `No cache files were found. ${scannedLocations} locations scanned; ${unavailableLocations} were missing or inaccessible.`

  return { candidates, totalBytes, scannedLocations, unavailableLocations, truncated, message }
}

export function getScannedFile(id: string): ScannedFileSnapshot | undefined {
  return scannedFiles.get(id)
}

export async function validateScannedFile(snapshot: ScannedFileSnapshot): Promise<void> {
  if (scannedFiles.get(snapshot.candidate.id) !== snapshot) {
    throw new Error('This file is no longer part of the current scan. Scan again.')
  }

  const rootPath = resolve(snapshot.rootPath)
  const filePath = resolve(snapshot.path)
  const relativePath = relative(rootPath, filePath)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('The file is outside its approved cache directory.')
  }

  const pathParts = filePath.slice(rootPath.length).split(sep).filter(Boolean)
  let currentPath = rootPath
  const rootInfo = await lstat(currentPath)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('The approved cache directory is missing or unsafe.')
  }

  for (let index = 0; index < pathParts.length; index++) {
    currentPath = join(currentPath, pathParts[index])
    const info = await lstat(currentPath)
    if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed.')
    if (index < pathParts.length - 1 && !info.isDirectory()) {
      throw new Error('A path component is no longer a directory.')
    }
    if (index === pathParts.length - 1) {
      if (!info.isFile()) throw new Error('The scanned path is no longer a regular file.')
      if (
        info.size !== snapshot.size ||
        info.mtimeMs !== snapshot.modifiedAt ||
        (snapshot.inode !== 0 && info.ino !== snapshot.inode) ||
        (snapshot.device !== 0 && info.dev !== snapshot.device)
      ) {
        throw new Error('The file changed after scanning. Scan again before cleanup.')
      }
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(1)} ${units[unit]}`
}
