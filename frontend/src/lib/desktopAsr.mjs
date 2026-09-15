// PC-only adapter. Audio preprocessing and the wire protocol mirror MobileMeetingRecorder.
// Keep mobile capture untouched until this adapter has passed separate acceptance.
export function speechPcm16(samples) {
  let sumSq = 0;
  for (const sample of samples) sumSq += sample * sample;
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms < 0.0028) return null;
  const gain = rms > 0.001 ? Math.min(0.12 / rms, 4) : 1;
  const output = new ArrayBuffer(samples.length * 2);
  const view = new DataView(output);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] * gain));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

export function speechDownsample(buffer, sampleRate) {
  if (sampleRate === 16000) return buffer;
  const ratio = sampleRate / 16000;
  const result = new Float32Array(Math.max(1, Math.round(buffer.length / ratio)));
  let offset = 0;
  for (let index = 0; index < result.length; index += 1) {
    const end = Math.round((index + 1) * ratio);
    let total = 0, count = 0;
    for (let i = offset; i < end && i < buffer.length; i += 1) { total += buffer[i]; count += 1; }
    result[index] = count ? total / count : 0;
    offset = end;
  }
  return result;
}

export function createDesktopAsr({ stream, url, onPayload, onStatus,
  AudioContextCtor = window.AudioContext || window.webkitAudioContext,
  WebSocketCtor = WebSocket }) {
  const context = new AudioContextCtor({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(8192, 1, 1);
  let socket, ready = false, stopping = false, closed = false;
  let reconnectTimer, readyTimer, heartbeat, attempts = 0, lastPong = 0;
  let buffer = new Uint8Array(0), finishResolve, stopPromise;
  const clearTimers = () => { clearTimeout(reconnectTimer); clearTimeout(readyTimer); clearInterval(heartbeat); };
  const connect = () => {
    if (stopping || closed) return;
    const next = new WebSocketCtor(`${url}${attempts ? '&resume=1' : ''}`);
    socket = next;
    ready = false;
    next.binaryType = 'arraybuffer';
    onStatus('connecting');
    readyTimer = setTimeout(() => next.close(), 15000);
    next.onmessage = event => {
      if (socket !== next || closed) return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === 'ready') {
        clearTimeout(readyTimer);
        ready = true;
        attempts = 0;
        lastPong = Date.now();
        onStatus('connected');
        heartbeat = setInterval(() => {
          if (Date.now() - lastPong > 30000) { next.close(); return; }
          if (next.readyState === 1) next.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }, 15000);
      } else if (payload.type === 'pong') lastPong = Date.now();
      else if (payload.type === 'finished') finishResolve?.();
      else onPayload(payload);
    };
    next.onerror = () => { if (!ready) next.close(); };
    next.onclose = () => {
      if (socket !== next) return;
      ready = false;
      clearTimers();
      if (stopping || closed) { finishResolve?.(); return; }
      onStatus('reconnecting');
      attempts += 1;
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts - 1, 3), 10000));
    };
  };
  context.onstatechange = () => {
    if (context.state === 'suspended' && !stopping && !closed) context.resume().catch(() => {});
  };
  processor.onaudioprocess = event => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (stopping || !ready || socket?.readyState !== 1) return;
    const pcm = speechPcm16(speechDownsample(event.inputBuffer.getChannelData(0), context.sampleRate));
    if (!pcm) return;
    const bytes = new Uint8Array(pcm);
    const merged = new Uint8Array(buffer.length + bytes.length);
    merged.set(buffer); merged.set(bytes, buffer.length); buffer = merged;
    if (buffer.length >= 8000) { socket.send(buffer.buffer); buffer = new Uint8Array(0); }
  };
  source.connect(processor);
  processor.connect(context.destination);
  connect();
  const dispose = () => {
    if (closed) return;
    closed = true; clearTimers();
    processor.disconnect(); source.disconnect();
    context.close().catch(() => {});
    socket?.close();
  };
  return {
    dispose,
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      clearTimers();
      processor.disconnect(); source.disconnect();
      stopPromise = (async () => {
        if (ready && socket?.readyState === 1) {
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 1600);
            finishResolve = () => { clearTimeout(timer); resolve(); };
            if (buffer.length) socket.send(buffer.buffer);
            socket.send(JSON.stringify({ type: 'finish' }));
          });
        }
        dispose();
      })();
      return stopPromise;
    },
  };
}
