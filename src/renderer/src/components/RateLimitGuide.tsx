interface RateLimitGuideProps {
  onOpenSettings: () => void
  onRetry: () => void
  onBack: () => void
  retryEnabled: boolean
}

const BACKEND_REPO_URL = 'https://github.com/shola-devv/agent-junk-cleaner-backend.git'
const BACKEND_REPO_PAGE = 'https://github.com/shola-devv/agent-junk-cleaner-backend'

function RateLimitGuide({
  onOpenSettings,
  onRetry,
  onBack,
  retryEnabled
}: RateLimitGuideProps): React.JSX.Element {
  return (
    <div className="guide-page">
      <button className="back-to-chat" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to chat
      </button>

      <section className="guide-hero">
        <div className="guide-badge" aria-hidden="true">
          ⏳
        </div>
        <h1>You are rate limited</h1>
        <p>
          Chat requests are capped to protect the shared backend: a short burst limit per hour and a
          daily limit per IP. Nothing was deleted or changed — your files and settings are
          untouched.
        </p>
      </section>

      <section className="guide-section">
        <h2>1 · Try again after a short wait</h2>
        <p>
          The burst limit resets automatically after a short window, and the daily limit resets at
          midnight UTC. Wait a few minutes, then retry.
        </p>
        <button className="scan-button" onClick={onRetry} disabled={!retryEnabled}>
          Retry request
        </button>
      </section>

      <section className="guide-section">
        <h2>2 · Deploy your own backend (permanent fix)</h2>
        <p>
          The public endpoint is shared by everyone, so its quota can run out. Deploying your own
          copy gives you a private limit. The backend is open source:
        </p>
        <p>
          <a
            className="guide-link"
            href={BACKEND_REPO_PAGE}
            target="_blank"
            rel="noreferrer noopener"
          >
            {BACKEND_REPO_URL}
          </a>
        </p>
        <ol className="guide-steps">
          <li>
            <strong>Clone the repo</strong>
            <code>git clone {BACKEND_REPO_URL}</code>
            <code>cd agent-junk-cleaner-backend</code>
          </li>
          <li>
            <strong>Install dependencies</strong>
            <code>npm install</code>
          </li>
          <li>
            <strong>
              Create a <code>.env</code> file
            </strong>{' '}
            in the project root with at least:
            <code>ALLOWED_ORIGINS=&quot;null&quot;</code>
            <code>GROQ_API_KEY=your-groq-api-key</code>
            <code>MONGODB_URI=your-mongodb-connection-string</code>
            <span className="guide-hint">
              Get a free Groq key at console.groq.com and a free MongoDB database at
              mongodb.com/atlas. Optionally raise RATE_LIMIT_MAX and DAILY_RATE_LIMIT_MAX.
            </span>
          </li>
          <li>
            <strong>Deploy it (Render is free)</strong>
            <br />
            Create a new <em>Web Service</em> on render.com, connect the repo, use <code>Node</code>
            , build command <code>npm install</code> and start command <code>npm start</code>, then
            add the same variables from step 3 in the service&apos;s environment settings.
          </li>
          <li>
            <strong>Point this app at your backend</strong>
            <br />
            Open Settings → Backend connection, paste your new URL (for example{' '}
            <code>https://your-service.onrender.com</code>) and save. It is stored only on this
            device.
          </li>
        </ol>
        <button className="exclude-button nav-button" onClick={onOpenSettings}>
          <span className="sidebar-icon">⚙</span> Open backend settings
        </button>
      </section>

      <p className="guide-note">
        Local scanning, file review, and Recycle Bin cleanup keep working — only AI chat responses
        are affected by the rate limit.
      </p>
    </div>
  )
}

export default RateLimitGuide
