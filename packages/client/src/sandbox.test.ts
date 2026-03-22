import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { executeSandboxed } from './sandbox.js'

describe('executeSandboxed', () => {
  it('should execute simple code that prints to stdout', async () => {
    const result = await executeSandboxed({
      code: 'console.log("hello world")',
      runtime: 'node',
      timeout_ms: 5000,
    })

    assert.equal(result.stdout.trim(), 'hello world')
    assert.equal(result.exitCode, 0)
    assert.equal(result.timedOut, false)
  })

  it('should capture stderr output', async () => {
    const result = await executeSandboxed({
      code: 'console.error("error message")',
      runtime: 'node',
      timeout_ms: 5000,
    })

    assert.ok(result.stderr.includes('error message'))
    assert.equal(result.exitCode, 0)
  })

  it('should timeout on infinite loop', { timeout: 5000 }, async () => {
    const result = await executeSandboxed({
      code: 'while(true){}',
      runtime: 'node',
      timeout_ms: 500,
    })

    assert.equal(result.timedOut, true)
  })

  it('should return non-zero exit code on error', async () => {
    const result = await executeSandboxed({
      code: 'process.exit(42)',
      runtime: 'node',
      timeout_ms: 5000,
    })

    assert.equal(result.exitCode, 42)
  })

  it('should pass custom env variables', async () => {
    const result = await executeSandboxed({
      code: 'console.log(process.env.TEST_VAR)',
      runtime: 'node',
      timeout_ms: 5000,
      env: { TEST_VAR: 'custom_value' },
    })

    assert.equal(result.stdout.trim(), 'custom_value')
  })
})
