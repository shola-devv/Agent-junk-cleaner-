export interface ChatMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
}

interface ChatMessageProps {
  message: ChatMessageData
}

function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <article className={`message-row ${isUser ? 'message-user' : 'message-assistant'}`}>
      {!isUser && (
        <div className="assistant-avatar" aria-hidden="true">A</div>
      )}
      <div className="message-content">
        <div className="message-meta">
          <strong>{isUser ? 'You' : 'AgentJunkCleaner'}</strong>
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit'
            })}
          </time>
        </div>
        <p>{message.text}</p>
      </div>
    </article>
  )
}

export default ChatMessage
