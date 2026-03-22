import { execFile } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

export interface SandboxOptions {
  code: string
  runtime: 'node' | 'python'
  timeout_ms: number
  env?: Record<string, string>
}

export async function executeSandboxed(opts: SandboxOptions): Promise<SandboxResult> {
  const ext = opts.runtime === 'python' ? '.py' : '.mjs'
  const tmpFile = join(tmpdir(), `tomcp-${randomUUID()}${ext}`)

  await writeFile(tmpFile, opts.code, 'utf-8')

  const cmd = opts.runtime === 'python' ? 'python3' : 'node'

  try {
    return await new Promise<SandboxResult>((resolve) => {
      const proc = execFile(
        cmd,
        [tmpFile],
        {
          timeout: opts.timeout_ms,
          env: {
            ...process.env,
            ...opts.env,
            // Restrict Node.js from loading unexpected modules
            NODE_OPTIONS: '--no-warnings',
          },
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          const timedOut = error?.killed === true
          const exitCode = error ? (error as NodeJS.ErrnoException & { code?: number }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 1
            : proc.exitCode ?? 1
            : 0

          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
            timedOut,
          })
        },
      )
    })
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}
