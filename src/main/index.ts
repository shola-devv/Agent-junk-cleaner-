import { getScannedFile, scanComputer, ScannedFileSnapshot, validateScannedFile } from './scanner'
import { open } from 'fs/promises'
import { app, shell, BrowserWindow, dialog, ipcMain, MessageBoxOptions } from 'electron'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  executeRegisteredTool,
  ToolRequestLedger,
  TOOL_REGISTRY,
  validateToolRequest
} from './toolRegistry'
import type { LocalToolResult } from '../shared/toolTypes'

const execFileAsync = promisify(execFile)
const PLAN_LIFETIME_MS = 3 * 60 * 1000
const plans = new Map<string, CleanupPlan>()
const cleanupHistory: CleanupHistoryEntry[] = []
const activeToolRequests = new Map<string, AbortController>()
const toolRequestLedger = new ToolRequestLedger()

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

type CleanupOutcome = CleanupHistoryEntry['outcomes'][number]

const DIALOG_FILE_PREVIEW = 12

function describeCleanupFiles(files: ScannedFileSnapshot[]): string {
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  const lines = files
    .slice(0, DIALOG_FILE_PREVIEW)
    .map((file) => `• ${file.candidate.app} — ${file.path} (${formatFileSize(file.size)})`)
  if (files.length > DIALOG_FILE_PREVIEW) {
    lines.push(`• …and ${files.length - DIALOG_FILE_PREVIEW} more`)
  }
  return `${files.length} file${files.length === 1 ? '' : 's'} · ${formatFileSize(totalBytes)}\n${lines.join('\n')}`
}

function formatFileSize(bytes: number): string {
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

/** True when another process (e.g. a running editor) holds the file open. */
async function isFileLocked(filePath: string): Promise<boolean> {
  let handle
  try {
    handle = await open(filePath, 'r+')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ETXTBSY'
  }
  await handle.close()
  return false
}

async function confirmAndTrashFiles(
  parent: BrowserWindow | null,
  files: ScannedFileSnapshot[],
  expiresAt?: number,
  signal?: AbortSignal
): Promise<{ cancelled: boolean; outcomes: CleanupOutcome[] }> {
  const cancelledOutcomes = (): CleanupOutcome[] =>
    files.map((snapshot) => ({
      path: snapshot.path,
      app: snapshot.candidate.app,
      sizeBytes: snapshot.size,
      status: 'cancelled' as const,
      message: 'You cancelled cleanup.'
    }))

  if (signal?.aborted) {
    return { cancelled: true, outcomes: cancelledOutcomes() }
  }

  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Move to Recycle Bin'],
    defaultId: 0,
    cancelId: 0,
    title: 'Approve cleanup',
    message: `Move ${files.length} selected file${files.length === 1 ? '' : 's'} to the Recycle Bin?`,
    detail: `${describeCleanupFiles(files)}\n\nOnly the exact files listed above will be moved. You can restore them from the Recycle Bin.`
  }
  const confirmation = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)

  const outcomes: CleanupOutcome[] = []
  if (confirmation.response !== 1) {
    for (const snapshot of files) {
      outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'cancelled',
        message: 'User cancelled cleanup.'
      })
    }
    return { cancelled: true, outcomes }
  }

  for (const snapshot of files) {
    if (signal?.aborted) {
      outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'cancelled',
        message: 'You cancelled cleanup.'
      })
      continue
    }

    if (expiresAt !== undefined && Date.now() >= expiresAt) {
      outcomes.push({
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
      outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'moved',
        message: 'Moved to the Recycle Bin.'
      })
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Cleanup failed.'
      if (await isFileLocked(snapshot.path)) {
        message = `${snapshot.candidate.app} still has this file open. Close it, then approve cleanup again.`
      } else if (/aborted|denied|in use/i.test(message)) {
        message = 'Windows refused to move this file to the Recycle Bin. Close the app using it and try again.'
      }
      outcomes.push({
        path: snapshot.path,
        app: snapshot.candidate.app,
        sizeBytes: snapshot.size,
        status: 'failed',
        message
      })
    }
  }
  return { cancelled: false, outcomes }
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

  if (Date.now() >= plan.expiresAt)
    throw new Error('This cleanup plan expired. Scan and review again.')

  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = await confirmAndTrashFiles(parent, plan.files, plan.expiresAt)
  addHistory({
    id: plan.id,
    completedAt: new Date().toISOString(),
    outcomes: result.outcomes
  })
  return result
})

ipcMain.handle('app:get-cleanup-history', () => cleanupHistory)

ipcMain.handle('app:run-local-tool', async (event, input: unknown): Promise<LocalToolResult> => {
  const request = validateToolRequest(input)
  toolRequestLedger.claim(request.requestId)

  const controller = new AbortController()
  activeToolRequests.set(request.requestId, controller)
  try {
    const tool = TOOL_REGISTRY[request.toolName]
    const parent = BrowserWindow.fromWebContents(event.sender)
    let detail = `${tool.permissionMessage}\n\n${tool.description}`

    if (request.toolName === 'delete_candidates') {
      const { candidateIds } = request.arguments as { candidateIds: string[] }
      const files: ScannedFileSnapshot[] = []
      for (const id of candidateIds) {
        const snapshot = getScannedFile(id)
        if (!snapshot) {
          return {
            requestId: request.requestId,
            toolName: request.toolName,
            approved: false,
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message:
                'A selected file is not in the latest scan. Run scan_computer again before deleting.'
            }
          }
        }
        files.push(snapshot)
      }
      detail = `${detail}\n\n${describeCleanupFiles(files)}`
    }

    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Deny', 'Allow once'],
      defaultId: 0,
      cancelId: 0,
      title: 'Local assistant action',
      message: tool.title,
      detail
    }
    const confirmation = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)

    if (controller.signal.aborted) {
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        approved: false,
        success: false,
        error: { code: 'CANCELLED', message: 'The request was cancelled.' }
      }
    }
    if (confirmation.response !== 1) {
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        approved: false,
        success: false,
        error: { code: 'USER_DENIED', message: 'You denied this local action.' }
      }
    }

    if (request.toolName === 'delete_candidates') {
      try {
        const { candidateIds } = request.arguments as { candidateIds: string[] }
        const files: ScannedFileSnapshot[] = []
        for (const id of candidateIds) {
          const snapshot = getScannedFile(id)
          if (!snapshot) {
            throw new Error('A selected file is not in the latest scan. Run scan_computer again before deleting.')
          }
          await validateScannedFile(snapshot)
          files.push(snapshot)
        }
        const outcome = await confirmAndTrashFiles(parent, files, undefined, controller.signal)
        addHistory({
          id: request.requestId,
          completedAt: new Date().toISOString(),
          outcomes: outcome.outcomes
        })
        return {
          requestId: request.requestId,
          toolName: request.toolName,
          approved: true,
          success: true,
          result: outcome
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return {
            requestId: request.requestId,
            toolName: request.toolName,
            approved: false,
            success: false,
            error: { code: 'CANCELLED', message: 'The request was cancelled.' }
          }
        }
        return {
          requestId: request.requestId,
          toolName: request.toolName,
          approved: true,
          success: false,
          error: {
            code: 'TOOL_FAILED',
            message: error instanceof Error ? error.message.slice(0, 400) : 'The local tool failed.'
          }
        }
      }
    }

    try {
      const result = await executeRegisteredTool(
        request,
        {
          getSystemInfo: async () => ({
            appVersion: app.getVersion(),
            platform: process.platform,
            architecture: process.arch,
            operatingSystem: process.getSystemVersion()
          })
        },
        controller
      )
      const serialized = JSON.stringify(result)
      if (!serialized || serialized.length > 250_000) {
        throw new Error('Local tool result exceeded the allowed size.')
      }
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        approved: true,
        success: true,
        result: JSON.parse(serialized) as unknown
      }
    } catch (error) {
      const timedOut = controller.signal.reason instanceof Error && controller.signal.reason.name === 'TimeoutError'
      const cancelled = controller.signal.aborted && !timedOut
      return {
        requestId: request.requestId,
        toolName: request.toolName,
        approved: true,
        success: false,
        error: {
          code: timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED' : 'TOOL_FAILED',
          message:
            error instanceof Error ? error.message.slice(0, 400) : 'The local tool failed.'
        }
      }
    }
  } finally {
    activeToolRequests.delete(request.requestId)
  }
})

ipcMain.handle('app:cancel-local-tool', (_event, requestId: unknown) => {
  if (typeof requestId !== 'string') return false
  const controller = activeToolRequests.get(requestId)
  if (!controller) return false
  const error = new Error('Local tool execution was cancelled.')
  error.name = 'AbortError'
  controller.abort(error)
  return true
})

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
