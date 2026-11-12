/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = require('node:fs').readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  module._compile(output, filename)
}

const {
  executeRegisteredTool,
  ToolRequestLedger,
  validateToolRequest
} = require(path.resolve('src/main/toolRegistry.ts'))

const requestId = 'c8199bc2-3d4c-42d2-8d2a-0a0af14e951e'

test('rejects unknown tools and unsafe arguments', () => {
  assert.throws(
    () => validateToolRequest({ requestId, toolName: 'delete_file', arguments: { path: 'C:\\temp' } }),
    /Unknown or invalid/
  )
  assert.throws(
    () => validateToolRequest({ requestId, toolName: 'scan_computer', arguments: { path: 'C:\\temp' } }),
    /does not accept arguments/
  )
  assert.throws(
    () => validateToolRequest({ requestId, toolName: 'inspect_candidate', arguments: { path: 'C:\\temp' } }),
    /candidateId/
  )
})

test('rejects repeated tool request IDs', () => {
  const ledger = new ToolRequestLedger()
  ledger.claim(requestId)
  assert.throws(() => ledger.claim(requestId), /already been used/)
})

test('cancels a running local tool', async () => {
  const controller = new AbortController()
  const request = validateToolRequest({ requestId, toolName: 'get_system_info', arguments: {} })
  const operation = executeRegisteredTool(
    request,
    { getSystemInfo: () => new Promise(() => {}) },
    controller,
    1000
  )
  controller.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
  await assert.rejects(operation, /cancelled/)
})

test('times out a local tool', async () => {
  const controller = new AbortController()
  const request = validateToolRequest({
    requestId: '4ea82569-1740-45b1-a59c-084161cab1cc',
    toolName: 'get_system_info',
    arguments: {}
  })
  const operation = executeRegisteredTool(
    request,
    { getSystemInfo: () => new Promise(() => {}) },
    controller,
    5
  )
  await assert.rejects(operation, (error) => error.name === 'TimeoutError')
})
