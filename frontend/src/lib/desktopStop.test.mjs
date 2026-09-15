import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { desktopDurationSeconds } from './desktopRecording.mjs';
import { withDeadline } from './recordingRequest.mjs';

test('real PC stop handler releases capture before merge and preserves retry session', async () => {
  const file = fs.readFileSync(new URL('../pages/MeetingComplianceWorkflow.jsx', import.meta.url), 'utf8');
  const code = file.slice(file.indexOf('  const stopAndUploadDesktopAudio ='), file.indexOf('  const toggleDesktopRecording ='));
  const order = [], durations = [], states = [];
  const ref = current => ({current});
  let fail = true;
  const context = {
    micStopPromiseRef:ref(null), micMediaRecorderRef:ref({state:'recording', addEventListener(name, fn) { if(name === 'stop') this.finish = fn; }, stop() { this.state = 'inactive'; this.finish(); }}),
    micCaptureStartedAtRef:ref(Date.now()-58200), micCaptureStoppedAtRef:ref(null),
    micStreamRef:ref({getTracks:()=>[{stop:()=>order.push('capture stopped')}]}),
    micAsrRef:ref({stop:async()=>order.push('ASR finished')}),
    micTranscriptUploadsRef:ref(new Set()), micPendingUploadsRef:ref(new Set()),
    micFailedChunksRef:ref(new Map()), micUploadFailedRef:ref(false), micChunkIndexRef:ref(20),
    micAudioChunksRef:ref([]), micRecordingSessionRef:ref('original-session'),
    setDesktopRecorderState:s=>states.push(s), setRecording:s=>order.push(`recording ${s}`), setDesktopAsrStatus:()=>{},
    completeMicAudioUpload:async duration=>{ durations.push(duration); order.push('merge'); if(fail) throw new Error('offline'); return {success:true}; },
    postDesktopSession:async()=>{}, uploadMicAudioChunk:async()=>{}, desktopDurationSeconds, withDeadline,
    message:{error:()=>{}}, Date, Promise,
  };
  const stop = vm.runInNewContext(`${code}; stopAndUploadDesktopAudio`, context);
  const first = stop(); assert.equal(stop(),first);
  assert.equal(await first,false);
  assert.ok(order.indexOf('capture stopped') < order.indexOf('merge'));
  assert.ok(order.indexOf('recording false') < order.indexOf('merge'));
  assert.equal(context.micRecordingSessionRef.current,'original-session');
  assert.equal(context.micChunkIndexRef.current,20);
  fail = false;
  assert.equal(await stop(),true);
  assert.equal(durations[0],59);
  assert.equal(durations[1],59);
  assert.equal(context.micChunkIndexRef.current,0);
  assert.equal(states.at(-1),'idle');
});
