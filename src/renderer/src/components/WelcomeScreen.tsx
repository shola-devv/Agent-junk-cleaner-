interface WelcomeScreenProps {
  onSuggestion: (prompt: string) => void
}

const suggestions = [
  { icon: '⌕', title: 'Find AI agent junk', prompt: 'Find AI agent junk' },
  { icon: '▥', title: 'Analyze my storage', prompt: 'Analyze my storage' },
  { icon: '◫', title: 'Find unnecessary cache files', prompt: 'Find unnecessary cache files' },
  {
    icon: '⌁',
    title: 'Explain what is using my storage',
    prompt: 'Explain what is using my storage'
  }
]

function WelcomeScreen({ onSuggestion }: WelcomeScreenProps): React.JSX.Element {
  return (
    <section className="welcome-screen">
      <div className="welcome-mark" aria-hidden="true">
        A
      </div>
      <h2>Clean up after your AI tools.</h2>
      <p className="welcome-copy">
        Find AI-agent junk like leftover caches and temporary files from Claude Code, OpenCode,
        Codex, Cursor, Windsurf, VS Code, and Cline. Review every finding and choose what stays.
      </p>
      <div className="suggestion-grid">
        {suggestions.map((suggestion) => (
          <button key={suggestion.title} onClick={() => onSuggestion(suggestion.prompt)}>
            <span className="suggestion-icon">{suggestion.icon}</span>
            <span>{suggestion.title}</span>
            <span className="suggestion-arrow">↗</span>
          </button>
        ))}
      </div>
      <p className="welcome-note">
        Your files stay on this device. Nothing is changed without your approval.
      </p>
    </section>
  )
}

export default WelcomeScreen
