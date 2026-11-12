export const APPROVED_LOCAL_TOOLS = [
  'get_system_info',
  'scan_computer',
  'inspect_candidate',
  'calculate_storage',
  'delete_candidates'
] as const

export type ApprovedLocalTool = (typeof APPROVED_LOCAL_TOOLS)[number]

export interface LocalToolRequest {
  requestId: string
  toolName: ApprovedLocalTool
  arguments: unknown
}

export interface LocalToolResult {
  requestId: string
  toolName: ApprovedLocalTool
  approved: boolean
  success: boolean
  result?: unknown
  error?: {
    code: 'USER_DENIED' | 'TOOL_FAILED' | 'INVALID_REQUEST' | 'CANCELLED' | 'TIMEOUT'
    message: string
  }
}

export interface ToolScanSummary {
  filesFound: number
  totalBytes: number
  scannedLocations: number
  unavailableLocations: number
  truncated: boolean
  candidates: Array<{
    id: string
    app: string
    name: string
    sizeBytes: number
    category: string
    risk: string
  }>
}
