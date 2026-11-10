import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ScanProgress } from '../main/scanner'

const api = {
  getSystemInfo: () => ipcRenderer.invoke('app:get-system-info'),
  scanComputer: () => ipcRenderer.invoke('app:scan-computer'),
  createCleanupPlan: (fileIds: string[]) => ipcRenderer.invoke('app:create-cleanup-plan', fileIds),
  executeCleanupPlan: (planId: string) => ipcRenderer.invoke('app:execute-cleanup-plan', planId),
  getCleanupHistory: () => ipcRenderer.invoke('app:get-cleanup-history'),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress)
    ipcRenderer.on('app:scan-progress', listener)
    return () => ipcRenderer.removeListener('app:scan-progress', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore: Expose the preload bridge when context isolation is disabled.
  window.electron = electronAPI

  // @ts-ignore: Expose the preload bridge when context isolation is disabled.
  window.api = api
}
