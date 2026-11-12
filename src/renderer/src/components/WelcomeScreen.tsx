interface WelcomeScreenProps {
  onSuggestion: (prompt: string) => void
}

const suggestions = [
  { icon: '▥', title: 'Analyze my storage', prompt: 'Analyze my storage' },
  {
    icon: '⌁',
    title: 'Explain what is using my storage',
    prompt: 'Explain what is using my storage'
  },
  { icon: '⌕', title: 'Find AI agent junk', prompt: 'Find AI agent junk', featured: true }
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
          <button
            key={suggestion.title}
            className={suggestion.featured ? 'suggestion-featured' : undefined}
            onClick={() => onSuggestion(suggestion.prompt)}
          >
            <span className="suggestion-icon">{suggestion.icon}</span>
            <span>{suggestion.title}</span>
            <span className="suggestion-arrow">↗</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default WelcomeScreen
