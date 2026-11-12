import { getScannedFile, scanComputer, validateScannedFile } from './scanner'
import {
  APPROVED_LOCAL_TOOLS,
  type ApprovedLocalTool,
  type LocalToolRequest
} from '../shared/toolTypes'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const TOOL_TIMEOUT_MS = 60_000
export class ToolRequestLedger {
  private readonly seen = new Set<string>()

  claim(requestId: string): void {
    if (this.seen.has(requestId)) throw new Error('This local tool request ID has already been used.')
    this.seen.add(requestId)
  }
}

export interface ToolDependencies {
  getSystemInfo: () => Promise<ToolSystemInfo>
  deleteCandidates?: (
    candidateIds: string[],
    signal: AbortSignal
  ) => Promise<{
    cancelled: boolean
    outcomes: Array<{
      path: string
      app: string
      sizeBytes: number
      status: 'moved' | 'failed' | 'cancelled'
      message: string
    }>
  }>
}

export interface ToolSystemInfo {
  appVersion: string
  platform: string
  architecture: string
  operatingSystem: string
}

export interface RegisteredTool {
  name: ApprovedLocalTool
  title: string
  description: string
  permissionMessage: string
}

export const TOOL_REGISTRY: Record<ApprovedLocalTool, RegisteredTool> = {
  get_system_info: {
    name: 'get_system_info',
    title: 'Read basic system information',
    description: 'Returns the operating system, platform, architecture, and app version.',
    permissionMessage: 'Share basic system information with the assistant?'
  },
  scan_computer: {
    name: 'scan_computer',
    title: 'Scan supported AI and developer-tool caches',
    description: 'Performs a read-only scan of supported cache locations.',
    permissionMessage: 'Scan supported AI-agent and developer-tool cache folders? This is read-only.'
  },
  inspect_candidate: {
    name: 'inspect_candidate',
    title: 'Inspect a detected file',
    description: 'Reads metadata for a file found by the latest local scan.',
    permissionMessage: 'Share this scanned file’s name, path, size, and date with the assistant?'
  },
  calculate_storage: {
    name: 'calculate_storage',
    title: 'Calculate cache storage totals',
    description: 'Calculates storage totals from a read-only scan of supported cache locations.',
    permissionMessage: 'Scan supported cache folders and calculate their storage totals? This is read-only.'
  },
  delete_candidates: {
    name: 'delete_candidates',
    title: 'Move selected cache files to the Recycle Bin',
    description:
      'Moves exact files from the latest local scan to the Recycle Bin after a second confirmation dialog. Files can be restored from the Recycle Bin.',
    permissionMessage:
      'Move the selected scanned cache files to the Recycle Bin? This deletes files and requires another confirmation.'
  }
}

export function validateToolRequest(input: unknown): LocalToolRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid local-tool request.')
  }
  const request = input as Record<string, unknown>
  if (
    Object.keys(request).some((key) => !['requestId', 'toolName', 'arguments'].includes(key)) ||
    Object.keys(request).length !== 3 ||
    typeof request.requestId !== 'string' ||
    !UUID_PATTERN.test(request.requestId) ||
    typeof request.toolName !== 'string' ||
    !APPROVED_LOCAL_TOOLS.includes(request.toolName as ApprovedLocalTool)
  ) {
    throw new Error('Unknown or invalid local tool request.')
  }

  const toolName = request.toolName as ApprovedLocalTool
  const args = request.arguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('Tool arguments must be a JSON object.')
  }
  const keys = Object.keys(args as Record<string, unknown>)
  if (toolName === 'inspect_candidate') {
    const values = args as Record<string, unknown>
    if (
      keys.length !== 1 ||
      typeof values.candidateId !== 'string' ||
      !UUID_PATTERN.test(values.candidateId)
    ) {
      throw new Error('inspect_candidate requires only a valid candidateId from the latest scan.')
    }
  } else if (toolName === 'delete_candidates') {
    const values = args as Record<string, unknown>
    const ids = values.candidateIds
    if (
      keys.length !== 1 ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(
        'delete_candidates requires only candidateIds: a non-empty list of unique file IDs from the latest scan.'
      )
    }
  } else if (keys.length !== 0) {
    throw new Error(`${toolName} does not accept arguments.`)
  }

  return { requestId: request.requestId, toolName, arguments: args }
}

export async function executeRegisteredTool(
  request: LocalToolRequest,
  dependencies: ToolDependencies,
  controller: AbortController,
  timeoutMs = TOOL_TIMEOUT_MS
): Promise<unknown> {
  const { signal } = controller
  const timeout = setTimeout(() => {
    const error = new Error('Local tool execution timed out.')
    error.name = 'TimeoutError'
    controller.abort(error)
  }, timeoutMs)
  const operation = executeTool(request, dependencies, signal)
  let abortListener: (() => void) | undefined
  const cancellation = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Local tool execution was cancelled.'))
      return
    }
    abortListener = () =>
      reject(signal.reason ?? new Error('Local tool execution was cancelled.'))
    signal.addEventListener('abort', abortListener, { once: true })
  })

  try {
    return await Promise.race([operation, cancellation])
  } finally {
    clearTimeout(timeout)
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }
}

async function executeTool(
  request: LocalToolRequest,
  dependencies: ToolDependencies,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) throw signal.reason ?? new Error('Local tool execution was cancelled.')

  if (request.toolName === 'get_system_info') return dependencies.getSystemInfo()

  if (request.toolName === 'delete_candidates') {
    const { candidateIds } = request.arguments as { candidateIds: string[] }
    if (!dependencies.deleteCandidates) {
      throw new Error('Deletion is not available in this context.')
    }
    for (const id of candidateIds) {
      if (!getScannedFile(id)) {
        throw new Error(
          `Candidate ${id} is not in the latest scan. Run scan_computer again before deleting.`
        )
      }
    }
    return dependencies.deleteCandidates(candidateIds, signal)
  }

  if (request.toolName === 'inspect_candidate') {
    const { candidateId } = request.arguments as { candidateId: string }
    const snapshot = getScannedFile(candidateId)
    if (!snapshot) throw new Error('That candidate is not in the latest scan. Scan again first.')
    await validateScannedFile(snapshot)
    if (signal.aborted) throw signal.reason ?? new Error('Local tool execution was cancelled.')
    return {
      id: snapshot.candidate.id,
      app: snapshot.candidate.app,
      name: snapshot.candidate.name,
      path: snapshot.path,
      sizeBytes: snapshot.size,
      lastModified: snapshot.candidate.lastModified,
      category: snapshot.candidate.category,
      risk: snapshot.candidate.risk,
      reason: snapshot.candidate.reason
    }
  }

  const scan = await scanComputer(undefined, signal)
  if (request.toolName === 'scan_computer') {
    return {
      filesFound: scan.candidates.length,
      totalBytes: scan.totalBytes,
      scannedLocations: scan.scannedLocations,
      unavailableLocations: scan.unavailableLocations,
      truncated: scan.truncated,
      candidates: scan.candidates.map(({ id, app, name, sizeBytes, category, risk }) => ({
        id,
        app,
        name,
        sizeBytes,
        category,
        risk
      }))
    }
  }

  const byApplication = new Map<string, { files: number; totalBytes: number }>()
  for (const candidate of scan.candidates) {
    const current = byApplication.get(candidate.app) ?? { files: 0, totalBytes: 0 }
    current.files++
    current.totalBytes += candidate.sizeBytes
    byApplication.set(candidate.app, current)
  }
  return {
    filesFound: scan.candidates.length,
    totalBytes: scan.totalBytes,
    scannedLocations: scan.scannedLocations,
    byApplication: Object.fromEntries(byApplication)
  }
}
