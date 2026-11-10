import { useMemo, useState } from 'react'
import { API_BASE_URL, isApiConfigured } from './api/config'
import { apiClient } from './api/client'
import { ApiClientError } from './api/errors'
import type { ApiError } from './api/types'
import ActivityCard from './components/ActivityCard'
import ChatHeader from './components/ChatHeader'
import ChatInput from './components/ChatInput'
import ChatMessage, { type ChatMessageData } from './components/ChatMessage'
import ErrorMessage from './components/ErrorMessage'
import Sidebar from './components/Sidebar'
import StorageReview from './components/StorageReview'
import WelcomeScreen from './components/WelcomeScreen'

interface Conversation {
  id: string
  title: string
  messages: ChatMessageData[]
}

type BackendStatus = 'not-checked' | 'connected' | 'error'

function App(): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState('')
  const [localOnlyNotice, setLocalOnlyNotice] = useState(false)
  const [route, setRoute] = useState<'chat' | 'storage'>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('not-checked')
  const [healthError, setHealthError] = useState<ApiError | null>(null)
  const [checkingHealth, setCheckingHealth] = useState(false)

  const activeConversation = conversations.find((conversation) => conversation.id === activeId)
  const messages = activeConversation?.messages ?? []
  const title = activeConversation?.title ?? 'New conversation'
  const sidebarConversations = useMemo(
    () => conversations.map(({ id, title }) => ({ id, title })),
    [conversations]
  )

  const createNewChat = (): void => {
    setActiveId(crypto.randomUUID())
    setDraft('')
    setLocalOnlyNotice(false)
    setRoute('chat')
  }

  const sendMessage = (text = draft): void => {
    const content = text.trim()
    if (!content) return

    const id = activeId || crypto.randomUUID()
    const userMessage: ChatMessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      text: content,
      createdAt: Date.now()
    }

    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === id)
      if (existing) {
        return current.map((conversation) =>
          conversation.id === id
            ? { ...conversation, messages: [...conversation.messages, userMessage] }
            : conversation
        )
      }
      return [...current, { id, title: content.slice(0, 40), messages: [userMessage] }]
    })
    setActiveId(id)
    setDraft('')
    setLocalOnlyNotice(true)
  }

  const checkBackend = async (): Promise<void> => {
    setCheckingHealth(true)
    setHealthError(null)
    try {
      await apiClient.healthCheck()
      setBackendStatus('connected')
    } catch (error) {
      setBackendStatus('error')
      setHealthError(
        error instanceof ApiClientError
          ? error
          : {
              code: 'BACKEND_UNAVAILABLE',
              message: 'The backend could not be reached. Check the service and try again.',
              status: null,
              retryable: true
            }
      )
    } finally {
      setCheckingHealth(false)
    }
  }

  return (
    <div className="desktop-app">
      <Sidebar
        conversations={sidebarConversations}
        activeId={activeId}
        backendStatus={backendStatus}
        onNewChat={createNewChat}
        onSelectConversation={(id) => {
          setActiveId(id)
          setLocalOnlyNotice(false)
          setRoute('chat')
        }}
        onStorageReview={() => setRoute('storage')}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="main-panel">
        {route === 'storage' ? (
          <div className="storage-view">
            <button className="back-to-chat" onClick={() => setRoute('chat')}>
              <span aria-hidden="true">←</span> Back to chat
            </button>
            <StorageReview />
          </div>
        ) : (
          <>
            <ChatHeader title={title} onStorage={() => setRoute('storage')} />
            <section className={`chat-scroll${messages.length === 0 ? ' chat-empty' : ''}`}>
              {messages.length === 0 ? (
                <WelcomeScreen onSuggestion={(prompt) => sendMessage(prompt)} />
              ) : (
                <div className="message-list">
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  {localOnlyNotice && (
                    <ErrorMessage
                      title="AI chat is not connected"
                      message="Your message is saved only in this temporary local conversation. No AI request was sent and no response was generated."
                      onDismiss={() => setLocalOnlyNotice(false)}
                    />
                  )}
                  <ActivityCard
                    title="Local storage scanner"
                    detail="Available in Storage review. Scanning stays on this device."
                    status="ready"
                  />
                </div>
              )}
            </section>
            <footer className="composer-area">
              <ChatInput
                value={draft}
                onChange={setDraft}
                onSend={() => sendMessage()}
                onStop={() => {}}
                isGenerating={false}
              />
              <p className="composer-disclaimer">
                Local-only chat preview · Messages are not sent to an AI service
              </p>
            </footer>
          </>
        )}
      </main>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false)
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <button
              className="icon-button modal-close"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            >
              ×
            </button>
            <span className="eyebrow">PREFERENCES</span>
            <h2 id="settings-title">Settings</h2>
            <div className="settings-section">
              <h3>Backend connection</h3>
              <p>
                The API client is ready for health checks and typed GET/POST requests. Chat is not
                connected to an AI endpoint.
              </p>
              <label className="settings-label">Backend base URL</label>
              <code className="api-url">{API_BASE_URL || 'Not configured for this build'}</code>
              {!isApiConfigured && (
                <p className="settings-help">
                  Set VITE_API_BASE_URL when building the production app.
                </p>
              )}
              <button
                className="header-action check-backend"
                onClick={() => void checkBackend()}
                disabled={checkingHealth}
              >
                {checkingHealth ? 'Checking…' : 'Check backend health'}
              </button>
              {healthError && (
                <ErrorMessage
                  title={healthError.code.replaceAll('_', ' ').toLowerCase()}
                  message={healthError.message}
                  onDismiss={() => setHealthError(null)}
                />
              )}
              {backendStatus === 'connected' && (
                <p className="health-success">Backend health check succeeded.</p>
              )}
            </div>
            <div className="settings-section">
              <h3>Privacy</h3>
              <p>
                Local scanning is performed by the Electron main process. No files are uploaded by
                this interface.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
