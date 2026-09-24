import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { speechPcm16, speechDownsample, createDesktopAsr } from './desktopAsr.mjs';

test('PC preprocessing matches the untouched H5 algorithm byte for byte', () => {
  const source = fs.readFileSync(new URL('../pages/MobileMeetingRecorder.jsx', import.meta.url), 'utf8');
  const begin = source.indexOf('function downsampleTo16k(buffer');
  const end = source.indexOf('function audioExtensionForMime', begin);
  const h5 = vm.runInNewContext(`const TARGET_SAMPLE_RATE = 16000; ${source.slice(begin, end)}; ({ downsampleTo16k, floatToPcm16 })`);
  for (const level of [0, 0.001, 0.003, 0.02, 0.2, 0.9]) {
    const input = Float32Array.from({length:8192}, (_, i) => Math.sin(i * 0.2) * level);
    for (const rate of [16000, 44100, 48000]) {
      const pc = speechDownsample(input, rate), mobile = h5.downsampleTo16k(input, rate);
      assert.deepEqual(Array.from(pc), Array.from(mobile));
      const a = speechPcm16(pc), b = h5.floatToPcm16(mobile);
      assert.deepEqual(a && Array.from(new Uint8Array(a)), b && Array.from(new Uint8Array(b)));
    }
  }
});

test('capture waits for ready, silences output and flushes final ASR before closing', async () => {
  let socket, processor;
  const payloads = [], statuses = [];
  class Socket {
    constructor() { socket = this; this.readyState = 1; this.sent = []; }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class Context {
    constructor() { this.sampleRate = 16000; this.destination = {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor(size) { assert.equal(size,8192); processor = { connect() {}, disconnect() {} }; return processor; }
    close() { return Promise.resolve(); }
  }
  const asr = createDesktopAsr({stream:{}, url:'wss://example.test/ws?meetingId=test', onPayload:p=>payloads.push(p), onStatus:s=>statuses.push(s), AudioContextCtor:Context, WebSocketCtor:Socket});
  const out = new Float32Array(8192).fill(1);
  const event = { inputBuffer:{getChannelData:()=>new Float32Array(8192).fill(0.1)}, outputBuffer:{getChannelData:()=>out} };
  processor.onaudioprocess(event);
  assert.equal(socket.sent.length,0);
  assert.equal(out[0],0);
  socket.onmessage({data:JSON.stringify({type:'ready'})});
  processor.onaudioprocess(event);
  assert.equal(socket.sent[0].byteLength,16384);
  const stopping = asr.stop();
  assert.equal(socket.sent.at(-1),'{"type":"finish"}');
  socket.onmessage({data:JSON.stringify({type:'final',newText:'Final sentence'})});
  socket.onmessage({data:JSON.stringify({type:'finished'})});
  await stopping;
  assert.equal(payloads[0].newText,'Final sentence');
  assert.equal(socket.readyState,3);
  assert.deepEqual(statuses,['connecting','awaiting_audio','connected']);
  assert.equal(asr.stop(),stopping);
});


test('PC wakes a suspended graph, rebuilds stalled capture, and never stops the recording track', async () => {
  const contexts = [], sockets = [], callbacks = new Map(), statuses = [];
  let clock = 0, tick, cancelled = false, trackStops = 0;
  const stream = { getTracks: () => [{ stop: () => { trackStops++; } }] };
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.destination = {}; this.resumes = 0; contexts.push(this); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return this.processor = { connect() {}, disconnect() {} }; }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(x) { this.sent.push(x); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const a = createDesktopAsr({ stream, url: 'ws://test', onPayload() {}, onStatus: s => statuses.push(s),
    AudioContextCtor: Context, WebSocketCtor: Socket, now: () => clock,
    scheduleWatchdog: fn => { tick = fn; return 1; }, cancelWatchdog: () => { cancelled = true; },
    recoveryTarget: { addEventListener: (k, v) => callbacks.set(k, v), removeEventListener: k => callbacks.delete(k) } });
  assert.equal(contexts[0].resumes, 1);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'ready' }) });
  clock = 11000; tick();
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(sockets.length, 1);
  const event = level => ({ outputBuffer: { getChannelData: () => new Float32Array(8192) }, inputBuffer: { getChannelData: () => new Float32Array(8192).fill(level) } });
  contexts[1].processor.onaudioprocess(event(0.1));
  contexts[1].processor.onaudioprocess(event(0.1));
  assert.ok(sockets[0].sent.some(x => x instanceof ArrayBuffer));
  clock = 18000; contexts[1].processor.onaudioprocess(event(0));
  clock = 22000; tick();
  assert.equal(contexts.length, 2, 'silence is not a stalled graph');
  a.dispose(); tick();
  assert.equal(contexts.length, 2);
  assert.equal(trackStops, 0);
  assert.equal(callbacks.size, 0);
  assert.equal(cancelled, true);
});
