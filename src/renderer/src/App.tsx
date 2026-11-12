import { useMemo, useRef, useState } from 'react'
import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  isUsingDefaultApiBaseUrl,
  setApiBaseUrl
} from './api/config'
import { apiClient } from './api/client'
import { ApiClientError } from './api/errors'
import type { ApiError } from './api/types'
import { sendChatTurn } from './services/chatService'
import type { ChatRequestMessage, ChatTurnState } from './services/chatService'
import type { BackendToolCall } from './services/chatService'
import ActivityCard from './components/ActivityCard'
import ChatHeader from './components/ChatHeader'
import ChatInput from './components/ChatInput'
import ChatMessage, { type ChatMessageData } from './components/ChatMessage'
import ErrorMessage from './components/ErrorMessage'
import RateLimitGuide from './components/RateLimitGuide'
import BackendSetupGuide from './components/BackendSetupGuide'
import Sidebar from './components/Sidebar'
import StorageReview from './components/StorageReview'
import WelcomeScreen from './components/WelcomeScreen'

interface Conversation {
  id: string
  title: string
  messages: ChatMessageData[]
}

type AppRoute = 'chat' | 'storage' | 'ratelimited' | 'backendguide'
interface FailedTurn {
  conversationId: string
  error: ApiError
}

const isGeneratingState = (state: ChatTurnState): boolean =>
  state === 'sending' || state === 'waiting' || state === 'receiving' || state === 'running-tool'

function App(): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState('')
  const [route, setRoute] = useState<AppRoute>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [healthError, setHealthError] = useState<ApiError | null>(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [turnState, setTurnState] = useState<ChatTurnState>('completed')
  const [activeToolCall, setActiveToolCall] = useState<BackendToolCall | null>(null)
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null)
  const [backendDraft, setBackendDraft] = useState(() => getApiBaseUrl())
  const [backendDraftError, setBackendDraftError] = useState('')
  const [backendSavedNotice, setBackendSavedNotice] = useState('')
  const [savingBackend, setSavingBackend] = useState(false)
  const [customBackendOpen, setCustomBackendOpen] = useState(false)
  const inFlight = useRef(false)
  const activeAbort = useRef<AbortController | null>(null)
  const activeToolRequestId = useRef<string | null>(null)

  const activeConversation = conversations.find((conversation) => conversation.id === activeId)
  const messages = activeConversation?.messages ?? []
  const title = activeConversation?.title ?? 'New conversation'
  const sidebarConversations = useMemo(
    () => conversations.map(({ id, title }) => ({ id, title })),
    [conversations]
  )

  const cancelGeneration = (): void => {
    const requestId = activeToolRequestId.current
    if (requestId) void window.api.cancelLocalTool(requestId)
    activeAbort.current?.abort()
  }

  const createNewChat = (): void => {
    cancelGeneration()
    setActiveId(crypto.randomUUID())
    setDraft('')
    setFailedTurn(null)
    setTurnState('completed')
    setActiveToolCall(null)
    setRoute('chat')
  }

  const runTurn = async (conversationId: string, messages: ChatRequestMessage[]): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    const controller = new AbortController()
    activeAbort.current = controller
    setFailedTurn(null)
    setActiveToolCall(null)
    setTurnState('sending')

    try {
      const answer = await sendChatTurn(conversationId, messages, {
        signal: controller.signal,
        onState: setTurnState,
        onToolActivity: setActiveToolCall,
        executeLocalTool: async (request) => {
          activeToolRequestId.current = request.requestId
          const cancelTool = (): void => {
            void window.api.cancelLocalTool(request.requestId)
          }
          controller.signal.addEventListener('abort', cancelTool, { once: true })
          try {
            const result = await window.api.runLocalTool(request)
            if (controller.signal.aborted) {
              const cancelled = new Error('The chat request was cancelled.')
              cancelled.name = 'AbortError'
              throw cancelled
            }
            return result
          } finally {
            controller.signal.removeEventListener('abort', cancelTool)
            activeToolRequestId.current = null
          }
        }
      })
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: [
                  ...conversation.messages,
                  {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: answer,
                    createdAt: Date.now()
                  }
                ]
              }
            : conversation
        )
      )
      setFailedTurn(null)
      setTurnState('completed')
      setActiveToolCall(null)
    } catch (error) {
      const cancelled =
        controller.signal.aborted ||
        (error instanceof ApiClientError && error.code === 'REQUEST_CANCELLED') ||
        (error instanceof Error && error.name === 'AbortError')
      if (cancelled) {
        setTurnState('cancelled')
        setFailedTurn(null)
      } else {
        const apiError: ApiError =
          error instanceof ApiClientError
            ? error
            : {
                code: 'BACKEND_UNAVAILABLE',
                message: error instanceof Error ? error.message : 'The chat request failed.',
                status: null,
                retryable: true
              }
        setFailedTurn({ conversationId, error: apiError })
        setTurnState('failed')
        if (apiError.code === 'RATE_LIMITED') setRoute('ratelimited')
      }
    } finally {
      inFlight.current = false
      activeAbort.current = null
      activeToolRequestId.current = null
    }
  }

  const sendMessage = (text = draft): void => {
    if (inFlight.current) return
    const content = text.trim()
    if (!content) return

    const id = activeId || crypto.randomUUID()
    const userMessage: ChatMessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      text: content,
      createdAt: Date.now()
    }
    const conversation = conversations.find((item) => item.id === id)
    const messages: ChatRequestMessage[] = [
      ...(conversation?.messages.map(({ role, text }) => ({ role, content: text })) ?? []),
      { role: 'user', content }
    ]

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
    void runTurn(id, messages)
  }

  const retryFailedTurn = (): void => {
    if (!failedTurn || !failedTurn.error.retryable || inFlight.current) return
    const conversation = conversations.find((item) => item.id === failedTurn.conversationId)
    if (!conversation) return
    const messages: ChatRequestMessage[] = conversation.messages.map(({ role, text }) => ({
      role,
      content: text
    }))
    void runTurn(failedTurn.conversationId, messages)
  }

  const checkBackend = async (): Promise<void> => {
    setCheckingHealth(true)
    setHealthError(null)
    try {
      await apiClient.healthCheck()
    } catch (error) {
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

  const saveBackendUrl = async (): Promise<void> => {
    setBackendDraftError('')
    setBackendSavedNotice('')
    try {
      const trimmed = backendDraft.trim()
      if (!trimmed || trimmed === DEFAULT_API_BASE_URL) {
        setApiBaseUrl(null)
        setBackendDraft(getApiBaseUrl())
        setCustomBackendOpen(false)
        return
      }
      setApiBaseUrl(trimmed)
    } catch (error) {
      setBackendDraftError(error instanceof Error ? error.message : 'Could not save the URL.')
      return
    }
    setBackendSavedNotice('Custom backend saved.')
    setSavingBackend(true)
    await checkBackend()
    setSavingBackend(false)
  }

  return (
    <div className="desktop-app">
      <Sidebar
        conversations={sidebarConversations}
        activeId={activeId}
        onNewChat={createNewChat}
        onSelectConversation={(id) => {
          cancelGeneration()
          setActiveId(id)
          setFailedTurn(null)
          setTurnState('completed')
          setActiveToolCall(null)
          setRoute('chat')
        }}
        onStorageReview={() => setRoute('storage')}
        onSettings={() => {
          setBackendDraft(isUsingDefaultApiBaseUrl() ? '' : getApiBaseUrl())
          setBackendDraftError('')
          setBackendSavedNotice('')
          setCustomBackendOpen(!isUsingDefaultApiBaseUrl())
          setSettingsOpen(true)
        }}
      />

      <main className="main-panel">
        {route === 'storage' ? (
          <div className="storage-view">
            <button className="back-to-chat" onClick={() => setRoute('chat')}>
              <span aria-hidden="true">←</span> Back to chat
            </button>
            <StorageReview />
          </div>
        ) : route === 'backendguide' ? (
          <BackendSetupGuide
            onOpenSettings={() => {
              setBackendDraft(isUsingDefaultApiBaseUrl() ? '' : getApiBaseUrl())
              setCustomBackendOpen(true)
              setSettingsOpen(true)
            }}
            onBack={() => setRoute('chat')}
          />
        ) : route === 'ratelimited' ? (
          <RateLimitGuide
            onOpenSettings={() => {
              setBackendDraft(isUsingDefaultApiBaseUrl() ? '' : getApiBaseUrl())
              setCustomBackendOpen(true)
              setSettingsOpen(true)
            }}
            onRetry={retryFailedTurn}
            onBack={() => setRoute('chat')}
            retryEnabled={Boolean(failedTurn?.error.retryable && !isGeneratingState(turnState))}
          />
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
                  {isGeneratingState(turnState) && (
                    <ActivityCard
                      title={
                        turnState === 'running-tool'
                          ? `Waiting to run ${activeToolCall?.name ?? 'an approved local tool'}`
                          : turnState === 'receiving'
                            ? 'Receiving response'
                            : turnState === 'sending'
                              ? 'Sending message'
                              : 'Waiting for response'
                      }
                      detail={
                        turnState === 'running-tool'
                          ? 'Review and approve the permission prompt to continue.'
                          : 'Working on your request…'
                      }
                      status="running"
                    />
                  )}
                  {turnState === 'completed' && messages.length > 0 && (
                    <ActivityCard
                      title="Response complete"
                      detail="Added to this conversation."
                      status="complete"
                    />
                  )}
                  {turnState === 'cancelled' && (
                    <ErrorMessage
                      title="Request cancelled"
                      message="Your message is still in the conversation. You can send it again when ready."
                      onDismiss={() => setTurnState('completed')}
                    />
                  )}
                  {failedTurn?.conversationId === activeId && (
                    <div className="chat-error">
                      <ErrorMessage
                        title={failedTurn.error.code.replaceAll('_', ' ').toLowerCase()}
                        message={failedTurn.error.message}
                        onDismiss={() => setFailedTurn(null)}
                      />
                      {failedTurn.error.retryable && (
                        <button className="retry-button" onClick={retryFailedTurn}>
                          Retry request
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            <footer className="composer-area">
              <ChatInput
                value={draft}
                onChange={setDraft}
                onSend={() => sendMessage()}
                onStop={cancelGeneration}
                isGenerating={
                  isGeneratingState(turnState) && activeId === (activeConversation?.id ?? '')
                }
              />
              <p className="composer-disclaimer">Local actions require your approval</p>
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
              {customBackendOpen ? (
                <div className="custom-backend">
                  <input
                    id="backend-url-input"
                    className="settings-input"
                    type="url"
                    spellCheck={false}
                    value={backendDraft}
                    onChange={(event) => {
                      setBackendDraft(event.target.value)
                      setBackendDraftError('')
                    }}
                    placeholder="https://your-backend.onrender.com"
                  />
                  {backendDraftError && <p className="error">{backendDraftError}</p>}
                  {backendSavedNotice && <p className="health-success">{backendSavedNotice}</p>}
                  {healthError && (
                    <ErrorMessage
                      title="custom backend unreachable"
                      message={healthError.message}
                      onDismiss={() => setHealthError(null)}
                    />
                  )}
                  <div className="settings-actions">
                    <button
                      className="header-action check-backend"
                      onClick={() => void saveBackendUrl()}
                      disabled={savingBackend || checkingHealth}
                    >
                      {savingBackend || checkingHealth ? 'Checking…' : 'Save backend'}
                    </button>
                    {!isUsingDefaultApiBaseUrl() && (
                      <button
                        className="text-link"
                        onClick={() => {
                          setApiBaseUrl(null)
                          setBackendDraft('')
                          setBackendDraftError('')
                          setBackendSavedNotice('')
                          setHealthError(null)
                          setCustomBackendOpen(false)
                        }}
                      >
                        Use default
                      </button>
                    )}
                    <button
                      className="text-link"
                      onClick={() => {
                        setSettingsOpen(false)
                        setRoute('backendguide')
                      }}
                    >
                      Setup guide
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-actions">
                  <button
                    className="text-link custom-backend-toggle"
                    onClick={() => {
                      setBackendDraft(isUsingDefaultApiBaseUrl() ? '' : getApiBaseUrl())
                      setCustomBackendOpen(true)
                    }}
                  >
                    Add your custom created AI backend
                  </button>
                  <button
                    className="text-link"
                    onClick={() => {
                      setSettingsOpen(false)
                      setRoute('backendguide')
                    }}
                  >
                    Setup guide
                  </button>
                </div>
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
