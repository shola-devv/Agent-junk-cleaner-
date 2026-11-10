import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type ScanProgress = import('../main/scanner').ScanProgress
  type ScanResult = import('../main/scanner').ScanResult
  type CleanupPlan = {
    id: string
    expiresAt: string
    fileCount: number
    totalBytes: number
  }
  type CleanupOutcome = {
    path: string
    app: string
    sizeBytes: number
    status: 'moved' | 'failed' | 'cancelled'
    message: string
  }
  type CleanupHistoryEntry = {
    id: string
    completedAt: string
    outcomes: CleanupOutcome[]
  }

  interface SystemInfo {
    appVersion: string
    platform: string
    architecture: string
    operatingSystem: string
  }

  interface Window {
    electron: ElectronAPI
    api: {
      getSystemInfo: () => Promise<SystemInfo>
      scanComputer: () => Promise<ScanResult>
      createCleanupPlan: (fileIds: string[]) => Promise<CleanupPlan>
      executeCleanupPlan: (planId: string) => Promise<{
        cancelled: boolean
        outcomes: CleanupOutcome[]
      }>
      getCleanupHistory: () => Promise<CleanupHistoryEntry[]>
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
    }
  }
}

export {}
