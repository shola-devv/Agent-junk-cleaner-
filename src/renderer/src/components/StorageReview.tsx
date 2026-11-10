import { useEffect, useRef, useState } from 'react'

type DetectedFile = ScanResult['candidates'][number]

function StorageReview(): React.JSX.Element {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [progress, setProgress] = useState<ScanProgress>({ directoriesScanned: 0, filesFound: 0 })
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [reviewing, setReviewing] = useState(false)
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [cleanupReport, setCleanupReport] = useState<CleanupOutcome[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<CleanupHistoryEntry[]>([])
  const scanInProgress = useRef(false)

  useEffect(() => window.api.onScanProgress(setProgress), [])

  const scan = async (): Promise<void> => {
    if (scanInProgress.current) return
    scanInProgress.current = true
    setScanning(true)
    setResult(null)
    setSelected(new Set())
    setExcluded(new Set())
    setReviewing(false)
    setPlan(null)
    setCleanupReport(null)
    setProgress({ directoriesScanned: 0, filesFound: 0 })
    setError('')
    try {
      setResult(await window.api.scanComputer())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed unexpectedly.')
    } finally {
      scanInProgress.current = false
      setScanning(false)
    }
  }

  const openHistory = async (): Promise<void> => {
    try {
      setHistory(await window.api.getCleanupHistory())
      setShowHistory(true)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load cleanup history.')
    }
  }

  const prepareCleanup = async (): Promise<void> => {
    try {
      setError('')
      setPlan(await window.api.createCleanupPlan(selectedFiles.map((file) => file.id)))
      setCleanupReport(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare cleanup.')
    }
  }

  const executeCleanup = async (): Promise<void> => {
    if (!plan) return
    try {
      setError('')
      const report = await window.api.executeCleanupPlan(plan.id)
      setCleanupReport(report.outcomes)
      setPlan(null)
      setHistory(await window.api.getCleanupHistory())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup could not be completed.')
      setPlan(null)
    }
  }

  const files = result?.candidates ?? []
  const selectedFiles = files.filter((file) => selected.has(file.id) && !excluded.has(file.id))
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
  const groups = new Map<string, DetectedFile[]>()
  for (const file of files) {
    const key = `${file.app}|||${file.category}`
    groups.set(key, [...(groups.get(key) ?? []), file])
  }

  const toggleSelected = (id: string): void => {
    setPlan(null)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExcluded = (id: string): void => {
    setPlan(null)
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelected((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  return (
    <main className="app">
      <header>
        <h1>AgentJunkCleaner</h1>
        <p>
          Review detected files and choose exactly what may be cleaned. Scanning is read-only;
          important user data is excluded.
        </p>
        <button className="scan-button" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Scan files'}
        </button>
        <button
          className="exclude-button nav-button"
          onClick={() => {
            if (showHistory) setShowHistory(false)
            else void openHistory()
          }}
        >
          {showHistory ? 'Back to scan' : 'Cleanup history'}
        </button>
      </header>

      {showHistory ? (
        <section className="results">
          <h2>Cleanup history</h2>
          {history.length === 0 ? (
            <p>No cleanup attempts yet.</p>
          ) : (
            history.map((entry) => (
              <section className="history-entry" key={entry.id}>
                <h3>{new Date(entry.completedAt).toLocaleString()}</h3>
                {entry.outcomes.map((outcome, index) => (
                  <p key={`${entry.id}-${index}`}>
                    <strong>{outcome.status}</strong> · {outcome.app} · {outcome.path} ·{' '}
                    {formatBytes(outcome.sizeBytes)}
                    {outcome.status === 'failed' ? ` · ${outcome.message}` : ''}
                  </p>
                ))}
              </section>
            ))
          )}
        </section>
      ) : (
        <>
          {scanning && (
            <p className="scan-status" role="status" aria-live="polite">
              Scanned {progress.directoriesScanned} folders; found {progress.filesFound} files...
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {result && (
            <section className="results" aria-live="polite">
              <h2>{reviewing ? 'Final review' : 'Review detected files'}</h2>
              <p>{result.message}</p>
              <p>
                {result.scannedLocations} cache locations scanned · {result.unavailableLocations}{' '}
                missing or inaccessible · {formatBytes(result.totalBytes)} total
                {result.truncated ? ' · Scan limit reached; results are partial.' : ''}
              </p>
              <p className="selection-total">
                Selected: {selectedFiles.length} files · {formatBytes(selectedBytes)}
              </p>
              {reviewing ? (
                <>
                  {selectedFiles.length === 0 ? (
                    <p>No files are selected.</p>
                  ) : (
                    <ul className="review-list">
                      {selectedFiles.map((file) => (
                        <li key={file.id}>
                          <strong>{file.app}</strong>
                          <p className="file-path">{file.displayPath}</p>
                          <p>
                            {file.category} · {formatBytes(file.sizeBytes)} · Modified{' '}
                            {new Date(file.lastModified).toLocaleString()}
                          </p>
                          <p>
                            Risk: {file.risk} · {file.reason}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="scan-button"
                    onClick={() => {
                      setPlan(null)
                      setReviewing(false)
                    }}
                  >
                    Back to selection
                  </button>
                  {plan ? (
                    <section className="approval-panel">
                      <h3>Cleanup plan ready</h3>
                      <p>
                        {plan.fileCount} exact files · {formatBytes(plan.totalBytes)} · expires{' '}
                        {new Date(plan.expiresAt).toLocaleTimeString()}
                      </p>
                      <p>
                        Files will be moved to the Recycle Bin and can be restored. Review the paths
                        above before approving.
                      </p>
                      <button className="cleanup-button" onClick={() => void executeCleanup()}>
                        Approve and move to Recycle Bin
                      </button>
                    </section>
                  ) : (
                    <button
                      className="cleanup-button"
                      onClick={() => void prepareCleanup()}
                      disabled={selectedFiles.length === 0}
                    >
                      Prepare cleanup plan
                    </button>
                  )}
                  <p className="review-note">
                    Nothing is changed until you approve the native confirmation dialog.
                  </p>
                  {cleanupReport && (
                    <section className="cleanup-report" role="status">
                      <h3>Cleanup results</h3>
                      {cleanupReport.map((outcome, index) => (
                        <p key={`${outcome.path}-${index}`}>
                          <strong>{outcome.status}</strong> · {outcome.path} · {outcome.message}
                        </p>
                      ))}
                    </section>
                  )}
                </>
              ) : files.length > 0 ? (
                <>
                  <div className="file-groups">
                    {[...groups.entries()].map(([key, group]) => {
                      const [app, category] = key.split('|||')
                      return (
                        <section className="file-group" key={key}>
                          <h3>
                            {app} <span>{category}</span>
                          </h3>
                          {group.map((file) => {
                            const isExcluded = excluded.has(file.id)
                            return (
                              <article
                                className={`file-card${isExcluded ? ' is-excluded' : ''}`}
                                key={file.id}
                              >
                                <label className="file-select">
                                  <input
                                    type="checkbox"
                                    checked={selected.has(file.id) && !isExcluded}
                                    disabled={isExcluded}
                                    onChange={() => toggleSelected(file.id)}
                                  />
                                  <span className="file-name">{file.name}</span>
                                </label>
                                <p className="file-path">{file.displayPath}</p>
                                <p>
                                  {formatBytes(file.sizeBytes)} · Modified{' '}
                                  {new Date(file.lastModified).toLocaleString()}
                                </p>
                                <p>
                                  Risk: <strong>{file.risk}</strong> · {file.reason}
                                </p>
                                <p>
                                  Detection: {file.detectionRule} ·{' '}
                                  {file.disposition === 'recreatable'
                                    ? 'Recreatable'
                                    : 'Review first'}
                                </p>
                                <button
                                  className="exclude-button"
                                  onClick={() => toggleExcluded(file.id)}
                                >
                                  {isExcluded ? 'Restore to list' : 'Exclude'}
                                </button>
                              </article>
                            )
                          })}
                        </section>
                      )
                    })}
                  </div>
                  <button
                    className="scan-button"
                    onClick={() => setReviewing(true)}
                    disabled={selectedFiles.length === 0}
                  >
                    Review selection ({selectedFiles.length})
                  </button>
                </>
              ) : (
                <p>No files to review for this scan.</p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  )
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

export default StorageReview
