interface ChatHeaderProps {
  title: string
  onStorage: () => void
}

function ChatHeader({ title, onStorage }: ChatHeaderProps): React.JSX.Element {
  return (
    <header className="chat-header">
      <div>
        <span className="eyebrow">WORKSPACE</span>
        <h1>{title}</h1>
      </div>
      <button className="header-action" onClick={onStorage}>
        <span aria-hidden="true">▤</span>
        Storage review
      </button>
    </header>
  )
}

export default ChatHeader
