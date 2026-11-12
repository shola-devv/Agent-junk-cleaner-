interface BackendSetupGuideProps {
  onOpenSettings: () => void
  onBack: () => void
}

const BACKEND_REPO_URL = 'https://github.com/shola-devv/agent-junk-cleaner-backend.git'
const BACKEND_REPO_PAGE = 'https://github.com/shola-devv/agent-junk-cleaner-backend'

function BackendSetupGuide({ onOpenSettings, onBack }: BackendSetupGuideProps): React.JSX.Element {
  return (
    <div className="guide-page">
      <button className="back-to-chat" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to chat
      </button>

      <section className="guide-hero">
        <div className="guide-badge" aria-hidden="true">
          ⚙
        </div>
        <h1>Set up your own backend</h1>
        <p>
          AgentJunkCleaner ships with a shared backend, but you can run your own copy for a private
          limit and full control. The backend is a small Node.js service — here is the whole setup
          from zero to connected.
        </p>
        <p>
          <a
            className="guide-link"
            href={BACKEND_REPO_PAGE}
            target="_blank"
            rel="noreferrer noopener"
          >
            {BACKEND_REPO_PAGE}
          </a>
        </p>
      </section>

      <section className="guide-section">
        <h2>1 · Clone and install</h2>
        <code>git clone {BACKEND_REPO_URL}</code>
        <code>cd agent-junk-cleaner-backend</code>
        <code>npm install</code>
      </section>

      <section className="guide-section">
        <h2>2 · Configure environment</h2>
        <p>
          Create a <code>.env</code> file in the project root with your AI provider settings:
        </p>
        <code>ALLOWED_ORIGINS=&quot;null&quot;</code>
        <code>AI_PROVIDER=name-of-your-ai-provider</code>
        <code>&lt;PROVIDER&gt;_API_KEY=your-ai-provider-api-key</code>
        <p className="guide-hint">
          <code>AI_PROVIDER</code> selects which AI service the backend uses, and each provider has
          its own key variable — for example <code>GROQ_API_KEY</code> when{' '}
          <code>AI_PROVIDER=groq</code>. Get an API key from your provider&apos;s console and a free
          MongoDB database at mongodb.com/atlas. The desktop app talks to the backend from its
          packaged (file://) context, so <code>ALLOWED_ORIGINS=&quot;null&quot;</code> is what
          allows it. Optionally raise <code>RATE_LIMIT_MAX</code> and{' '}
          <code>DAILY_RATE_LIMIT_MAX</code> for your own limits.
        </p>
      </section>

      <section className="guide-section">
        <h2>3 · Try it locally (optional)</h2>
        <code>npm run dev</code>
        <p>
          The service starts on <code>http://localhost:3000</code>. You can already point the app at
          it by adding <code>http://localhost:3000</code> as a custom backend.
        </p>
      </section>

      <section className="guide-section">
        <h2>4 · Deploy it</h2>
        <p>
          Any Node host works; Render is free and takes about two minutes:
        </p>
        <ol className="guide-steps">
          <li>
            Push your configured repo to GitHub, then create a new <em>Web Service</em> on
            render.com and connect the repo.
          </li>
          <li>
            Runtime <code>Node</code> · build command <code>npm install</code> · start command{' '}
            <code>npm start</code>.
          </li>
          <li>
            Add the same variables from step 2 under the service&apos;s environment settings, then
            deploy.
          </li>
        </ol>
      </section>

      <section className="guide-section">
        <h2>5 · Connect the app</h2>
        <p>
          Open Settings → Backend connection → <em>Add your custom created AI backend</em>, paste
          your URL (for example <code>https://your-service.onrender.com</code>) and save. The app
          checks the connection and stores the URL only on this device.
        </p>
        <button className="exclude-button nav-button" onClick={onOpenSettings}>
          Add your custom created AI backend
        </button>
      </section>
    </div>
  )
}

export default BackendSetupGuide
