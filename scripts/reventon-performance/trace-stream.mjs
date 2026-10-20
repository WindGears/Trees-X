import { writeFile } from 'node:fs/promises'

export const TRACE_READ_BYTES = 1024 * 1024
export const TRACE_MAX_BYTES = 128 * TRACE_READ_BYTES

/** CDP traces can exceed V8's string limit. Keep a fixed, bounded diagnostic
 * budget instead of accumulating an unbounded string. Failure is unavailable
 * presentation evidence, never a reason to discard independent GPU/JS samples.
 */
export async function readTraceStream(session, handle, options = {}) {
  const maxBytes = options.maxBytes ?? TRACE_MAX_BYTES,
    metadata = {
      available: false,
      maxBytes,
      readSizeBytes: TRACE_READ_BYTES,
      bytesRead: 0,
      bytesRetained: 0,
      chunks: 0,
      eof: false,
      closed: false,
      reason: null,
    },
    chunks = []
  let trace = null
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > TRACE_MAX_BYTES)
      throw new Error(`Trace byte budget must be between 1 and ${TRACE_MAX_BYTES}`)
    while (!metadata.eof) {
      const result = await session.send('IO.read', { handle, size: TRACE_READ_BYTES })
      if (typeof result.data !== 'string' || typeof result.eof !== 'boolean')
        throw new Error('Malformed CDP trace stream response')
      const chunk = Buffer.from(result.data, result.base64Encoded ? 'base64' : 'utf8')
      metadata.chunks++
      metadata.bytesRead += chunk.length
      metadata.eof = result.eof
      if (metadata.bytesRead > maxBytes) {
        metadata.reason =
          'Trace exceeded the bounded diagnostic byte budget; presentation unavailable.'
        break
      }
      if (!chunk.length && !metadata.eof)
        throw new Error('CDP trace stream returned no data before EOF')
      chunks.push(chunk)
      metadata.bytesRetained += chunk.length
    }
    if (!metadata.reason && metadata.eof) {
      const buffer = Buffer.concat(chunks, metadata.bytesRetained)
      // Only complete, within-budget traces are written. Failed reads cannot
      // leave a partial trace.json that looks like presentation evidence.
      if (options.outputPath) {
        await writeFile(options.outputPath, buffer)
        metadata.outputPath = options.outputPath
      }
      try {
        const parsed = JSON.parse(buffer.toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.traceEvents))
          throw new Error('Trace does not contain a traceEvents array')
        trace = parsed
        metadata.available = true
      } catch (cause) {
        metadata.reason = `Trace JSON incomplete or invalid; presentation unavailable: ${cause}`
      }
    }
  } catch (cause) {
    metadata.reason = `Trace read unavailable: ${cause}`
  } finally {
    // Includes malformed responses, read rejection, parse failure and budget
    // rejection. Closing early also releases an oversized stream in Chromium.
    try {
      await session.send('IO.close', { handle })
      metadata.closed = true
    } catch (cause) {
      metadata.closeFailure = String(cause)
      metadata.reason ??= `Trace stream close failed; presentation unavailable: ${cause}`
      metadata.available = false
      trace = null
    }
    chunks.length = 0
  }
  return { trace, metadata }
}
