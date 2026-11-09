/**
 * Microphone capture that produces a WAV blob the STT API accepts.
 *
 * Chrome's MediaRecorder only emits WebM/Opus, which Gnani rejects with
 * UNSUPPORTED_AUDIO_FORMAT. Instead we take raw PCM from the Web Audio API and
 * encode a small, mono, 16-bit WAV ourselves — no server-side conversion and
 * the same result in every browser.
 */

const TARGET_SAMPLE_RATE = 16000
const MIN_SECONDS = 0.15

export class WavRecorder {
  private chunks: Float32Array[] = []
  private closed = false

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly processor: ScriptProcessorNode,
  ) {}

  /** Ask for the microphone and start collecting samples. */
  static async start(): Promise<WavRecorder> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not available in this browser')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })

    let context: AudioContext
    try {
      context = new AudioContext()
      await context.resume()
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop())
      throw err
    }

    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const recorder = new WavRecorder(stream, context, source, processor)

    processor.onaudioprocess = (event) => {
      if (recorder.closed) return
      recorder.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(context.destination)

    return recorder
  }

  /** Stop capture and return a mono 16-bit WAV blob (empty if too short). */
  async stop(): Promise<Blob> {
    if (this.closed) return emptyWav()
    this.closed = true
    this.processor.onaudioprocess = null
    this.source.disconnect()
    this.processor.disconnect()
    this.stream.getTracks().forEach((track) => track.stop())

    const inputRate = this.context.sampleRate
    await this.context.close().catch(() => {})

    const samples = mergeChunks(this.chunks)
    this.chunks = []
    if (samples.length < inputRate * MIN_SECONDS) return emptyWav()

    return encodeWav(downsample(samples, inputRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE)
  }
}

function emptyWav(): Blob {
  return new Blob([new Uint8Array(0)], { type: 'audio/wav' })
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

/** Average-sample down to the target rate (e.g. 48 kHz -> 16 kHz). */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input

  const ratio = from / to
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  let offset = 0

  for (let i = 0; i < length; i++) {
    const next = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = offset; j < next; j++) sum += input[j]
    output[i] = next > offset ? sum / (next - offset) : 0
    offset = next
  }

  return output
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
