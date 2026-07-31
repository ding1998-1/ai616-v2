/**
 * pcm-processor.js — AudioWorklet processor for mobile meeting recording.
 *
 * 在独立音频线程运行，不受主线程 React 渲染影响。
 * 功能：降采样 → 噪声门 → 增益 → PCM16 转换 → 缓冲批发送
 *
 * 注册名: 'pcm-processor'
 * 消息协议: port.postMessage(ArrayBuffer) — 预缓冲好的 PCM16 字节
 */

class PcmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();
    this.TARGET_SAMPLE_RATE = 16000;
    this.AUDIO_BATCH_BYTES = 8000; // ~250ms at 16kHz int16
    this.audioBuffer = new Uint8Array(0);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length || !input[0].length) {
      return true;
    }

    const channelData = input[0];
    const inputSampleRate = sampleRate; // AudioWorklet global

    // 降采样到 16kHz
    const downsampled = this._downsampleTo16k(channelData, inputSampleRate);

    // 噪声门：RMS < 2% 视为静音，跳过本帧
    let sumSq = 0;
    for (let i = 0; i < downsampled.length; i++) {
      sumSq += downsampled[i] * downsampled[i];
    }
    const rms = Math.sqrt(sumSq / downsampled.length);
    if (rms < 0.02) {
      return true;
    }

    // float32 → int16 PCM 转换（增益 2.5 倍提升小声录音的 ASR 识别率）
    const GAIN = 2.5;
    const pcm = new ArrayBuffer(downsampled.length * 2);
    const view = new DataView(pcm);
    for (let i = 0; i < downsampled.length; i++) {
      const sample = Math.max(-1, Math.min(1, downsampled[i] * GAIN));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    // 追加到缓冲
    const pcmBytes = new Uint8Array(pcm);
    const merged = new Uint8Array(this.audioBuffer.length + pcmBytes.length);
    merged.set(this.audioBuffer, 0);
    merged.set(pcmBytes, this.audioBuffer.length);
    this.audioBuffer = merged;

    // 攒够一批就发送（transfer 语义，零拷贝）
    if (this.audioBuffer.length >= this.AUDIO_BATCH_BYTES) {
      this.port.postMessage(this.audioBuffer.buffer.slice(0), [this.audioBuffer.buffer]);
      this.audioBuffer = new Uint8Array(0);
    }

    return true; // 保持 processor 存活
  }

  /**
   * 降采样到 16kHz（线性插值平均）。
   */
  _downsampleTo16k(buffer, inputSr) {
    if (inputSr === this.TARGET_SAMPLE_RATE) {
      return buffer;
    }
    const ratio = inputSr / this.TARGET_SAMPLE_RATE;
    const newLength = Math.max(1, Math.round(buffer.length / ratio));
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index++) {
        accum += buffer[index];
        count++;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
