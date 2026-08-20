import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Button, Input, Progress, Select, Space, Tag, Typography, message } from 'antd';
import {
  AudioOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  LogoutOutlined,
  MobileOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SignatureOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { authFetchJson, getStoredToken } from '../lib/auth';

const { Text, Title } = Typography;
const { TextArea } = Input;

const ROLE_BY_ACCOUNT = {
  zhangmin: { name: '张敏', role: '会议秘书', dept: '总经理办公室', seat: '主持主控席' },
  liuqiang: { name: '刘强', role: '主要负责人', dept: '经营管理层', seat: 'A01' },
  chenwei: { name: '陈伟', role: '分管领导', dept: '经营管理层', seat: 'A02' },
  wanglei: { name: '王磊', role: '审计监察', dept: '审计监察部', seat: 'B01' },
  wangming: { name: '王明', role: '议题负责人', dept: '项目管理部', seat: 'C01' },
};

const BIND_STEPS = [
  ['账号登录', '确认当前手机属于实名账号'],
  ['角色绑定', '绑定会议角色和席位'],
  ['声纹采集', '录音流写入角色轨道'],
  ['音频归档', '片段回传桌面端审查链路'],
];

const TARGET_SAMPLE_RATE = 16000;

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 KB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/* ═══ 手机端声纹注册组件 ═══ */
function MobileVoiceprintEnroll({ userId, displayName, role, dept }) {
  const [engineReady, setEngineReady] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0); // 0-100 音量电平
  const [recordedBlob, setRecordedBlob] = useState(null); // 录制的音频用于回放
  const [playing, setPlaying] = useState(false); // 回放状态
  const mediaRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const progressRef = useRef(null);
  const analyserRef = useRef(null);
  const levelTimerRef = useRef(null);
  const audioElRef = useRef(null);

  const MIN_RECORD_SEC = 10; // 最短录制时长

  useEffect(() => {
    authFetchJson('/api/voiceprint/status').then(d => setEngineReady(d?.ready)).catch(() => {});
    if (userId) {
      authFetchJson('/api/voiceprint/profiles').then(arr => {
        const p = Array.isArray(arr) ? arr.find(x => x.user_id === userId) : null;
        if (p) { setEnrolled(true); setSampleCount(p.sample_count); }
      }).catch(() => {});
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelTimerRef.current) clearInterval(levelTimerRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [userId]);

  // 实时音量电平
  const startLevelMeter = (stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      levelTimerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(100, Math.round(avg / 1.28))); // 归一化到 0-100
      }, 100);
    } catch (_) { /* 静默失败 */ }
  };

  const stopLevelMeter = () => {
    if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // P0-1: MIME 自动探测
      const _mt = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(
        t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)
      ) || '';
      const rec = _mt ? new MediaRecorder(stream, { mimeType: _mt }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(1000);
      mediaRef.current = rec;
      setRecording(true);
      setSeconds(0);
      setRecordedBlob(null);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
      startLevelMeter(stream);
    } catch (err) {
      message.error('麦克风访问失败：' + err.message);
    }
  };

  const stop = () => {
    if (seconds < MIN_RECORD_SEC) {
      message.warning(`请至少录制 ${MIN_RECORD_SEC} 秒（当前 ${seconds} 秒）`);
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    stopLevelMeter();
    setRecording(false);
    const rec = mediaRef.current;
    if (!rec) return;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setRecordedBlob(blob);
      streamRef.current?.getTracks?.().forEach(t => t.stop());
    };
    rec.stop();
  };

  const uploadEnroll = async () => {
    if (!recordedBlob) return;
    setUploading(true);
    setProgress(0);
    let pct = 0;
    progressRef.current = setInterval(() => {
      pct = Math.min(pct + 3, 95);
      setProgress(pct);
    }, 80);
    const fd = new FormData();
    fd.append('audio', recordedBlob, 'voiceprint.webm');
    fd.append('user_id', userId);
    fd.append('display_name', displayName);
    fd.append('role', role);
    fd.append('dept', dept);
    try {
      const resp = await fetch('/api/voiceprint/enroll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getStoredToken()}` },
        body: fd,
      });
      const data = await resp.json();
      if (data.ok) {
        message.success(`声纹注册成功（第 ${data.sample_count} 次采样）`);
        setEnrolled(true);
        setSampleCount(data.sample_count);
        setRecordedBlob(null);
      } else {
        message.error(data.detail || '注册失败');
      }
    } catch (err) {
      message.error('上传失败：' + err.message);
    }
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setTimeout(() => { setUploading(false); setProgress(0); }, 600);
  };

  const discardRecording = () => {
    setRecordedBlob(null);
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    setPlaying(false);
  };

  const togglePlayback = () => {
    if (!recordedBlob) return;
    if (playing) {
      audioElRef.current?.pause();
      setPlaying(false);
    } else {
      const url = URL.createObjectURL(recordedBlob);
      const audio = new Audio(url);
      audioElRef.current = audio;
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      audio.play();
      setPlaying(true);
    }
  };

  if (!engineReady) return null;

  // 音量电平颜色
  const levelColor = audioLevel < 10 ? '#ef4444' : audioLevel < 30 ? '#f59e0b' : '#22c55e';
  const levelOk = audioLevel >= 15;

  return (
    <section className="mobile-recorder-card" style={{ marginTop: 0 }}>
      <div className="mobile-recorder-section-title">
        <SafetyCertificateOutlined />
        声纹注册
        {enrolled && <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>已注册 · {sampleCount}次</Tag>}
      </div>
      <div className="mobile-recorder-muted" style={{ marginTop: 6 }}>
        {enrolled
          ? '声纹已采集。可多次录制提升识别准确率。'
          : '录制一段朗读语音，系统提取声纹特征后可自动识别说话人。'}
      </div>

      {/* 提示：未录制且未注册 */}
      {!recording && !recordedBlob && !enrolled && (
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 8,
          background: '#eff6ff', border: '1px solid #bfdbfe',
          fontSize: 12, color: '#1e40af', lineHeight: 1.6,
        }}>
          💡 请在<strong>安静环境</strong>下，将手机放在嘴边 <strong>20-30cm</strong> 处朗读，至少录制 <strong>{MIN_RECORD_SEC} 秒</strong>。
        </div>
      )}

      {/* 录制中：显示脚本 + 音量电平 */}
      {recording && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            padding: '12px 14px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            fontSize: 14, lineHeight: 1.8, color: '#1f2937',
            fontWeight: 500, letterSpacing: '0.02em',
          }}>
            请朗读：<br />
            <span style={{ color: '#dc2626', fontSize: 15 }}>
              各位领导好，我是{displayName || '参会人员'}，今天参加会议。
            </span>
          </div>
          {/* 音量电平条 */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b7280', minWidth: 40 }}>音量</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
                <div style={{
                  width: `${audioLevel}%`, height: '100%', borderRadius: 4,
                  background: levelColor, transition: 'width 0.1s ease',
                }} />
              </div>
              <span style={{ fontSize: 11, color: levelColor, minWidth: 30 }}>
                {levelOk ? '✓' : '太小'}
              </span>
            </div>
          </div>
          {/* 计时器 + 停止按钮 */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 15 }}>
              ● {seconds}s
              {seconds < MIN_RECORD_SEC && <span style={{ color: '#9ca3af', fontWeight: 400 }}> / {MIN_RECORD_SEC}s</span>}
            </span>
            {seconds >= MIN_RECORD_SEC && <span style={{ color: '#22c55e', fontSize: 12 }}>✓ 可以停止</span>}
            <Button size="small" danger onClick={stop} disabled={seconds < 3}>
              停止录制
            </Button>
          </div>
        </div>
      )}

      {/* 录制完成：回放 + 确认上传 */}
      {!recording && recordedBlob && !uploading && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            fontSize: 13, color: '#166534',
          }}>
            ✓ 录制完成（{seconds}秒），请回放确认声音清晰后上传。
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Button size="small" onClick={togglePlayback}>
              {playing ? '⏸ 停止' : '▶ 回放'}
            </Button>
            <Button size="small" onClick={discardRecording}>
              重新录制
            </Button>
            <Button size="small" type="primary" onClick={uploadEnroll}>
              确认上传
            </Button>
          </div>
        </div>
      )}

      {/* 上传中 */}
      {uploading && (
        <div style={{ marginTop: 10, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#2563eb', fontSize: 13, fontWeight: 500 }}>正在提取声纹特征...</span>
            <span style={{ color: '#6b7280', fontSize: 12 }}>{progress}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`, height: '100%', borderRadius: 3,
              background: progress >= 100 ? '#22c55e' : '#3b82f6',
              transition: 'width 0.15s ease',
            }} />
          </div>
        </div>
      )}

      {/* 开始按钮 */}
      {!recording && !recordedBlob && !uploading && (
        <div style={{ marginTop: 10 }}>
          <Button size="small" type={enrolled ? 'default' : 'primary'} onClick={start}>
            {enrolled ? '再次录制提升准确率' : '🎤 开始录制声纹'}
          </Button>
        </div>
      )}
    </section>
  );
}

function downsampleTo16k(buffer, inputSampleRate) {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return buffer;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
      accum += buffer[index];
      count += 1;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatToPcm16(float32Array) {
  let sumSq = 0;
  for (let i = 0; i < float32Array.length; i++) sumSq += float32Array[i] * float32Array[i];
  const rms = Math.sqrt(sumSq / float32Array.length);
  // 噪声门：更保守地保留弱语音，避免误杀轻声、句尾和远场说话
  if (rms < 0.0028) return null;
  // AGC：生产环境采用更稳妥的增益策略，避免把底噪一并放大
  const targetRms = 0.12;
  const gain = rms > 0.001 ? Math.min(targetRms / rms, 4.0) : 1.0;

  const output = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(output);
  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index] * gain));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

export default function MobileMeetingRecorder({ currentUser, onLogout }) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [latestRecognizedText, setLatestRecognizedText] = useState('');
  const [latestRecognizedAt, setLatestRecognizedAt] = useState('');
  const [manualText, setManualText] = useState('');
  const [liveLines, setLiveLines] = useState([]);
  const [editingLine, setEditingLine] = useState(null);
  const [correctionText, setCorrectionText] = useState('');
  const [signatureDirty, setSignatureDirty] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('待启动');
  const [recordingSummary, setRecordingSummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLines, setHistoryLines] = useState([]);
  const [historyAudios, setHistoryAudios] = useState([]);
  const [audioPlaybackUrls, setAudioPlaybackUrls] = useState({});
  const [activeSpeakerName, setActiveSpeakerName] = useState('');
  const [activeSpeakerRole, setActiveSpeakerRole] = useState('');
  // ASR 后端：优先本地 Qwen（无并发限制），DashScope 作为可选
  const [asrBackend, setAsrBackend] = useState(() => {
    try {
      const saved = localStorage.getItem('ai616_asr_backend');
      if (saved === 'dashscope' || saved === 'qwen') return saved;
    } catch (_) {}
    return 'qwen';  // 默认本地，避免 DashScope 并发限制导致第二人无法转写
  });
  const signatureCanvasRef = useRef(null);
  const signatureDrawingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recognitionRef = useRef(null);
  const asrSocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioChunksRef = useRef([]);
  const chunkIndexRef = useRef(0); // 流式上传 chunk 序号
  // P0-3: client_id — 每次录音会话唯一，用于幂等判断
  const clientIdRef = useRef(`phone-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const recordingStartTimeRef = useRef(null); // 录音开始时间，用于 Whisper 时间戳对齐
  const recordingRef = useRef(false);
  const asrConfidenceRef = useRef(null);
  const joinedRef = useRef(false);
  const joinRetryRef = useRef(0);
  const joinMaxRetries = 3;
  const joinRetryDelays = [2000, 4000, 8000];
  const audioUrlRef = useRef('');
  const audioPlaybackUrlsRef = useRef({});
  // 暂停/继续
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  // 屏幕常亮
  const wakeLockRef = useRef(null);
  // 分块上传重试队列
  const retryQueueRef = useRef([]);
  const retryTimerRef = useRef(null);
  // 连接状态
  // P0-7: WebSocket 状态机: idle → connecting → connected → reconnecting → degraded → stopped
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  // 音频合并/上传状态
  const [isMerging, setIsMerging] = useState(false);
  const [pendingChunks, setPendingChunks] = useState(0);
  // P0-4: ACK 队列 — chunk 必须收到 ACK 才算成功
  const pendingAckRef = useRef(new Map()); // Map<chunkIndex, {blob, attempts, sentAt}>
  // P0-8: WebSocket 心跳
  const heartbeatRef = useRef(null); // setInterval ID
  const lastPongRef = useRef(0); // 上次收到 pong 的时间
  // Refs for functions used in useEffect (avoid stale closures)
  const flushPendingChunksRef = useRef(null);
  const startFunAsrRef = useRef(null);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const meetingId = params.get('meetingId') || 'meeting-gxq-fc-2026-02';
  const [meetingTitle, setMeetingTitle] = useState(params.get('meeting') || '');
  const [agenda, setAgenda] = useState(params.get('agenda') || '');
  const [projectName, setProjectName] = useState(params.get('project') || '');
  const [meetingDate, setMeetingDate] = useState(params.get('date') || new Date().toISOString().slice(0, 10));
  const [meetingInfoLoaded, setMeetingInfoLoaded] = useState(false);
  const [meetingDocxInfo, setMeetingDocxInfo] = useState(null);
  const [meetingInfoRefreshAt, setMeetingInfoRefreshAt] = useState(0);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxDownloading, setDocxDownloading] = useState(false);
  const [docxError, setDocxError] = useState('');
  const [deviceType, setDeviceType] = useState('mobile');
  const [deviceId, setDeviceId] = useState(() => {
    try { return localStorage.getItem('ai616_recorder_device_id') || ''; } catch (_) { return ''; }
  });
  const [deviceLabel, setDeviceLabel] = useState(() => {
    try { return localStorage.getItem('ai616_recorder_device_label') || '手机麦克风'; } catch (_) { return '手机麦克风'; }
  });
  const [transport, setTransport] = useState(() => {
    try { return localStorage.getItem('ai616_recorder_transport') || 'web-mobile'; } catch (_) { return 'web-mobile'; }
  });
  const [firmwareVersion, setFirmwareVersion] = useState(() => {
    try { return localStorage.getItem('ai616_recorder_firmware_version') || ''; } catch (_) { return ''; }
  });
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const syncMeetingInfo = async ({ silent = false } = {}) => {
    if (!meetingId || meetingId === 'meeting-gxq-fc-2026-02') {
      if (!silent) setMeetingInfoLoaded(true);
      return;
    }
    if (!silent) setMeetingInfoLoaded(false);
    try {
      const data = await authFetchJson(`/api/meetings/${meetingId}`);
      if (!mountedRef.current) return;
      const m = data.meeting || {};
      setMeetingTitle(m.title || m.agenda || meetingTitle);
      setAgenda(m.agenda || agenda);
      setProjectName(m.project || projectName);
      setMeetingDate(m.date || m.meeting_date || meetingDate);
      setMeetingDocxInfo(m.whisperDocx || null);
      setDocxError(m.whisperDocx?.error || '');
      setMeetingInfoRefreshAt(Date.now());
    } catch (_) {
      if (!mountedRef.current) return;
      setMeetingDocxInfo(prev => prev || null);
    } finally {
      if (mountedRef.current) setMeetingInfoLoaded(true);
    }
  };

  // 如果 URL 只传了 meetingId，从后端拉取会议信息
  useEffect(() => {
    syncMeetingInfo({ silent: true });
  }, [meetingId]);

  const accountKey = String(currentUser?.username || currentUser?.name || '').toLowerCase();
  const boundRole = ROLE_BY_ACCOUNT[accountKey] || {
    name: currentUser?.name || '参会人',
    role: currentUser?.meetingRole || (currentUser?.role === 'admin' ? '会议管理员' : '参会代表'),
    dept: currentUser?.dept || '参会部门',
    seat: currentUser?.meetingSeat || (currentUser?.role === 'admin' ? '主控席' : '移动端席位'),
  };

  const speechRecognitionCtor = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }, []);
  const qwenAsrAvailable = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.WebSocket && (window.AudioContext || window.webkitAudioContext));
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    document.documentElement.classList.add('mobile-recorder-scroll');
    document.body.classList.add('mobile-recorder-scroll');
    root?.classList.add('mobile-recorder-scroll');
    return () => {
      document.documentElement.classList.remove('mobile-recorder-scroll');
      document.body.classList.remove('mobile-recorder-scroll');
      root?.classList.remove('mobile-recorder-scroll');
    };
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setSeconds(prev => prev + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // P0-11: 页面可见性变化时全面检查录音状态（切后台/锁屏恢复）
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && recordingRef.current) {
        console.warn('[REC] 页面进入后台，录音可能受影响');
      }
      if (!document.hidden && recordingRef.current) {
        console.warn('[REC] 页面恢复，检查所有状态...');
        // 1. 检查 AudioContext
        const ctx = audioContextRef.current;
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
          console.warn('[REC] AudioContext 已恢复');
        }
        // 2. 检查 MediaRecorder
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'inactive') {
          // MediaRecorder 已停止（系统可能暂停了），提示用户
          setSpeechStatus('录音已被系统暂停，请点击恢复录音');
          setRecording(false);
          console.warn('[REC] MediaRecorder 已停止，需用户手动恢复');
        }
        // 3. 检查麦克风 track
        const stream = mediaStreamRef.current;
        if (stream) {
          const track = stream.getAudioTracks()[0];
          if (track && track.readyState === 'ended') {
            setSpeechStatus('麦克风已被系统断开，请点击恢复录音');
            setRecording(false);
            console.warn('[REC] 麦克风 track 已 ended');
          }
        }
        // 4. 检查 WebSocket，断开则触发重连
        const ws = asrSocketRef.current;
        if (ws && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
          console.warn('[REC] WebSocket 已断开，触发重连');
          asrSocketRef.current = null;
          setConnectionStatus('reconnecting');
          setSpeechStatus('实时转写重连中...');
          // 延迟 500ms 等网络稳定
          window.setTimeout(() => {
            if (recordingRef.current) {
              startFunAsrRecognition(mediaStreamRef.current).catch(() => {});
            }
          }, 500);
        }
      }
    };
    const handleFocus = () => {
      // P0-11: 窗口获得焦点时也检查
      if (recordingRef.current) handleVisibility();
    };
    const handlePageshow = (e) => {
      // P0-11: bfcache 恢复时检查
      if (recordingRef.current) handleVisibility();
    };
    // P0-10: 网络状态监听
    const handleOnline = () => {
      if (recordingRef.current) {
        console.warn('[NET] 网络恢复，补传 pending chunks 并重连 ASR');
        setSpeechStatus('网络已恢复，正在补传数据...');
        flushPendingChunksRef.current?.()?.catch(() => {});
        // 重连 WebSocket
        window.setTimeout(() => {
          if (recordingRef.current && (!asrSocketRef.current || asrSocketRef.current.readyState !== WebSocket.OPEN)) {
            startFunAsrRef.current?.(mediaStreamRef.current)?.catch(() => {});
          }
        }, 500);
      }
    };
    const handleOffline = () => {
      if (recordingRef.current) {
        console.warn('[NET] 网络断开，录音继续保存到 pending 队列');
        setSpeechStatus('网络已中断，录音仍在保存');
        setConnectionStatus('reconnecting');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageshow);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageshow);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    Object.values(audioPlaybackUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    recognitionRef.current?.stop?.();
    mediaRecorderRef.current?.stop?.();
    audioProcessorRef.current?.disconnect?.();
    audioSourceRef.current?.disconnect?.();
    audioContextRef.current?.close?.();
    asrSocketRef.current?.close?.();
    mediaStreamRef.current?.getTracks?.().forEach(track => track.stop());
  }, []);

  const isCurrentUserRecord = (record = {}) => {
    const username = String(currentUser?.username || '').toLowerCase();
    const displayName = String(currentUser?.name || boundRole.name || '').trim();
    const recordUsername = String(record.username || record.speaker?.username || '').toLowerCase();
    const recordName = String(record.speakerName || record.speaker?.displayName || '').trim();
    if (username && recordUsername === username) return true;
    return Boolean(displayName && recordName === displayName);
  };

  const loadRecorderHistory = async ({ silent = false } = {}) => {
    if (!meetingId) return;
    if (!silent) setHistoryLoading(true);
    try {
      // 检查会议是否已结束（PC端点了结束会议）— 仅提示，不强制停止录音
      if (recordingRef.current) {
        try {
          const meetingInfo = await authFetchJson(`/api/meetings/${meetingId}`);
          const phase = meetingInfo?.meeting?.phase || '';
          if (phase && !['会中记录', '会中', '会后终审', '已归档'].includes(phase)) {
            message.warning(`会议阶段已变为"${phase}"，建议结束录音`);
          }
        } catch (_) { /* 网络问题忽略，不影响录音 */ }
      }
      const data = await authFetchJson(`/api/meeting/transcripts/${meetingId}`);
      const ownTranscripts = (data.transcripts || [])
        .filter(isCurrentUserRecord)
        .slice(-30)
        .reverse()
        .map(item => ({
          id: item.id,
          transcriptId: item.id,
          text: item.transcript,
          originalText: item.originalTranscript || item.transcript,
          time: item.clientTime || item.serverTime?.slice(11, 19) || '--:--',
          serverTime: item.serverTime,
          final: item.isFinal,
          correctionSigned: Boolean(item.correctionSigned),
          correctionSignedAt: item.correctionSignedAt,
        }));
      const ownAudios = (data.events || [])
        .filter(item => item.type === 'audio' && item.playbackUrl && isCurrentUserRecord(item))
        .slice(-10)
        .reverse();
      setHistoryLines(ownTranscripts);
      setHistoryAudios(ownAudios);
      setLiveLines(prev => {
        const merged = new Map();
        const tempIdPattern = /^\d{13,}-0?\.\d+$/;
        const historyTexts = new Set(ownTranscripts.map(item => (item.text || '').trim()));
        [...prev, ...ownTranscripts].forEach(item => {
          const key = item.transcriptId || item.id;
          if (!key) return;
          const isTemporaryId = tempIdPattern.test(String(key));
          const textKey = (item.text || '').trim();
          if (isTemporaryId && historyTexts.has(textKey)) return;
          merged.set(key, item);
        });
        return Array.from(merged.values()).slice(0, 12);
      });
    } catch (err) {
      if (!silent) message.warning(`录音记录加载失败：${err.message}`);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadRecorderHistory({ silent: true });
    const timer = window.setInterval(() => loadRecorderHistory({ silent: true }), recording ? 3000 : 9000);
    return () => window.clearInterval(timer);
  }, [meetingId, recording, currentUser?.username]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadRecorderHistory({ silent: true });
        if (recordingRef.current) {
          // 重新获取 Wake Lock
          requestWakeLock();
          // 恢复被挂起的 AudioContext
          const ctx = audioContextRef.current;
          if (ctx && ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
          message.info('页面已恢复，正在同步本机已回传记录。');
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [meetingId]);

  const loadAudioPlayback = async (event) => {
    if (!event?.id || !event.playbackUrl) return;
    if (audioPlaybackUrls[event.id]) return;
    try {
      const token = getStoredToken();
      const response = await fetch(event.playbackUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audioPlaybackUrlsRef.current[event.id] = url;
      setAudioPlaybackUrls(prev => ({ ...prev, [event.id]: url }));
    } catch (err) {
      message.error(`录音回放加载失败：${err.message}`);
    }
  };

  const postSession = async (action, payload = {}) => {
    await authFetchJson('/api/meeting/recorder/session', {
      method: 'POST',
      body: JSON.stringify({
        meeting_id: meetingId,
        meeting_title: meetingTitle,
        agenda,
        action,
        device_type: deviceType,
        device_id: deviceId,
        device_label: deviceLabel,
        channel: 'primary',
        transport,
        firmware_version: firmwareVersion,
        ...payload,
      }),
    });
  };

  // 设置会议阶段（手机端录音 = 开会）
  const setMeetingStage = async (stage, phase) => {
    try {
      await authFetchJson(`/api/meetings/${meetingId}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage, phase }),
      });
    } catch (_) {}
  };

  const refreshWhisperDocxInfo = async ({ silent = false } = {}) => {
    await syncMeetingInfo({ silent });
  };

  const downloadWhisperDocx = async () => {
    if (!meetingId) return;
    setDocxDownloading(true);
    setDocxError('');
    try {
      const response = await authFetch(`/api/meetings/${meetingId}/whisper-docx`, {
        method: 'GET',
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const json = await response.json();
          detail = json.detail || json.message || detail;
        } catch (_) {}
        throw new Error(detail);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      const fileName = decodeURIComponent(match?.[1] || match?.[2] || `whisper-${meetingId}.docx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDocxDownloading(false);
    }
  };

  const doJoin = () => {
    if (!meetingId) return;
    joinedRef.current = true;
    joinRetryRef.current = 0;
    setSpeechStatus('正在接入会议...');
    attemptJoin();
  };

  const attemptJoin = () => {
    if (!mountedRef.current) return;
    postSession('join')
      .then(() => {
        if (!mountedRef.current) return;
        setSpeechStatus('已进入会议，等待开始录音');
        joinRetryRef.current = 0;
      })
      .catch(err => {
        if (!mountedRef.current) return;
        joinRetryRef.current += 1;
        if (joinRetryRef.current <= joinMaxRetries) {
          const delay = joinRetryDelays[joinRetryRef.current - 1];
          setSpeechStatus(`接入失败，${delay / 1000}s 后重试 (${joinRetryRef.current}/${joinMaxRetries})`);
          window.setTimeout(() => attemptJoin(), delay);
        } else {
          joinedRef.current = false;
          setSpeechStatus('接入失败，请点击下方按钮重试');
          message.error(`会议接入失败：${err.message}`);
        }
      });
  };

  const retryJoinManually = () => {
    if (joinedRef.current) return;
    doJoin();
  };

  useEffect(() => {
    if (!meetingId || joinedRef.current) return;
    doJoin();
  }, [meetingId]);

  const postTranscript = async (text, isFinal = true, conf = null, vpInfo = null) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    const optimisticLine = {
      id: `${Date.now()}-${Math.random()}`,
      text: cleanText,
      originalText: cleanText,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      final: isFinal,
      correctionSigned: false,
    };
    setLatestRecognizedText(cleanText);
    setLatestRecognizedAt(optimisticLine.time);
    setLiveLines(prev => [...prev, optimisticLine]);  // 新消息追加到末尾（底部）
    try {
      const confidence = (typeof conf === 'number' && conf >= 0 && conf <= 1) ? conf : undefined;
      const speakerOverride = activeSpeakerName.trim()
        ? { speaker_name: activeSpeakerName.trim(), speaker_role: activeSpeakerRole || '参会代表' }
        : {};
      // 声纹识别结果（如有）
      const voiceprintFields = vpInfo && vpInfo.speaker_name && !activeSpeakerName.trim()
        ? {
            speaker_name: vpInfo.speaker_name,
            speaker_confidence: vpInfo.speaker_confidence,
            identified_by: vpInfo.identified_by || 'voiceprint-realtime',
          }
        : {};
      // 声纹冲突提示：手动选择与声纹识别结果不同
      if (vpInfo?.speaker_name && activeSpeakerName.trim() && vpInfo.speaker_name !== activeSpeakerName.trim()) {
        message.warning(`声纹识别为"${vpInfo.speaker_name}"，但当前发言人选为"${activeSpeakerName.trim()}"，已按手动选择记录。`, 5);
      }
      const data = await authFetchJson('/api/meeting/transcripts/chunk', {
        method: 'POST',
        body: JSON.stringify({
          meeting_id: meetingId,
          meeting_title: meetingTitle,
          agenda,
          transcript: cleanText,
          is_final: isFinal,
          client_time: optimisticLine.time,
          ...(confidence !== undefined ? { confidence } : {}),
          ...speakerOverride,
          ...voiceprintFields,
        }),
      });
      if (data.record?.id) {
        setLiveLines(prev => prev.map(item => (
          item.id === optimisticLine.id
            ? {
                ...item,
                id: data.record.id,
                transcriptId: data.record.id,
                text: data.record.transcript,
                originalText: data.record.transcript,
                correctionSigned: Boolean(data.record.correctionSigned),
              }
            : item
        )));
        loadRecorderHistory({ silent: true });
      } else if (data.duplicate) {
        // 去重 — 移除乐观行
        setLiveLines(prev => prev.filter(item => item.id !== optimisticLine.id));
      }
    } catch (err) {
      // API 失败 — 移除乐观行，不留下幽灵
      setLiveLines(prev => prev.filter(item => item.id !== optimisticLine.id));
      throw err; // 让调用方处理错误提示
    }
  };

  // ── 屏幕常亮 ──
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
      }
    } catch (e) {
      console.warn('Wake Lock 请求失败:', e);
    }
  };
  const releaseWakeLock = async () => {
    try { if (wakeLockRef.current) { await wakeLockRef.current.release(); wakeLockRef.current = null; } } catch {}
  };

  // ── 分块上传重试 ──
  const flushRetryQueue = async () => {
    const queue = retryQueueRef.current;
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    for (const item of batch) {
      if (item.attempts >= 3) { console.warn(`Chunk ${item.index} 超过最大重试次数`); continue; }
      try {
        const token = getStoredToken();
        const form = new FormData();
        form.append('meeting_id', meetingId);
        form.append('chunk_index', String(item.index));
        form.append('file', item.blob, `chunk_${item.index}.webm`);
        const resp = await fetch('/api/meeting/recorder/audio/chunk', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (!resp.ok) { item.attempts++; queue.push(item); }
      } catch (e) { item.attempts++; queue.push(item); }
    }
  };

  // P0-4: 流式上传单个录音 chunk，等待 ACK 确认落盘
  const uploadAudioChunk = async (blob, index) => {
    // 加入 pending ACK 队列
    pendingAckRef.current.set(index, { blob, attempts: 0, sentAt: Date.now() });
    setPendingChunks(pendingAckRef.current.size);
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('meeting_id', meetingId);
      form.append('client_id', clientIdRef.current);
      form.append('chunk_index', String(index));
      form.append('file', blob, `chunk_${index}.webm`);
      const resp = await fetch('/api/meeting/recorder/audio/chunk', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ack === index || data.success) {
          // ACK 确认 — 从 pending 队列移除
          pendingAckRef.current.delete(index);
          setPendingChunks(pendingAckRef.current.size);
        }
      } else {
        console.warn(`[AUDIO] Chunk ${index} 上传失败: HTTP ${resp.status}，保留待重传`);
      }
    } catch (e) {
      console.warn(`[AUDIO] Chunk ${index} 上传异常，保留待重传:`, e);
    }
  };

  // P0-4: 重传 pending chunks（网络恢复后按序号顺序补传）
  const flushPendingChunks = async () => {
    flushPendingChunksRef.current = flushPendingChunks;
    const pending = Array.from(pendingAckRef.current.entries()).sort((a, b) => a[0] - b[0]);
    for (const [index, item] of pending) {
      if (item.attempts >= 5) continue; // 最多重试5次
      item.attempts++;
      await uploadAudioChunk(item.blob, index);
    }
  };

  // 录音完成后通知后端合并所有 chunk
  const completeAudioUpload = async (durationSeconds, totalChunks) => {
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('meeting_id', meetingId);
      form.append('meeting_title', meetingTitle);
      form.append('agenda', agenda);
      form.append('duration_seconds', String(durationSeconds || 0));
      form.append('total_chunks', String(totalChunks));
      // 传录音开始时间，用于 Whisper 时间戳对齐会议时间轴
      if (recordingStartTimeRef.current) {
        form.append('recording_start_time', new Date(recordingStartTimeRef.current).toISOString());
      }
      const resp = await fetch('/api/meeting/recorder/audio/complete', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) {
        console.warn(`录音合并失败: HTTP ${resp.status}`);
        return null;
      }
      return resp.json();
    } catch (e) {
      console.warn('录音合并异常:', e);
      return null;
    }
  };

  const stopFunAsrRecognition = () => {
    audioProcessorRef.current?.disconnect?.();
    audioSourceRef.current?.disconnect?.();
    audioContextRef.current?.close?.();
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioContextRef.current = null;

    const socket = asrSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'finish' }));
        window.setTimeout(() => socket.close(), 1600);
      } catch (_) {
        socket.close();
      }
    }
    asrSocketRef.current = null;
  };

  const attachFunAsrAudioStream = (stream, socket) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('当前浏览器不支持 AudioContext');
    }
    const audioContext = new AudioContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
    audioContext.onstatechange = () => {
      if (audioContext.state === 'suspended' && recordingRef.current) {
        audioContext.resume().catch(() => {});
      }
    };
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(8192, 1, 1);
    const AUDIO_BATCH_BYTES = 8000;
    let audioBuffer = new Uint8Array(0);
    let lastProcessTime = Date.now();
    processor.onaudioprocess = event => {
      lastProcessTime = Date.now();
      event.outputBuffer.getChannelData(0).fill(0);
      const currentSocket = asrSocketRef.current;
      if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16k(input, audioContext.sampleRate);
      const pcmBuf = floatToPcm16(downsampled);
      if (pcmBuf === null) return;
      const pcm = new Uint8Array(pcmBuf);
      const merged = new Uint8Array(audioBuffer.length + pcm.length);
      merged.set(audioBuffer, 0);
      merged.set(pcm, audioBuffer.length);
      audioBuffer = merged;
      if (audioBuffer.length >= AUDIO_BATCH_BYTES) {
        currentSocket.send(audioBuffer.buffer);
        audioBuffer = new Uint8Array(0);
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    const healthWatchdog = window.setInterval(() => {
      if (!recordingRef.current) { window.clearInterval(healthWatchdog); return; }
      const now = Date.now();
      if (now - lastProcessTime > 10000) {
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        // P0-2: AudioContext 关闭不影响 MediaRecorder（录音是主链路，ASR 是旁路）
        if (audioContext.state === 'closed') {
          setSpeechStatus('实时转写中断，录音仍在保存');
          window.clearInterval(healthWatchdog);
        }
      }
    }, 5000);
  };

  const startFunAsrRecognition = async (stream) => {
    startFunAsrRef.current = startFunAsrRecognition;
    let reconnectAttempts = 0;
    // P0-9: 无限自动重连，不设上限。退避: 1s→2s→4s→8s→10s→10s...
    const asrName = asrBackend === 'qwen' ? 'SenseVoice' : 'Fun-ASR';

    const doConnect = (isReconnect = false) => new Promise((resolve, reject) => {
      const token = getStoredToken();
      if (!token) {
        reject(new Error(`未登录，无法启动 ${asrName}`));
        return;
      }
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsPath = asrBackend === 'qwen' ? '/api/meeting/asr/qwen/ws' : '/api/meeting/asr/ws';
      const wsParams = new URLSearchParams({
        token,
        meetingId,
        meetingTitle,
        agenda,
        ...(isReconnect ? { resume: '1' } : {}),
      });
      // WebSocket 直连后端（绕过不支持 WS 的外部代理）
      // 优先用同源；如果当前是 HTTPS 外部域名，则降级到局域网直连
      let wsHost = window.location.host;
      if (window.location.protocol === 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        wsHost = '192.168.66.44';  // 直连后端 nginx，绕过外部 HTTPS 代理
      }
      const socket = new WebSocket(`${wsProtocol}//${wsHost}${wsPath}?${wsParams.toString()}`);
      let ready = false;
      let settled = false;
      const readyTimer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error(`${asrName} 连接超时`));
      }, 15000);

      const failBeforeReady = (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(readyTimer);
        socket.close();
        reject(err instanceof Error ? err : new Error(String(err || `${asrName} 连接失败`)));
      };

      socket.binaryType = 'arraybuffer';
      socket.onopen = () => setSpeechStatus(isReconnect ? `${asrName} 重连中...` : `正在连接 ${asrName} 实时识别...`);
      socket.onerror = () => {
        if (!ready) failBeforeReady(new Error(`${asrName} WebSocket 异常`));
      };
      socket.onclose = () => {
        // P0-8: 清除心跳
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (!ready) {
          failBeforeReady(new Error(`${asrName} WebSocket 已关闭`));
        } else if (recordingRef.current) {
          // P0-9: 无限自动重连 — 只要还在录音就不停止
          setConnectionStatus('reconnecting');
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 3)), 10000);
          console.warn(`${asrName} WS 断连，${Math.round(delay / 1000)}秒后第${reconnectAttempts}次重连...`);
          setSpeechStatus(`${asrName} 连接断开，${Math.round(delay / 1000)}秒后重连...`);
          window.setTimeout(() => doReconnect(), delay);
        } else {
          setConnectionStatus('disconnected');
        }
      };
      socket.onmessage = event => {
      let payload = {};
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      // P0-8: pong 响应 — 更新心跳时间戳
      if (payload.type === 'pong') {
        lastPongRef.current = Date.now();
        return;
      }
      if (payload.type === 'ready') {
        try {
          if (!isReconnect) {
            // 首次连接：建立音频处理管线
            attachFunAsrAudioStream(stream, socket);
          }
          ready = true;
          settled = true;
          reconnectAttempts = 0;
          window.clearTimeout(readyTimer);
          setSpeechStatus(`${asrName} 实时转写中`);
          setConnectionStatus('connected');
          asrSocketRef.current = socket;
          // P0-8: 启动心跳 — 每 15 秒发 ping，30 秒无 pong 触发重连
          lastPongRef.current = Date.now();
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
          heartbeatRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              if (Date.now() - lastPongRef.current > 30000) {
                console.warn('[WS] 心跳超时 30s，主动断开重连');
                socket.close();
                return;
              }
              socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, 15000);
          resolve(true);
        } catch (err) {
          failBeforeReady(err);
        }
        return;
      }
      if (payload.type === 'preview') {
        // SenseVoice 实时预览 — 覆盖绿色框，不入库
        const text = String(payload.text || '').trim();
        if (text) setInterimText(text);
        return;
      }
      if (payload.type === 'commit') {
        // SenseVoice 正式入库 — 清预览框，生成气泡，写入 DB
        const text = String(payload.text || '').trim();
        if (text) {
          setInterimText('');
          postTranscript(text, true).catch(err => message.error(`${asrName} 回传失败：${err.message}`));
        }
        return;
      }
      if (payload.type === 'interim') {
        // 未成句预览 — 仅 UI 灰显，不入库
        const text = String(payload.text || '').trim();
        if (text) setInterimText(text);
        return;
      }
      if (payload.type === 'final') {
        // 完整句子 — newText 是独立不重叠句子，提交入库
        const newText = String(payload.newText || '').trim();
        const fullText = String(payload.fullText || payload.text || '').trim();
        if (!newText && !fullText) return;
        if (fullText) setInterimText('');
        if (newText) {
          const conf = typeof payload.confidence === 'number' ? payload.confidence : null;
          if (conf !== null) asrConfidenceRef.current = conf;
          // 声纹识别信息
          const vpInfo = payload.speaker_name ? {
            speaker_name: payload.speaker_name,
            speaker_confidence: payload.speaker_confidence,
            identified_by: payload.identified_by,
          } : null;
          postTranscript(newText, true, conf, vpInfo).catch(err => message.error(`${asrName} 回传失败：${err.message}`));
        }
        return;
      }
      if (payload.type === 'result') {
        // 兼容旧协议（向后兼容）
        const text = String(payload.text || '').trim();
        if (!text) return;
        if (payload.isFinal) {
          setInterimText('');
          const conf = typeof payload.confidence === 'number' ? payload.confidence : null;
          if (conf !== null) asrConfidenceRef.current = conf;
          const vpInfo = payload.speaker_name ? {
            speaker_name: payload.speaker_name,
            speaker_confidence: payload.speaker_confidence,
            identified_by: payload.identified_by,
          } : null;
          postTranscript(text, true, conf, vpInfo).catch(err => message.error(`${asrName} 回传失败：${err.message}`));
        } else {
          setInterimText(text);
        }
        return;
      }
      if (payload.type === 'finished') {
        setSpeechStatus(`${asrName} 识别已结束`);
        return;
      }
      if (payload.type === 'error') {
        const err = new Error(payload.message || `${asrName} 服务异常`);
        if (!ready) {
          failBeforeReady(err);
        } else {
          setSpeechStatus(err.message);
        }
      }
    };
  });

    const doReconnect = () => {
      doConnect(true).catch(err => {
        console.warn(`${asrName} 重连失败:`, err.message);
        // P0-9: 无限自动重连，不设上限
        reconnectAttempts++;
        const delay = Math.min(3000 * reconnectAttempts, 15000);
        window.setTimeout(() => doReconnect(), delay);
      });
    };

    // 首次失败后自动等待3秒重试一次
    try {
      return await doConnect(false);
    } catch (firstErr) {
      setSpeechStatus(`Fun-ASR 首次连接失败，3秒后重试...（${firstErr.message}）`);
      await new Promise(r => window.setTimeout(r, 3000));
      setSpeechStatus(`正在重试 ${asrName} 连接...`);
      return await doConnect(false);
    }
  };

  // WebSocket 连通性快速预检
  const checkWSAvailability = () => new Promise((resolve) => {
    const testWsPath = asrBackend === 'qwen' ? '/api/meeting/asr/qwen/ws' : '/api/meeting/asr/ws';
    // WebSocket 直连后端（绕过不支持 WS 的外部代理）
    let wsHost = window.location.host;
    if (window.location.protocol === 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      wsHost = '192.168.66.44';
    }
    const testWs = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${wsHost}${testWsPath}?token=${getStoredToken() || ''}&meetingId=ws-check&meetingTitle=test&agenda=test`);
    const done = (ok, reason) => {
      clearTimeout(timer);
      testWs.close();
      resolve({ ok, reason });
    };
    const timer = setTimeout(() => done(false, 'WebSocket 连接超时，可能隧道/防火墙不支持'), 5000);
    testWs.onopen = () => done(true, '');
    testWs.onerror = () => done(false, 'WebSocket 连接被拒绝，检查 SSL 代理是否支持 WS');
  });

  const startSpeechRecognition = () => {
    if (!speechRecognitionCtor) {
      setSpeechStatus('当前浏览器不支持自动转写，可使用手动补录');
      return;
    }
    const recognition = new speechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setSpeechStatus('实时转写中');
    recognition.onerror = event => setSpeechStatus(`转写异常：${event.error || 'unknown'}`);
    recognition.onend = () => {
      if (recordingRef.current) {
        try {
          recognition.start();
        } catch (_) {}
      }
    };
    recognition.onresult = event => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript || '';
        if (result.isFinal) {
          setInterimText('');
          postTranscript(text, true).catch(err => message.error(`转写回传失败：${err.message}`));
        } else {
          interim += text;
        }
      }
      if (interim.trim()) setInterimText(interim.trim());
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (_) {
      setSpeechStatus('实时转写启动失败，可手动补录');
    }
  };

  const startRecording = async () => {
    if (starting) return;
    // P0-12: 防重复 MediaRecorder — 切后台回来可能触发重复 start
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.warn('[REC] MediaRecorder 已在运行，跳过重复创建');
      return;
    }
    setStarting(true);
    try {
      if (!window.isSecureContext) {
        throw new Error('当前是 HTTP 局域网地址，iPhone 浏览器会禁止网页使用麦克风。请使用 HTTPS 链接打开录音页。');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器未开放麦克风能力。请使用 iPhone Safari 的 HTTPS 页面打开，并允许麦克风权限。');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // P0-1: MIME 自动探测（iPhone Safari 不支持 webm）
      const getSupportedMimeType = () => {
        const candidates = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/ogg;codecs=opus',
        ];
        for (const type of candidates) {
          if (typeof MediaRecorder !== 'undefined' &&
              typeof MediaRecorder.isTypeSupported === 'function' &&
              MediaRecorder.isTypeSupported(type)) {
            return type;
          }
        }
        return '';
      };
      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      console.log(`[REC] MediaRecorder MIME: ${recorder.mimeType || 'browser-default'}`);
      audioChunksRef.current = [];
      chunkIndexRef.current = 0;
      recorder.ondataavailable = async event => {
        if (event.data?.size) {
          audioChunksRef.current.push(event.data);
          // 流式上传：每 3 秒上传一次 chunk，避免浏览器内存溢出
          const idx = chunkIndexRef.current++;
          uploadAudioChunk(event.data, idx);
        }
      };
      recorder.start(3000); // 每 3 秒分段，立即上传释放内存
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      recordingStartTimeRef.current = Date.now(); // 记录录音开始时间
      setAudioReady(true);
      setRecording(true);
      setIsPaused(false);
      isPausedRef.current = false;
      setSeconds(0);
      setInterimText('');
      requestWakeLock();
      // 启动重试定时器
      retryTimerRef.current = setInterval(flushRetryQueue, 5000);
      setLatestRecognizedText('');
      setLatestRecognizedAt('');
      setRecordingSummary(null);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = '';
      }
      setSpeechStatus('麦克风已接入，正在检测 WebSocket 连通性...');
      await postSession('start');

      // 先检测 WebSocket 是否可达（诊断隧道/SSL问题）
      const wsCheck = await checkWSAvailability();
      if (!wsCheck.ok) {
        setSpeechStatus(`WebSocket 不可用：${wsCheck.reason}`);
        message.warning(`实时语音识别不可用：${wsCheck.reason}。将使用浏览器内置识别。`);
        startSpeechRecognition();
        return;
      }

      try {
        await startFunAsrRecognition(stream);
        message.success('手机录音已开始，Fun-ASR 实时识别已接入');
      } catch (asrErr) {
        const errMsg = asrErr.message || String(asrErr);
        let diag = '';
        if (!window.isSecureContext) diag = 'HTTPS required for mic';
        else if (errMsg.includes('超时') || errMsg.includes('timeout')) diag = 'tunnel may not support WebSocket';
        else if (errMsg.includes('401')) diag = 'token expired, re-login needed';
        // 浏览器语音识别作为降级方案（Chrome/Safari 均支持中文）
        startSpeechRecognition();
        if (speechRecognitionCtor) {
          setSpeechStatus(`已切换浏览器语音识别（Fun-ASR 不可用：${errMsg}${diag ? ' — ' + diag : ''}）`);
          message.info('使用浏览器内置语音识别，识别结果仍会回传桌面端。');
        } else {
          setSpeechStatus(`语音识别不可用（${errMsg}${diag ? ' — ' + diag : ''}），请使用手动输入。`);
          message.warning('当前浏览器不支持语音识别，请用下方输入框手动补录发言。');
        }
      }
    } catch (err) {
      setAudioReady(false);
      const msg = err.message || String(err);
      if (msg.includes('401') || msg.includes('未登录') || msg.includes('登录')) {
        setSpeechStatus('登录已过期，请刷新页面重新登录');
        message.error('会话过期，正在刷新...');
        window.setTimeout(() => window.location.reload(), 2000);
      } else {
        setSpeechStatus(`启动失败：${msg}`);
        message.error(`无法启动录音：${msg}`);
      }
    } finally {
      setStarting(false);
    }
  };

  const stopRecording = async () => {
    const finalSeconds = seconds;
    const transcriptCount = liveLines.length;
    recognitionRef.current?.stop?.();
    stopFunAsrRecognition();
    const recorder = mediaRecorderRef.current;
    await new Promise(resolve => {
      if (!recorder || recorder.state === 'inactive') {
        resolve();
        return;
      }
      let resolved = false;
      // 等待 stop 后的最后一次 ondataavailable（包含剩余音频数据）
      const origOnData = recorder.ondataavailable;
      recorder.ondataavailable = event => {
        if (event.data?.size) origOnData?.(event);
        if (!resolved) {
          resolved = true;
          window.setTimeout(resolve, 150); // 确保数据写入完成
        }
      };
      try {
        recorder.stop();
      } catch (_) {
        if (!resolved) { resolved = true; resolve(); }
      }
      // 兜底超时
      window.setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 2000);
    });
    // 停止后等待一小段时间，确保所有 ondataavailable 回调完成
    await new Promise(r => setTimeout(r, 200));
    mediaStreamRef.current?.getTracks?.().forEach(track => track.stop());
    const chunks = audioChunksRef.current;
    const audioSize = chunks.reduce((total, item) => total + item.size, 0);
    const audioBlob = chunks.length ? new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }) : null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : '';
    audioUrlRef.current = audioUrl;
    recognitionRef.current = null;
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    setRecording(false);
    setIsPaused(false);
    isPausedRef.current = false;
    setAudioReady(false);
    setInterimText('');
    releaseWakeLock();
    if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }

    // 进入合并状态：显示进度，阻止用户离开
    setIsMerging(true);
    const retryCount = retryQueueRef.current.length;
    setPendingChunks(retryCount);
    setSpeechStatus(`正在上传剩余 ${retryCount} 个音频片段，请勿关闭页面…`);

    // 注册 beforeunload 防止用户离开导致音频丢失
    const beforeUnloadHandler = (e) => {
      e.preventDefault();
      e.returnValue = '音频正在上传中，离开将导致录音丢失！';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    try {
      await flushRetryQueue(); // 最后一次重试，确保所有 chunk 上传完成后再合并
      setPendingChunks(0);
      setSpeechStatus('音频片段上传完成，正在合并音频…');

      // 流式上传模式：chunk 已在录音过程中上传，此处通知后端合并
      const totalChunks = chunkIndexRef.current;
      if (totalChunks > 0) {
        await completeAudioUpload(finalSeconds, totalChunks);
      }
      setSpeechStatus('音频合并完成，正在保存会议记录…');
      await postSession('stop', { audio_size: audioSize, duration_seconds: finalSeconds });
      await loadRecorderHistory({ silent: true });
      await refreshWhisperDocxInfo({ silent: true });

      setRecordingSummary({
        durationSeconds: finalSeconds,
        audioSize,
        audioUrl,
        transcriptCount,
        latestText: latestRecognizedText,
        endedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      });
      if (transcriptCount > 0) {
        setSpeechStatus('录音结束，正在生成 Whisper 终审纪实…');
        message.success('录音会话已结束，音频和转写记录已回传');
      } else {
        setSpeechStatus('录音结束，正在生成可用纪实材料…');
        message.warning('录音已结束，音频已回传；本次没有自动转写文本，可用下方手动补录关键发言');
      }
    } catch (err) {
      message.error(`结束上传失败：${err.message}`);
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      setIsMerging(false);
      setPendingChunks(0);
    }
  };

  // ── 暂停/继续录音 ──
  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      isPausedRef.current = true;
      setIsPaused(true);
      setSpeechStatus('录音已暂停');
      message.info('录音已暂停，继续请点击"继续录音"');
    }
  };
  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      isPausedRef.current = false;
      setIsPaused(false);
      setSpeechStatus('录音中');
      message.success('录音已继续');
    }
  };

  const submitManualText = async () => {
    const text = manualText.trim();
    if (!text) return;
    try {
      await postTranscript(text, true);
      setManualText('');
      message.success('手动补录已回传');
    } catch (err) {
      message.error(`补录失败：${err.message}`);
    }
  };

  const openCorrection = (line) => {
    setEditingLine(line);
    setCorrectionText(line.text || '');
    setSignatureDirty(false);
    window.setTimeout(() => clearSignature(), 0);
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    setSignatureDirty(false);
  };

  const getSignaturePoint = (event) => {
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: ((source.clientX - rect.left) / rect.width) * canvas.width,
      y: ((source.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startSignature = (event) => {
    event.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const point = getSignaturePoint(event);
    const context = canvas.getContext('2d');
    context.beginPath();
    context.moveTo(point.x, point.y);
    signatureDrawingRef.current = true;
  };

  const drawSignature = (event) => {
    if (!signatureDrawingRef.current) return;
    event.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const point = getSignaturePoint(event);
    const context = canvas.getContext('2d');
    context.lineTo(point.x, point.y);
    context.stroke();
    setSignatureDirty(true);
  };

  const stopSignature = () => {
    signatureDrawingRef.current = false;
  };

  const submitCorrectionSignature = async () => {
    if (!editingLine?.transcriptId && !editingLine?.id) {
      message.warning('这条发言还没有后端转写 ID，稍后再试');
      return;
    }
    if (!correctionText.trim()) {
      message.warning('请填写修正后的发言');
      return;
    }
    if (!signatureDirty) {
      message.warning('请在手机上手写签名确认');
      return;
    }
    const canvas = signatureCanvasRef.current;
    let signatureData = canvas.toDataURL('image/png');
    // 签名图片大小检查：超过 600KB 时压缩，超过 800KB 时截断并提示
    const sizeKB = Math.round(signatureData.length * 3 / 4 / 1024);
    if (sizeKB > 600) {
      // 压缩：缩小 canvas 到 50% 再导出
      const tmpCanvas = document.createElement('canvas');
      const scale = Math.min(1, 600 / sizeKB);
      tmpCanvas.width = Math.round(canvas.width * scale);
      tmpCanvas.height = Math.round(canvas.height * scale);
      const ctx = tmpCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
      ctx.drawImage(canvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
      signatureData = tmpCanvas.toDataURL('image/jpeg', 0.8);
      const newKB = Math.round(signatureData.length * 3 / 4 / 1024);
      if (newKB > 800) {
        message.warning(`签名图片较大(${newKB}KB)，已自动压缩。如签名不完整请重新签名。`, 4);
      }
    }
    const transcriptId = editingLine.transcriptId || editingLine.id;
    try {
      const data = await authFetchJson(`/api/meeting/transcripts/${meetingId}/${transcriptId}/correction`, {
        method: 'POST',
        body: JSON.stringify({
          corrected_transcript: correctionText.trim(),
          signature_data: signatureData,
          client_time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        }),
      });
      setLiveLines(prev => prev.map(item => (
        (item.transcriptId || item.id) === transcriptId
          ? {
              ...item,
              text: data.record.transcript,
              originalText: data.record.originalTranscript || item.originalText,
              correctionSigned: true,
              correctionSignedAt: data.record.correctionSignedAt,
            }
          : item
      )));
      setEditingLine(null);
      setCorrectionText('');
      setSignatureDirty(false);
      loadRecorderHistory({ silent: true });
      message.success('本人修正和手写签名已回传');
    } catch (err) {
      message.error(`签字确认失败：${err.message}`);
    }
  };

  const duration = seconds;
  const durationText = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;
  const summaryDurationText = recordingSummary
    ? `${String(Math.floor(recordingSummary.durationSeconds / 60)).padStart(2, '0')}:${String(recordingSummary.durationSeconds % 60).padStart(2, '0')}`
    : '00:00';

  const recorderProgress = recording ? Math.min(98, 26 + seconds * 2) : seconds > 0 ? 100 : 18;

  return (
    <div className="mobile-recorder-page">
      <div className="mobile-recorder-shell">
        <header className="mobile-recorder-top">
          <div>
            <Tag color={recording ? 'processing' : 'blue'} style={{ margin: 0, borderRadius: 999 }}>
              {recording ? '手机录音中' : '手机录音页'}
            </Tag>
            <Title level={3} style={{ margin: '10px 0 0', color: '#0f172a', lineHeight: 1.2 }}>
              {meetingTitle}
            </Title>
            <Text style={{ display: 'block', marginTop: 6, color: '#64748b' }}>{meetingDate} · 本地手动项目</Text>
            <Text style={{ display: 'block', marginTop: 4, color: '#64748b' }}>{projectName} · {agenda}</Text>
          </div>
          <Button shape="circle" icon={<LogoutOutlined />} onClick={onLogout} />
        </header>

        <section className="mobile-recorder-identity">
          <Avatar size={48} icon={<UserOutlined />} style={{ background: '#1d5fd7' }} />
          <div>
            <div className="mobile-recorder-name">{boundRole.name}</div>
            <div className="mobile-recorder-muted">{boundRole.dept} · {boundRole.role}</div>
          </div>
          <Tag color="green" style={{ margin: 0, borderRadius: 999 }}>{boundRole.seat}</Tag>
        </section>

        {/* 当前发言人选择器 — 多人共用一台手机时切换发言人 */}
        <section className="mobile-recorder-card" style={{ marginTop: 0 }}>
          <div className="mobile-recorder-section-title">
            <UserOutlined />
            当前发言人
          </div>
          <div className="mobile-recorder-muted" style={{ marginTop: 6 }}>
            录音时选择正在发言的人。未选择时，转写自动归属当前登录账号“{boundRole.name}”。
          </div>
          <Space size={10} style={{ marginTop: 10, width: '100%' }}>
            <Select
              value={activeSpeakerName || undefined}
              onChange={val => {
                setActiveSpeakerName(val || '');
                if (!val) setActiveSpeakerRole('');
              }}
              placeholder={`使用账号角色：${boundRole.name}`}
              allowClear
              style={{ minWidth: 140, flex: 1 }}
              options={[
                { label: '刘强（主要负责人）', value: '刘强' },
                { label: '陈伟（分管领导）', value: '陈伟' },
                { label: '王磊（纪检监察）', value: '王磊' },
                { label: '王明（议题负责人）', value: '王明' },
                { label: '张敏（会议秘书）', value: '张敏' },
                { label: '李倩（财务部）', value: '李倩' },
              ]}
            />
            {activeSpeakerName && (
              <Select
                value={activeSpeakerRole || '参会代表'}
                onChange={val => setActiveSpeakerRole(val)}
                style={{ width: 120 }}
                options={[
                  { label: '主要负责人', value: '主要负责人' },
                  { label: '分管领导', value: '分管领导' },
                  { label: '议题负责人', value: '议题负责人' },
                  { label: '会议秘书', value: '会议秘书' },
                  { label: '审计监察', value: '审计监察' },
                  { label: '参会代表', value: '参会代表' },
                ]}
              />
            )}
          </Space>
        </section>

        {/* 声纹注册 — 录音前采集当前发言人声纹 */}
        <MobileVoiceprintEnroll
          userId={boundRole.username || currentUser?.username || ''}
          displayName={activeSpeakerName || boundRole.name}
          role={activeSpeakerRole || boundRole.role}
          dept={boundRole.dept}
          palette={{}}
        />

        <section className={recording ? 'mobile-recorder-core is-recording' : 'mobile-recorder-core'}>
          <div className="mobile-recorder-orbit">
            <span />
            <span />
            <div className="mobile-recorder-mic"><AudioOutlined /></div>
          </div>
          <div className="mobile-recorder-time">{durationText}</div>
          <div className="mobile-recorder-wave" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(item => <i key={item} style={{ animationDelay: `${item * 80}ms` }} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            <Button
              type={asrBackend === 'dashscope' ? 'primary' : 'default'}
              size="middle"
              onClick={() => {
                setAsrBackend('dashscope');
                try { localStorage.setItem('ai616_asr_backend', 'dashscope'); } catch (_) {}
              }}
              disabled={recording}
              style={{ borderRadius: 999 }}
            >
              云端识别
            </Button>
            <Button
              type={asrBackend === 'qwen' ? 'primary' : 'default'}
              size="middle"
              onClick={() => {
                setAsrBackend('qwen');
                try { localStorage.setItem('ai616_asr_backend', 'qwen'); } catch (_) {}
              }}
              disabled={true}
              title="本地 Paraformer 质量差，已禁用"
              style={{ borderRadius: 999 }}
            >
              本地识别
            </Button>
          </div>
          <Space size={10} style={{ marginTop: 12 }}>
            <Button
              type="primary"
              size="large"
              icon={<AudioOutlined />}
              onClick={startRecording}
              disabled={recording || starting}
              loading={starting}
              style={{ height: 44, borderRadius: 999, fontWeight: 800 }}
            >
              {starting ? '启动中' : '开始录音'}
            </Button>
            {recording && !isPaused && (
              <Button size="large" onClick={pauseRecording} style={{ height: 44, borderRadius: 999, fontWeight: 800 }}>
                暂停
              </Button>
            )}
            {recording && isPaused && (
              <Button type="primary" size="large" onClick={resumeRecording} style={{ height: 44, borderRadius: 999, fontWeight: 800 }}>
                继续录音
              </Button>
            )}
            <Button
              size="large"
              onClick={stopRecording}
              disabled={!recording || isMerging}
              loading={isMerging}
              style={{ height: 44, borderRadius: 999, fontWeight: 800 }}
            >
              {isMerging ? '正在上传…' : '结束录音'}
            </Button>
            {/* 连接状态指示器 */}
            {recording && !isMerging && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#999' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                  background: connectionStatus === 'connected' ? '#52c41a' : connectionStatus === 'reconnecting' ? '#faad14' : '#ff4d4f',
                }} />
                {connectionStatus === 'connected' ? 'ASR 已连接' : connectionStatus === 'reconnecting' ? 'ASR 重连中...' : 'ASR 未连接'}
              </div>
            )}
            {isMerging && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#faad14' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: '#faad14' }} />
                {pendingChunks > 0 ? `正在上传剩余 ${pendingChunks} 个音频片段…` : '正在合并音频…请勿关闭页面'}
              </div>
            )}
          </Space>
        </section>

        <section className="mobile-recorder-card">
          <div className="mobile-recorder-section-title">
            <AudioOutlined />
            实时转写
          </div>
          <Alert
            type={isMerging ? 'warning' : qwenAsrAvailable || speechRecognitionCtor ? 'success' : 'warning'}
            showIcon
            style={{ marginTop: 12, borderRadius: 12 }}
            message={speechStatus}
            description={isMerging ? '音频正在上传和合并中，关闭或刷新页面将导致本次录音丢失！' : window.isSecureContext ? (qwenAsrAvailable ? (asrBackend === 'qwen' ? '使用本地 SenseVoiceSmall（FunASR），GPU 推理，多语种高准确率，无需联网。' : '使用阿里 DashScope Fun-ASR 云端实时识别，准确率高。') : '当前浏览器没有开放实时音频处理能力，仍可录音并用下方输入框补录关键发言。') : '当前页面是 HTTP 局域网地址，iPhone 会禁止网页麦克风。请改用 HTTPS 链接打开后再开始录音。'}
          />
          {recordingSummary && !recording && (
            <div className={recordingSummary.transcriptCount > 0 ? 'mobile-recorder-result is-ok' : 'mobile-recorder-result is-empty'}>
              <div className="mobile-recorder-section-title">
                {recordingSummary.transcriptCount > 0 ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
                本次录音结果
              </div>
              <div className="mobile-recorder-result-grid">
                <div>
                  <span>录音时长</span>
                  <strong>{summaryDurationText}</strong>
                </div>
                <div>
                  <span>音频大小</span>
                  <strong>{formatBytes(recordingSummary.audioSize)}</strong>
                </div>
                <div>
                  <span>转写条数</span>
                  <strong>{recordingSummary.transcriptCount} 条</strong>
                </div>
              </div>
              {recordingSummary.audioUrl && (
                <audio className="mobile-recorder-audio" controls src={recordingSummary.audioUrl}>
                  <track kind="captions" />
                </audio>
              )}
              {recordingSummary.transcriptCount > 0 ? (
                <div className="mobile-recorder-result-note">
                  转写已按“{boundRole.name} / {boundRole.role}”回传桌面端。识别不准时，可在下方逐条修正并手写签字。
                </div>
              ) : (
                <div className="mobile-recorder-result-note">
                  本次录到了音频，但没有收到自动转写文本。常见原因：没有明显发言、说话时间太短、Fun-ASR 未接入、浏览器识别被系统限制。请在下方补录关键发言，或重新录一段 5 秒以上的测试语音。
                </div>
              )}
            </div>
          )}
          {(recording || interimText || latestRecognizedText) && (
            <div className={interimText ? 'mobile-recorder-interim is-live' : 'mobile-recorder-interim'}>
              <div className="mobile-recorder-muted">
                {interimText ? '正在识别' : latestRecognizedText ? `最新识别 ${latestRecognizedAt}` : '等待发言'}
              </div>
              <div>{interimText || latestRecognizedText || '请靠近手机开始发言，识别结果会保留在这里。'}</div>
            </div>
          )}
          {liveLines.length > 0 && (
            <div className="mobile-recorder-live-list">
              {liveLines.map(line => (
                <div key={line.id} className="mobile-recorder-live-line">
                  <span>{line.time}</span>
                  <strong>{line.text}</strong>
                  <Button
                    size="small"
                    icon={line.correctionSigned ? <CheckCircleOutlined /> : <EditOutlined />}
                    onClick={() => openCorrection(line)}
                    style={{ borderRadius: 999, justifySelf: 'start' }}
                  >
                    {line.correctionSigned ? '已签字' : '修正签字'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {editingLine && (
            <div className="mobile-recorder-sign-panel">
              <div className="mobile-recorder-section-title">
                <SignatureOutlined />
                本人修正与签字确认
              </div>
              <div className="mobile-recorder-muted" style={{ marginTop: 8 }}>
                AI 识别不准时，请修改为本人真实发言，并在下方手写签名。该签名会写入会议证据链。
              </div>
              <TextArea
                value={correctionText}
                onChange={event => setCorrectionText(event.target.value)}
                autoSize={{ minRows: 3, maxRows: 5 }}
                style={{ marginTop: 10 }}
              />
              <canvas
                ref={signatureCanvasRef}
                width={640}
                height={220}
                className="mobile-recorder-sign-canvas"
                onMouseDown={startSignature}
                onMouseMove={drawSignature}
                onMouseUp={stopSignature}
                onMouseLeave={stopSignature}
                onTouchStart={startSignature}
                onTouchMove={drawSignature}
                onTouchEnd={stopSignature}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button onClick={clearSignature}>重签</Button>
                <Button onClick={() => setEditingLine(null)}>取消</Button>
                <Button type="primary" icon={<SignatureOutlined />} onClick={submitCorrectionSignature}>
                  提交修正并签字
                </Button>
              </div>
            </div>
          )}
          <div className="mobile-recorder-manual">
            <TextArea
              value={manualText}
              onChange={event => setManualText(event.target.value)}
              placeholder="自动转写不准时，在这里补录一句关键发言"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
            <Button type="primary" onClick={submitManualText} disabled={!manualText.trim()} style={{ borderRadius: 10, fontWeight: 800 }}>
              回传发言
            </Button>
          </div>
        </section>

        <section className="mobile-recorder-card">
          <div className="mobile-recorder-section-title mobile-recorder-section-title-row">
            <span>
              <ClockCircleOutlined />
              我的本场记录
            </span>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={historyLoading}
              onClick={() => loadRecorderHistory()}
              style={{ borderRadius: 999 }}
            >
              刷新
            </Button>
          </div>
          <div className="mobile-recorder-history-summary">
            <div>
              <span>已回传转写</span>
              <strong>{historyLines.length} 条</strong>
            </div>
            <div>
              <span>录音片段</span>
              <strong>{historyAudios.length} 段</strong>
            </div>
          </div>
          {historyAudios.length > 0 && (
            <div className="mobile-recorder-history-list">
              {historyAudios.map(item => (
                <div key={item.id} className="mobile-recorder-audio-row">
                  <div>
                    <strong>{item.serverTime?.slice(11, 19) || '已上传录音'}</strong>
                    <span>{formatBytes(item.audioSize)} · {item.durationSeconds ? `${item.durationSeconds} 秒` : '时长待确认'}</span>
                  </div>
                  <Button
                    size="small"
                    icon={audioPlaybackUrls[item.id] ? <PlayCircleOutlined /> : <DownloadOutlined />}
                    onClick={() => loadAudioPlayback(item)}
                    style={{ borderRadius: 999 }}
                  >
                    {audioPlaybackUrls[item.id] ? '可回放' : '加载回放'}
                  </Button>
                  {audioPlaybackUrls[item.id] && (
                    <audio className="mobile-recorder-audio" controls src={audioPlaybackUrls[item.id]}>
                      <track kind="captions" />
                    </audio>
                  )}
                </div>
              ))}
            </div>
          )}
          {historyLines.length > 0 ? (
            <div className="mobile-recorder-history-list">
              {historyLines.slice(0, 8).map(line => (
                <div key={line.id} className="mobile-recorder-history-line">
                  <span>{line.time}</span>
                  <strong>{line.text}</strong>
                  <Button
                    size="small"
                    icon={line.correctionSigned ? <CheckCircleOutlined /> : <EditOutlined />}
                    onClick={() => openCorrection(line)}
                    style={{ borderRadius: 999 }}
                  >
                    {line.correctionSigned ? '已签字' : '修正签字'}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mobile-recorder-empty-history">
              这台手机当前账号还没有回传转写。开始录音后，说话内容会自动同步到这里；切出页面再回来，也会从后端重新加载。
            </div>
          )}
        </section>

        <section className="mobile-recorder-card">
          <div className="mobile-recorder-section-title">
            <SafetyCertificateOutlined />
            账号角色绑定
          </div>
          <div className="mobile-recorder-bind-grid">
            {BIND_STEPS.map(([title, desc], index) => {
              const doneByStep = [
                Boolean(currentUser),
                Boolean(boundRole && boundRole.name && boundRole.role),
                audioReady || seconds > 0,
                liveLines.length > 0,
              ];
              const done = doneByStep[index] || false;
              return (
                <div key={title} className="mobile-recorder-bind-row">
                  {done ? <CheckCircleOutlined className="is-ok" /> : <ClockCircleOutlined className="is-wait" />}
                  <div>
                    <div className="mobile-recorder-bind-title">{title}</div>
                    <div className="mobile-recorder-muted">{desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mobile-recorder-card">
          <div className="mobile-recorder-section-title">
            <MobileOutlined />
            回传状态
          </div>
          <div className="mobile-recorder-status-line">
            <span>语音识别状态</span>
            <strong>{recording ? '实时转写中' : seconds > 0 ? '已停止录音' : '待启动'}</strong>
          </div>
          <Progress percent={recorderProgress} size="small" strokeColor="#12805c" />
          <div className="mobile-recorder-muted" style={{ marginTop: 10 }}>
            录音流将以“{boundRole.name} / {boundRole.role} / {boundRole.seat}”写入桌面端声纹分轨，后续用于三重一大终审溯源。
          </div>
          <div className="mobile-recorder-status-block">
            <div className="mobile-recorder-status-line" style={{ marginTop: 10 }}>
              <span>Whisper 纪实</span>
              <strong>{meetingDocxInfo?.status === 'failed' ? '生成失败' : meetingDocxInfo?.status === 'generating' ? '生成中' : meetingDocxInfo?.generatedAt ? '已生成' : recording ? '录制后自动生成' : '待生成'}</strong>
            </div>
            <div className="mobile-recorder-muted" style={{ marginTop: 4 }}>
              {meetingDocxInfo?.status === 'failed'
                ? `生成失败：${docxError || meetingDocxInfo?.error || '未知错误'}`
                : meetingDocxInfo?.generatedAt
                  ? `生成时间：${meetingDocxInfo.generatedAt}`
                  : meetingDocxInfo?.status === 'generating'
                    ? '正在汇总转写与录音，稍后可下载纪实文档。'
                    : '结束录音后，系统会自动汇总转写与录音生成会议纪实。'}
            </div>
            <Space wrap style={{ marginTop: 10 }}>
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                loading={docxDownloading}
                onClick={downloadWhisperDocx}
                disabled={meetingDocxInfo?.status === 'failed' || (!meetingDocxInfo?.path && !meetingDocxInfo?.generatedAt)}
                style={{ borderRadius: 999 }}
              >
                下载纪实
              </Button>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={docxLoading}
                onClick={() => {
                  setDocxLoading(true);
                  refreshWhisperDocxInfo({ silent: false }).finally(() => setDocxLoading(false));
                }}
                style={{ borderRadius: 999 }}
              >
                刷新状态
              </Button>
              {meetingDocxInfo?.status === 'failed' && (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    setDocxLoading(true);
                    refreshWhisperDocxInfo({ silent: false }).finally(() => setDocxLoading(false));
                  }}
                  style={{ borderRadius: 999 }}
                >
                  重新尝试
                </Button>
              )}
            </Space>
          </div>
          <div className="mobile-recorder-muted" style={{ marginTop: 10 }}>
            当前采集接口预留为“{deviceLabel} / {deviceType} / {transport}”，后续可无缝接入 2.4G 无线录音卡或其他麦克风设备。
          </div>
        </section>
      </div>

      <style>{`
        html.mobile-recorder-scroll,
        body.mobile-recorder-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          overscroll-behavior-y: contain;
        }

        body.mobile-recorder-scroll #root,
        #root.mobile-recorder-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }

        .mobile-recorder-page {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100dvh;
          min-height: 100dvh;
          overflow-x: hidden;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-y: contain;
          padding: 14px 14px calc(96px + env(safe-area-inset-bottom));
          box-sizing: border-box;
          touch-action: pan-y;
          background:
            radial-gradient(circle at 50% 0%, rgba(29,95,215,0.16), transparent 34%),
            linear-gradient(180deg, #eef5ff 0%, #f8fafc 56%, #ffffff 100%);
          color: #0f172a;
          letter-spacing: 0;
        }

        .mobile-recorder-shell {
          width: min(100%, 430px);
          margin: 0 auto;
          display: grid;
          gap: 12px;
        }

        .mobile-recorder-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .mobile-recorder-identity,
        .mobile-recorder-card,
        .mobile-recorder-core {
          background: rgba(255,255,255,0.88);
          border: 1px solid rgba(15,23,42,0.07);
          border-radius: 18px;
          box-shadow: 0 16px 34px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .mobile-recorder-identity {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 14px;
        }

        .mobile-recorder-name {
          color: #0f172a;
          font-weight: 900;
          font-size: 16px;
        }

        .mobile-recorder-muted {
          color: #64748b;
          font-size: 12px;
          line-height: 1.55;
        }

        .mobile-recorder-core {
          padding: 22px 16px;
          text-align: center;
        }

        .mobile-recorder-orbit {
          width: 116px;
          height: 116px;
          margin: 0 auto;
          position: relative;
          display: grid;
          place-items: center;
        }

        .mobile-recorder-orbit span {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          border: 1px solid rgba(29,95,215,0.26);
          animation: mobile-recorder-pulse 2.2s ease-in-out infinite;
        }

        .mobile-recorder-orbit span:nth-child(2) {
          inset: 0;
          animation-delay: 420ms;
        }

        .mobile-recorder-mic {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 28px;
          line-height: 1;
          background: conic-gradient(from 120deg, #1d5fd7, #12b3a8, #1d5fd7);
          box-shadow: 0 18px 40px rgba(29,95,215,0.28);
        }
        .mobile-recorder-mic .anticon {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .mobile-recorder-time {
          margin-top: 8px;
          font-size: 34px;
          line-height: 1;
          color: #0f172a;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        .mobile-recorder-wave {
          margin: 18px auto 0;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        .mobile-recorder-wave i {
          width: 5px;
          height: 14px;
          border-radius: 999px;
          background: #1d5fd7;
          opacity: 0.42;
          animation: mobile-recorder-wave 1.1s ease-in-out infinite;
        }

        .mobile-recorder-core.is-recording .mobile-recorder-wave i {
          opacity: 0.92;
        }

        .mobile-recorder-card {
          padding: 14px;
        }

        .mobile-recorder-interim {
          margin-top: 12px;
          padding: 12px;
          border-radius: 12px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #0f172a;
          line-height: 1.7;
          font-size: 16px;
          font-weight: 500;
          min-height: 48px;
        }

        .mobile-recorder-interim.is-live {
          background: #eef6ff;
          border-color: #1d5fd7;
          box-shadow: 0 0 0 3px rgba(29,95,215,0.1);
          animation: interim-pulse 1.5s ease-in-out infinite;
        }
        @keyframes interim-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(29,95,215,0.08); }
          50%      { box-shadow: 0 0 0 6px rgba(29,95,215,0.14); }
        }

        .mobile-recorder-result {
          margin-top: 12px;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
        }

        .mobile-recorder-result.is-empty {
          border-color: #fed7aa;
          background: #fff7ed;
        }

        .mobile-recorder-result-grid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .mobile-recorder-result-grid div {
          min-width: 0;
          padding: 9px 8px;
          border-radius: 12px;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(15,23,42,0.06);
        }

        .mobile-recorder-result-grid span {
          display: block;
          color: #64748b;
          font-size: 11px;
          line-height: 1.2;
        }

        .mobile-recorder-result-grid strong {
          display: block;
          margin-top: 5px;
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mobile-recorder-audio {
          width: 100%;
          margin-top: 12px;
          display: block;
        }

        .mobile-recorder-result-note {
          margin-top: 10px;
          color: #475569;
          font-size: 12px;
          line-height: 1.65;
        }

        .mobile-recorder-manual {
          margin-top: 12px;
          display: grid;
          gap: 8px;
        }

        .mobile-recorder-live-list {
          margin-top: 12px;
          display: grid;
          gap: 8px;
          max-height: 420px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .mobile-recorder-live-line {
          display: grid;
          grid-template-columns: 54px 1fr;
          gap: 8px;
          align-items: start;
          padding: 10px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .mobile-recorder-live-line span {
          color: #64748b;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .mobile-recorder-live-line strong {
          color: #0f172a;
          font-size: 13px;
          line-height: 1.6;
        }

        .mobile-recorder-live-line .ant-btn {
          grid-column: 2;
          width: fit-content;
        }

        .mobile-recorder-sign-panel {
          margin-top: 12px;
          padding: 12px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1px solid #dbe4ef;
        }

        .mobile-recorder-sign-canvas {
          width: 100%;
          height: 132px;
          margin-top: 10px;
          display: block;
          border-radius: 12px;
          border: 1px dashed #94a3b8;
          background: #ffffff;
          touch-action: none;
        }

        .mobile-recorder-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #0f172a;
          font-weight: 900;
        }

        .mobile-recorder-section-title-row {
          justify-content: space-between;
        }

        .mobile-recorder-section-title-row span {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .mobile-recorder-history-summary {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .mobile-recorder-history-summary div {
          min-width: 0;
          padding: 10px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .mobile-recorder-history-summary span {
          display: block;
          color: #64748b;
          font-size: 11px;
        }

        .mobile-recorder-history-summary strong {
          display: block;
          margin-top: 4px;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        .mobile-recorder-history-list {
          margin-top: 10px;
          display: grid;
          gap: 8px;
        }

        .mobile-recorder-history-line,
        .mobile-recorder-audio-row {
          min-width: 0;
          display: grid;
          gap: 8px;
          padding: 10px;
          border-radius: 12px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
        }

        .mobile-recorder-history-line {
          grid-template-columns: 62px minmax(0, 1fr);
          align-items: start;
        }

        .mobile-recorder-history-line span {
          color: #64748b;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .mobile-recorder-history-line strong {
          min-width: 0;
          color: #0f172a;
          font-size: 13px;
          line-height: 1.6;
          word-break: break-word;
        }

        .mobile-recorder-history-line .ant-btn {
          grid-column: 2;
          width: fit-content;
        }

        .mobile-recorder-audio-row {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
        }

        .mobile-recorder-audio-row strong,
        .mobile-recorder-audio-row span {
          display: block;
        }

        .mobile-recorder-audio-row strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
        }

        .mobile-recorder-audio-row span {
          margin-top: 2px;
          color: #64748b;
          font-size: 12px;
        }

        .mobile-recorder-audio-row audio {
          grid-column: 1 / -1;
        }

        .mobile-recorder-empty-history {
          margin-top: 10px;
          padding: 12px;
          border-radius: 12px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.65;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
        }

        .mobile-recorder-bind-grid {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }

        .mobile-recorder-bind-row {
          display: grid;
          grid-template-columns: 22px 1fr;
          gap: 9px;
          align-items: start;
          padding: 10px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .mobile-recorder-bind-title {
          font-weight: 900;
          color: #0f172a;
        }

        .mobile-recorder-status-block {
          margin-top: 8px;
          padding-top: 10px;
          border-top: 1px dashed #dbe4ef;
        }

        .mobile-recorder-status-line {
          margin-top: 12px;
          display: flex;
          justify-content: space-between;
          color: #475569;
        }

        .mobile-recorder-status-line strong,
        .is-ok {
          color: #12805c;
        }

        .is-wait {
          color: #b45309;
        }

        @keyframes mobile-recorder-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.32; }
          50% { transform: scale(1.12); opacity: 0.86; }
        }

        @keyframes mobile-recorder-wave {
          0%, 100% { transform: scaleY(0.6); }
          50% { transform: scaleY(1.8); }
        }
      `}</style>
    </div>
  );
}
