interface ConversationItem {
  id: string
  title: string
}

interface SidebarProps {
  conversations: ConversationItem[]
  activeId: string
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onStorageReview: () => void
  onSettings: () => void
}

function Sidebar({
  conversations,
  activeId,
  onNewChat,
  onSelectConversation,
  onStorageReview,
  onSettings
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <div>
          <strong>AgentJunkCleaner</strong>
          <span>DESKTOP ASSISTANT</span>
        </div>
      </div>
      <button className="new-chat-button" onClick={onNewChat}>
        <span>＋</span> New chat <kbd>⌘ K</kbd>
      </button>
      <button className="sidebar-link" onClick={onStorageReview}>
        <span className="sidebar-icon">▤</span> Storage review
      </button>
      <div className="history-heading">YOUR CHATS</div>
      <nav className="conversation-list" aria-label="Conversation history">
        {conversations.length === 0 ? (
          <p className="empty-history">Your conversations will appear here.</p>
        ) : (
          conversations.map((conversation) => (
            <button
              className={`conversation-link${conversation.id === activeId ? ' active' : ''}`}
              key={conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
            >
              <span>◦</span>
              {conversation.title}
            </button>
          ))
        )}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-link settings-link" onClick={onSettings}>
          <span className="sidebar-icon">⚙</span> Settings
        </button>
        <div className="local-note">
          <span>◈</span> Local scanning stays on this device
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
