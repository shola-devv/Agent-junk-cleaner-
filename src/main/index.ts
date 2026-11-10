import { getScannedFile, scanComputer, ScannedFileSnapshot, validateScannedFile } from './scanner'
import { app, shell, BrowserWindow, dialog, ipcMain, MessageBoxOptions } from 'electron'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const execFileAsync = promisify(execFile)
const PLAN_LIFETIME_MS = 3 * 60 * 1000
const plans = new Map<string, CleanupPlan>()
const cleanupHistory: CleanupHistoryEntry[] = []

interface CleanupPlan {
  id: string
  expiresAt: number
  files: ScannedFileSnapshot[]
}

interface CleanupHistoryEntry {
  id: string
  completedAt: string
  outcomes: Array<{
    path: string
    app: string
    sizeBytes: number
    status: 'moved' | 'failed' | 'cancelled'
    message: string
  }>
}

function getPathAncestors(filePath: string): string[] {
  const paths: string[] = []
  let current = filePath
  while (true) {
    paths.push(current)
    const parent = dirname(current)
    if (parent === current) return paths
    current = parent
  }
}

async function rejectWindowsReparsePoints(filePaths: string[]): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$paths = ConvertFrom-Json -InputObject $env:AGENTJUNK_PATHS; foreach ($path in $paths) { $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop; if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 } }'
      ],
      {
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, AGENTJUNK_PATHS: JSON.stringify(filePaths) }
      }
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: string | number }).code
    if (String(code) === '3') {
      throw new Error('A Windows reparse point was found in the file path.', { cause: error })
    }
    throw new Error('Could not verify Windows reparse-point safety; cleanup was blocked.', {
      cause: error
    })
  }
}

function addHistory(entry: CleanupHistoryEntry): void {
  cleanupHistory.unshift(entry)
  cleanupHistory.splice(100)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:get-system-info', () => {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    operatingSystem: process.getSystemVersion()
  }
})
let activeScan: Promise<Awaited<ReturnType<typeof scanComputer>>> | null = null

ipcMain.handle('app:scan-computer', async (event) => {
  if (activeScan) return activeScan

  plans.clear()
  const scan = scanComputer((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('app:scan-progress', progress)
  })
  activeScan = scan
  try {
    return await scan
  } finally {
    activeScan = null
  }
})

ipcMain.handle('app:create-cleanup-plan', async (_event, fileIds: unknown) => {
  if (
    !Array.isArray(fileIds) ||
    fileIds.length === 0 ||
    fileIds.length > 1000 ||
    fileIds.some((id) => typeof id !== 'string') ||
    new Set(fileIds).size !== fileIds.length
  ) {
    throw new Error('Select one or more valid files before preparing a cleanup plan.')
  }

  const snapshots: ScannedFileSnapshot[] = []
  for (const id of fileIds as string[]) {
    const snapshot = getScannedFile(id)
    if (!snapshot) throw new Error('The selection contains files that were not in the latest scan.')
    snapshots.push(snapshot)
  }
  for (const snapshot of snapshots) await validateScannedFile(snapshot)

  const id = randomUUID()
  const expiresAt = Date.now() + PLAN_LIFETIME_MS
  plans.set(id, { id, expiresAt, files: snapshots })
  return {
    id,
    expiresAt: new Date(expiresAt).toISOString(),
    fileCount: snapshots.length,
    totalBytes: snapshots.reduce((total, file) => total + file.size, 0)
  }
})

ipcMain.handle('app:execute-cleanup-plan', async (event, planId: unknown) => {
  if (typeof planId !== 'string') throw new Error('Invalid cleanup plan.')
  const plan = plans.get(planId)
  if (!plan) throw new Error('This cleanup plan is invalid, already used, or expired.')
  plans.delete(planId)
  if (Date.now() >= plan.expiresAt)
    throw new Error('This cleanup plan expired. Scan and review again.')

  const parent = BrowserWindow.fromWebContents(event.sender)
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Move to Recycle Bin'],
    defaultId: 0,
    cancelId: 0,
    title: 'Approve cleanup',
    message: `Move ${plan.files.length} selected file${plan.files.length === 1 ? '' : 's'} to the Recycle Bin?`,
    detail:
      'Only the exact files in this reviewed plan will be moved. You can restore them from the Recycle Bin.'
  }
  const confirmation = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)

  const entry: CleanupHistoryEntry = {
    id: plan.id,
    completedAt: new Date().toISOString(),
    outcomes: []
  }
  if (confirmation.response !== 1) {
    entry.outcomes = plan.files.map(({ candidate, size }) => ({
      path: candidate.displayPath,
      app: candidate.app,
      sizeBytes: size,
      status: 'cancelled',
      message: 'User cancelled cleanup.'
    }))
    addHistory(entry)
    return { cancelled: true, outcomes: entry.outcomes }
  }
  if (Date.now() >= plan.expiresAt)
    throw new Error('This cleanup plan expired. Scan and review again.')

  for (const snapshot of plan.files) {
    if (Date.now() >= plan.expiresAt) {
      entry.outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'failed',
        message: 'The cleanup plan expired before this file could be moved.'
      })
      continue
    }

    try {
      await validateScannedFile(snapshot)
      await rejectWindowsReparsePoints(getPathAncestors(snapshot.path))
      await validateScannedFile(snapshot)
      await shell.trashItem(snapshot.path)
      entry.outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'moved',
        message: 'Moved to the Recycle Bin.'
      })
    } catch (error) {
      entry.outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Cleanup failed.'
      })
    }
  }
  addHistory(entry)
  return { cancelled: false, outcomes: entry.outcomes }
})

ipcMain.handle('app:get-cleanup-history', () => cleanupHistory)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agentjunkcleaner')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
