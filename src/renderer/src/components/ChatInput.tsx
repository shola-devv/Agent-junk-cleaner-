import { useEffect, useRef } from 'react'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
  disabled?: boolean
}

function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  disabled = false
}: ChatInputProps): React.JSX.Element {
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`
  }, [value])

  return (
    <form
      className="chat-input"
      onSubmit={(event) => {
        event.preventDefault()
        if (!isGenerating && !disabled && value.trim()) onSend()
      }}
    >
      <textarea
        ref={textarea}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!isGenerating && !disabled && value.trim()) onSend()
          }
        }}
        placeholder="Ask about AI-tool junk, caches, or temporary files..."
        rows={1}
        disabled={disabled || isGenerating}
        aria-label="Message AgentJunkCleaner"
      />
      {isGenerating ? (
        <button
          className="send-button stop-button"
          type="button"
          onClick={onStop}
          aria-label="Stop generation"
        >
          ■
        </button>
      ) : (
        <button
          className="send-button"
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          ↑
        </button>
      )}
    </form>
  )
}

export default ChatInput
