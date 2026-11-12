import { apiClient } from '../api/client'
import { createApiError } from '../api/errors'
import { APPROVED_LOCAL_TOOLS } from '../../../shared/toolTypes'
import type { LocalToolRequest, LocalToolResult, ApprovedLocalTool } from '../../../shared/toolTypes'

export type ChatTurnState =
  | 'sending'
  | 'waiting'
  | 'receiving'
  | 'running-tool'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface ChatRequestMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
}

export interface BackendToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  description?: string
  risk?: string
  requiresApproval?: boolean
}

interface BackendChatResponse {
  conversationId: string
  message: { role: 'assistant'; content: string }
  toolCalls: BackendToolCall[]
  provider?: string
}

export interface ChatServiceOptions {
  signal: AbortSignal
  onState: (state: ChatTurnState) => void
  onToolActivity: (call: BackendToolCall) => void
  executeLocalTool: (request: LocalToolRequest) => Promise<LocalToolResult>
}

const MAX_TOOL_ROUNDS = 5
const MAX_TOOL_CALLS_PER_RESPONSE = 8
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BACKEND_TOOL_ALIASES: Record<string, ApprovedLocalTool> = {
  scan_system: 'scan_computer'
}
const SUPPORTED_LOCAL_TOOLS: ReadonlySet<string> = new Set<string>(APPROVED_LOCAL_TOOLS)

function isChatResponse(value: unknown): value is BackendChatResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Record<string, unknown>
  if (
    typeof response.conversationId !== 'string' ||
    !UUID_PATTERN.test(response.conversationId) ||
    typeof response.message !== 'object' ||
    response.message === null ||
    (response.message as Record<string, unknown>).role !== 'assistant' ||
    typeof (response.message as Record<string, unknown>).content !== 'string' ||
    !Array.isArray(response.toolCalls)
  ) {
    return false
  }
  return response.toolCalls.every(
    (call) =>
      typeof call === 'object' &&
      call !== null &&
      typeof (call as Record<string, unknown>).id === 'string' &&
      UUID_PATTERN.test((call as Record<string, unknown>).id as string) &&
      typeof (call as Record<string, unknown>).name === 'string' &&
      typeof (call as Record<string, unknown>).arguments === 'object' &&
      (call as Record<string, unknown>).arguments !== null &&
      !Array.isArray((call as Record<string, unknown>).arguments)
  )
}

export async function sendChatTurn(
  conversationId: string,
  initialMessages: ChatRequestMessage[],
  options: ChatServiceOptions
): Promise<string> {
  const messages = [...initialMessages]
  const seenToolCallIds = new Set<string>()
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (options.signal.aborted) throw createApiError('REQUEST_CANCELLED')
    options.onState('waiting')
    const response = await apiClient.post<unknown>(
      '/api/chat',
      { conversationId, messages },
      { signal: options.signal, timeoutMs: 120_000 }
    )
    options.onState('receiving')

    if (!isChatResponse(response) || response.conversationId !== conversationId) {
      throw createApiError('INVALID_RESPONSE', {
        message: 'The chat service returned an unexpected response.'
      })
    }

    const finalResponse = response.message.content
    if (finalResponse) {
      messages.push({ role: 'assistant', content: finalResponse })
    }

    if (response.toolCalls.length === 0) {
      if (!finalResponse.trim()) {
        throw createApiError('INVALID_RESPONSE', {
          message: 'The chat service returned an empty assistant response.'
        })
      }
      options.onState('completed')
      return finalResponse
    }

    if (response.toolCalls.length > MAX_TOOL_CALLS_PER_RESPONSE) {
      throw createApiError('INVALID_RESPONSE', {
        message: 'The chat service requested too many local actions.'
      })
    }

    for (const call of response.toolCalls) {
      if (options.signal.aborted) throw createApiError('REQUEST_CANCELLED')
      if (seenToolCallIds.has(call.id)) {
        throw createApiError('INVALID_RESPONSE', {
          message: 'The chat service repeated a local action request.'
        })
      }
      seenToolCallIds.add(call.id)
      options.onToolActivity(call)
      options.onState('running-tool')

      const toolName = BACKEND_TOOL_ALIASES[call.name] ?? call.name
      let toolResult: LocalToolResult | {
        requestId: string
        toolName: string
        approved: false
        success: false
        error: { code: 'INVALID_REQUEST'; message: string }
      }
      if (!SUPPORTED_LOCAL_TOOLS.has(toolName)) {
        toolResult = {
          requestId: crypto.randomUUID(),
          toolName: call.name,
          approved: false,
          success: false,
          error: { code: 'INVALID_REQUEST', message: `Unsupported local tool: ${call.name}` }
        }
      } else {
        const request: LocalToolRequest = {
          requestId: crypto.randomUUID(),
          toolName,
          arguments: call.arguments
        }
        try {
          toolResult = await options.executeLocalTool(request)
          if (toolResult.requestId !== request.requestId || toolResult.toolName !== toolName) {
            throw createApiError('INVALID_RESPONSE', {
              message: 'The local tool returned a mismatched result.'
            })
          }
        } catch (error) {
          if (options.signal.aborted) throw createApiError('REQUEST_CANCELLED')
          toolResult = {
            requestId: request.requestId,
            toolName,
            approved: false,
            success: false,
            error: {
              code: 'TOOL_FAILED',
              message: error instanceof Error ? error.message : 'The local tool failed.'
            }
          }
        }
      }

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(toolResult)
      })
    }
  }

  throw createApiError('INVALID_RESPONSE', {
    message: 'The assistant requested too many consecutive local actions.'
  })
}
