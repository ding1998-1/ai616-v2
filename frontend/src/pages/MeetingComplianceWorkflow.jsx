import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Popconfirm, Progress, QRCode, Select, Skeleton, Space, Spin, Tag, Timeline, Typography, message } from 'antd';
import {
  AudioOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  LinkOutlined,
  MessageOutlined,
  MobileOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SendOutlined,
  ShareAltOutlined,
  SignatureOutlined,
  SyncOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { authFetch, authFetchJson, getStoredToken } from '../lib/auth';
import { Typography as ArcoTypography } from '@arco-design/web-react';
import "./MeetingComplianceWorkflow.css";

const { Text, Title, Paragraph } = Typography;
const { Paragraph: ArcoParagraph } = ArcoTypography;

const MEETING_TYPE_OPTIONS = ['普通企业会议', '经营例会', '董事会', '总经理办公会', '专题会', '党委会', '党组会'];

const STAGES = [
  { key: 'collect', no: '01', title: '议题确认', desc: '收问题、成议题、绑项目' },
  { key: 'meeting', no: '02', title: '会中采集与校对', desc: '录音、认人、标事件' },
  { key: 'audit', no: '03', title: '会后终审', desc: '材料核验、合规拦截' },
  { key: 'archive', no: '04', title: '公文归档', desc: '纪要、签署、防伪归档' },
];

const FEISHU_STYLE_CAPS = [
  ['会中实时总结', '边开会边沉淀阶段结论'],
  ['章节纪要', '按议题自动切分章节'],
  ['待办提炼', '责任人、事项、截止时间'],
  ['原文溯源', '点击回到声纹和音频片段'],
];

const ISSUE_IMPORT_STEPS = [
  '读取 Excel 台账',
  'DeepSeek 梳理开会待办',
  '判断议题类型与风险',
  '生成待办议题并写入会议',
];

function MeetingAudioPlayer({ playbackUrl, audioRef, onSeek }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const localRef = useRef(null);

  useEffect(() => {
    if (!playbackUrl) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    fetch(playbackUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); })
      .then(blob => { if (!cancelled) { setBlobUrl(URL.createObjectURL(blob)); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [playbackUrl]);

  // 暴露 seekTo 方法给父组件
  useEffect(() => {
    if (audioRef) {
      audioRef.current = {
        seekTo: (seconds) => {
          const el = localRef.current;
          if (el) { el.currentTime = seconds; el.play(); }
        },
        getElement: () => localRef.current,
      };
    }
  }, [audioRef, blobUrl]);

  if (error) return <div style={{ color: '#c24135', fontSize: 12 }}>加载失败：{error}</div>;
  if (loading) return <div style={{ color: '#64748b', fontSize: 12 }}>加载中...</div>;
  if (!blobUrl) return null;
  return <audio ref={localRef} controls preload="metadata" src={blobUrl} style={{ width: '100%' }} />;
}

function MeetingAiPulse({ active }) {
  return (
    <div
      className={`meeting-ai-core ${active ? 'is-active' : ''}`}
      aria-hidden="true"
      style={{ width: 72, height: 72, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', isolation: 'isolate' }}
    >
      <span className="meeting-ai-ring meeting-ai-ring-one" style={{ position: 'absolute', inset: 5, borderRadius: '50%', border: '1px solid rgba(29, 95, 215, 0.3)' }} />
      <span className="meeting-ai-ring meeting-ai-ring-two" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(29, 95, 215, 0.3)', opacity: 0.56 }} />
      <img
        className="meeting-ai-orb-media"
        src="/voice-ai-orb-transparent.webp"
        alt=""
        draggable={false}
        style={{ width: 86, height: 86, objectFit: 'contain', pointerEvents: 'none', userSelect: 'none', filter: 'drop-shadow(0 12px 22px rgba(29,95,215,0.18))', zIndex: 2 }}
      />
    </div>
  );
}

function StatusPill({ children, color = 'blue' }) {
  const tones = {
    blue: { bg: 'var(--ui-primary-soft)', text: 'var(--ui-primary)', border: 'rgba(22, 93, 255, 0.16)' },
    processing: { bg: 'var(--ui-primary-soft)', text: 'var(--ui-primary)', border: 'rgba(22, 93, 255, 0.16)' },
    cyan: { bg: '#E8FFFB', text: '#14C9C9', border: 'rgba(20, 201, 201, 0.18)' },
    green: { bg: '#E8FFEA', text: 'var(--ui-success)', border: 'rgba(0, 180, 42, 0.18)' },
    orange: { bg: '#FFF7E8', text: 'var(--ui-warning)', border: 'rgba(255, 125, 0, 0.18)' },
    gold: { bg: '#FFF7E8', text: 'var(--ui-warning)', border: 'rgba(255, 125, 0, 0.18)' },
    red: { bg: '#FFECE8', text: 'var(--ui-danger)', border: 'rgba(245, 63, 63, 0.18)' },
    default: { bg: 'var(--ui-fill-1)', text: 'var(--ui-text-2)', border: 'var(--ui-border-2)' },
  };
  const tone = tones[color] || tones.default;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: '22px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function createLocalMeetingId() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  return `meeting-local-${stamp}`;
}

function createLocalTimestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function createLocalDate() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function inferMeetingMode(record) {
  const rawMode = record.meetingMode || record.meeting_mode || '';
  if (rawMode === 'normal') return 'normal';
  const joined = [
    record.title,
    record.project,
    record.agenda,
    ...(Array.isArray(record.agendaDrafts) ? record.agendaDrafts.flatMap(item => [item.title, item.type, item.risk, item.todoText, item.source]) : []),
    ...(Array.isArray(record.materials) ? record.materials.map(item => item.name || item.fileName || '') : []),
  ].filter(Boolean).join(' ');
  const hasMajorSignal = /三重一大|重大项目|大额度|重大事项|重要人事|任免|干部|预算|资金|合同|采购|改造|材料缺口|可研|法务|金额/.test(joined);
  return rawMode === 'major' && hasMajorSignal ? 'major' : 'normal';
}

function normalizeMeetingRecord(record) {
  return {
    id: record.id,
    title: record.title || '未命名 AI 会议',
    project: record.project || '本次会议',
    projectCode: record.projectCode || record.project_code || '',
    agenda: record.agenda || '待确认议题',
    date: record.date || createLocalDate(),
    type: record.type || '普通企业会议',
    meetingMode: inferMeetingMode(record),
    creator: record.creator || '当前用户',
    createdAt: record.createdAt || record.created_at || createLocalTimestamp(),
    updatedAt: record.updatedAt || record.updated_at || '',
    phase: record.phase || '问题收集中',
    statusColor: record.statusColor || 'default',
    issueCount: record.issueCount || record.issue_count || Math.max(1, record.agendaDrafts?.length || record.issueSources?.length || 0),
    projectBound: Boolean(record.projectBound),
    agendaFrozen: Boolean(record.agendaFrozen),
    reviewDone: Boolean(record.reviewDone),
    archiveDone: Boolean(record.archiveDone),
  };
}

function deriveIssueDraftsFromSources(meeting) {
  const sources = Array.isArray(meeting?.issueSources) ? meeting.issueSources : [];
  if (!sources.length) return [];
  const joined = sources.map(item => item.content || '').join('\n');
  const project = meeting?.project || '本地事项';
  const agenda = meeting?.agenda && meeting.agenda !== '待梳理议题'
    ? meeting.agenda
    : (sources[sources.length - 1]?.content || '待讨论事项').replace(/^问题描述：/, '').split(/[；;]/)[0].slice(0, 32);
  const isNormalMeeting = (meeting?.meetingMode || meeting?.meeting_mode) === 'normal';
  const isMajorLike = !isNormalMeeting && /预算|资金|合同|采购|改造|追加|重大|金额|法务|材料/.test(joined);
  return [{
    id: 'issue-001',
    title: agenda || '待讨论事项',
    source: `${sources.length} 条外部提交`,
    project,
    type: isMajorLike ? '重大项目安排 / 大额度资金运作' : '普通会议议题',
    risk: isMajorLike ? '高风险' : '普通',
    status: '待确认',
    todoText: isMajorLike ? '补材料、定责任人、安排会议审议' : '确认讨论范围，安排会议讨论',
    changes: [
      `${sources[0]?.time || '--:--'} 首次收集问题`,
      `${sources[sources.length - 1]?.time || '--:--'} 最新补充进入议题池`,
      '外部收集链接自动同步',
    ],
  }];
}

function parseIssueMeta(meta) {
  if (!meta) return { label: '', attachments: [] };
  if (typeof meta === 'object') {
    return {
      label: String(meta.label || meta.category || '').trim(),
      attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
    };
  }
  try {
    const parsed = JSON.parse(meta);
    return {
      label: String(parsed.label || parsed.category || '').trim(),
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return { label: String(meta || '').trim(), attachments: [] };
  }
}

function groupIssueSourcesByPerson(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const name = item.name || '未知填报人';
    if (!map.has(name)) {
      map.set(name, {
        key: name,
        name,
        items: [],
        latestTime: item.time || item.serverTime || '--:--',
        firstIndex: index,
      });
    }
    const group = map.get(name);
    group.items.push(item);
    group.latestTime = item.time || item.serverTime || group.latestTime;
  });
  return Array.from(map.values()).sort((a, b) => b.firstIndex - a.firstIndex);
}

/* ═══ 声纹注册组件 ═══ */
function VoiceprintEnrollSection({ palette, isDarkMode, currentUserName, currentUserRole, currentUserDept, participants }) {
  const [profiles, setProfiles] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState(null); // { userId, displayName, role, dept }
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [engineReady, setEngineReady] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const progressRef = useRef(null);

  // 加载声纹状态和已有配置
  useEffect(() => {
    authFetchJson('/api/voiceprint/status').then(data => {
      setEngineReady(data?.ready || false);
    }).catch(() => {});
    authFetchJson('/api/voiceprint/profiles').then(data => {
      if (Array.isArray(data)) setProfiles(data);
    }).catch(() => {});
  }, []);

  const enrolledUserIds = new Set(profiles.map(p => p.user_id));

  // 录制声纹
  const startEnroll = async (userId, displayName, role, dept) => {
    setEnrollTarget({ userId, displayName, role, dept });
    setEnrolling(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err) {
      message.error('麦克风访问失败：' + err.message);
      setEnrolling(false);
    }
  };

  const stopEnroll = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        setUploadProgress(0);
        let pct = 0;
        progressRef.current = setInterval(() => {
          pct = Math.min(pct + 2, 95);
          setUploadProgress(pct);
        }, 60);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob, 'voiceprint.webm');
        formData.append('user_id', enrollTarget.userId);
        formData.append('display_name', enrollTarget.displayName);
        formData.append('role', enrollTarget.role);
        formData.append('dept', enrollTarget.dept);
        try {
          const resp = await authFetch('/api/voiceprint/enroll', { method: 'POST', body: formData });
          const data = await resp.json();
          if (data.ok) {
            message.success(`声纹注册成功：${enrollTarget.displayName}（第 ${data.sample_count} 次采样）`);
            const profiles = await authFetchJson('/api/voiceprint/profiles');
            if (Array.isArray(profiles)) setProfiles(profiles);
          } else {
            message.error(data.detail || '注册失败');
          }
        } catch (err) {
          message.error('上传失败：' + err.message);
        }
        if (progressRef.current) clearInterval(progressRef.current);
        setUploadProgress(100);
        stream.getTracks().forEach(t => t.stop());
        setTimeout(() => { setEnrolling(false); setEnrollTarget(null); setUploadProgress(0); }, 600);
        resolve();
      };
      recorder.stop();
    });
  };

  const deleteProfile = async (profileId) => {
    try {
      await authFetch(`/api/voiceprint/profiles/${profileId}`, { method: 'DELETE' });
      setProfiles(prev => prev.filter(p => p.id !== profileId));
      message.success('声纹已删除');
    } catch (err) {
      message.error('删除失败');
    }
  };

  // 构建参会人列表（当前用户 + 远程参会人）
  const allParticipants = [
    { userId: currentUserName, displayName: currentUserName, role: currentUserRole, dept: currentUserDept },
    ...(participants || []).map(p => ({
      userId: p.username || p.speaker,
      displayName: p.speaker || p.displayName || p.username,
      role: p.role || '',
      dept: p.dept || '',
    })),
  ].filter(p => p.userId);

  return (
    <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text strong style={{ color: palette.ink }}>🎤 声纹注册</Text>
        <StatusPill color={engineReady ? 'green' : 'default'}>
          {engineReady ? '引擎就绪' : '未配置'}
        </StatusPill>
      </div>
      {!engineReady && (
        <div style={{ padding: 10, borderRadius: 8, background: isDarkMode ? '#1a1a2e' : '#fef3c7', border: `1px solid ${isDarkMode ? '#4a4a4a' : '#f59e0b'}`, color: isDarkMode ? '#fbbf24' : '#92400e', fontSize: 12, marginBottom: 10 }}>
          声纹引擎未初始化。请检查后端日志。
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {allParticipants.map(p => {
          const isEnrolled = enrolledUserIds.has(p.userId);
          const profile = profiles.find(pr => pr.user_id === p.userId);
          const isCurrentEnrolling = enrolling && enrollTarget?.userId === p.userId;
          return (
            <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
              <div style={{ flex: 1 }}>
                <Text strong style={{ color: palette.ink, fontSize: 13 }}>{p.displayName}</Text>
                <Text style={{ color: palette.muted, fontSize: 11, marginLeft: 8 }}>{p.role}</Text>
              </div>
              {isEnrolled ? (
                <Space size={4}>
                  <Tag color="green" style={{ margin: 0 }}>已注册 · {profile.sample_count}次</Tag>
                  <Button size="small" type="link" onClick={() => deleteProfile(profile.id)}>删除</Button>
                </Space>
              ) : isCurrentEnrolling ? (
                <Space size={8}>
                  <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 13 }}>
                    ● 录制中 {recordSeconds}s
                  </span>
                  <Button size="small" danger onClick={stopEnroll}>停止</Button>
                </Space>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  disabled={!engineReady || enrolling}
                  onClick={() => startEnroll(p.userId, p.displayName, p.role, p.dept)}
                >
                  录制声纹
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {recording && (
        <div style={{
          marginTop: 10, padding: '12px 14px', borderRadius: 8,
          background: isDarkMode ? '#2a1a1a' : '#fef2f2',
          border: `1px solid ${isDarkMode ? '#5a2a2a' : '#fecaca'}`,
          fontSize: 14, lineHeight: 1.8, color: palette.ink,
          fontWeight: 500, letterSpacing: '0.02em',
        }}>
          请让 <strong>{enrollTarget?.displayName}</strong> 朗读以下内容：<br />
          <span style={{ color: '#ef4444' }}>
            各位领导好，我是今天的参会代表。本次会议主要讨论公司年度经营计划和重点项目推进情况。我们需要认真审议每一项议题，确保决策合规、程序规范。
          </span>
        </div>
      )}
      {enrolling && !recording && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: palette.blue, fontSize: 12, fontWeight: 500 }}>正在提取声纹特征...</span>
            <span style={{ color: palette.muted, fontSize: 11 }}>{uploadProgress}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: isDarkMode ? '#1e3a5f' : '#e5e7eb', overflow: 'hidden' }}>
            <div style={{
              width: `${uploadProgress}%`, height: '100%', borderRadius: 3,
              background: uploadProgress >= 100 ? '#22c55e' : '#3b82f6',
              transition: 'width 0.15s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function MeetingComplianceWorkflow({ isDarkMode = false, currentUser = null }) {
  const initialSearchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const directCollectEntry = initialSearchParams.get('collect') === '1';
  const [meetingWorkspaceOpen, setMeetingWorkspaceOpen] = useState(directCollectEntry);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [meetingRecords, setMeetingRecords] = useState([]);
  const [transcriptTab, setTranscriptTab] = useState('chronicle'); // chronicle | minutes | todos
  const [manualTodos, setManualTodos] = useState([]);  // 手动添加的待办
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoOwner, setNewTodoOwner] = useState('');
  const [newTodoDeadline, setNewTodoDeadline] = useState('');
  const [manualAgendaItems, setManualAgendaItems] = useState([]);  // 手动议题
  const [newAgendaInput, setNewAgendaInput] = useState('');
  const [meetingCreated, setMeetingCreated] = useState(false);
  const [currentMeetingId, setCurrentMeetingId] = useState(() => initialSearchParams.get('meetingId') || (directCollectEntry ? createLocalMeetingId() : ''));
  const [projectName, setProjectName] = useState(initialSearchParams.get('project') || '');
  const [projectCode, setProjectCode] = useState(initialSearchParams.get('projectCode') || '');
  const [meetingDate, setMeetingDate] = useState(initialSearchParams.get('date') || '');
  const [meetingTitle, setMeetingTitle] = useState(initialSearchParams.get('meeting') || '');
  const [meetingOrg, setMeetingOrg] = useState('普通企业会议');
  const [meetingMode, setMeetingMode] = useState(initialSearchParams.get('mode') === 'major' ? 'major' : 'normal');
  const [agendaTitle, setAgendaTitle] = useState(initialSearchParams.get('agenda') || '');
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [selectedIssueIds, setSelectedIssueIds] = useState([]);
  const [agendaGenerated, setAgendaGenerated] = useState(false);
  const [activeStage, setActiveStage] = useState('collect');
  const [chatMessages, setChatMessages] = useState([]);
  const [agendaDrafts, setAgendaDrafts] = useState([]);
  const [agendaEditModal, setAgendaEditModal] = useState({ open: false, mode: 'list', item: null });
  const [agendaEditForm, setAgendaEditForm] = useState({ title: '', type: '普通', durationMinutes: 15 });
  const [meetingMaterials, setMeetingMaterials] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [expandedIssueGroups, setExpandedIssueGroups] = useState({});
  const [issueImagePreview, setIssueImagePreview] = useState(null);
  const [issueSourceDetailGroup, setIssueSourceDetailGroup] = useState(null);
  const [materialUploading, setMaterialUploading] = useState('');
  const [issueImportStatus, setIssueImportStatus] = useState({
    running: false,
    fileName: '',
    step: 0,
    importedCount: 0,
  });
  const [agendaGenerating, setAgendaGenerating] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingDataReady, setMeetingDataReady] = useState(false);
  const [projectBound, setProjectBound] = useState(false);
  const [agendaFrozen, setAgendaFrozen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [archiveDone, setArchiveDone] = useState(false);
  const [minuteView, setMinuteView] = useState('summary');
  const [recorderInviteOpen, setRecorderInviteOpen] = useState(false);
  const [externalShareOrigin, setExternalShareOrigin] = useState('');
  const [meetingActionType, setMeetingActionType] = useState('');
  const [remoteEvents, setRemoteEvents] = useState([]);
  const [remoteTranscripts, setRemoteTranscripts] = useState([]);
  const [transcriptUpdatedAt, setTranscriptUpdatedAt] = useState('');
  const [activeMeetingAgendaId, setActiveMeetingAgendaId] = useState('');
  const [meetingAgendaMarkers, setMeetingAgendaMarkers] = useState({});
  const [agendaRealtimeChecks, setAgendaRealtimeChecks] = useState({});
  const [agendaRealtimeProvider, setAgendaRealtimeProvider] = useState('');
  const [agendaRealtimeLoading, setAgendaRealtimeLoading] = useState(false);
  const [meetingElapsedText, setMeetingElapsedText] = useState('00:00:00');
  const [agendaTimerActive, setAgendaTimerActive] = useState(false);
  const [agendaTimerSeconds, setAgendaTimerSeconds] = useState(0);
  const [realtimeTodos, setRealtimeTodos] = useState([]);
  const [realtimeTodosLoading, setRealtimeTodosLoading] = useState(false);
  const lastTodoExtractCountRef = useRef(0); // 上次提取时的转写条数
  const agendaTimerRef = useRef(null);
  const [meetingGeneratedRecords, setMeetingGeneratedRecords] = useState(null);
  const [meetingRecordsLoading, setMeetingRecordsLoading] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState('idle'); // idle | running | done | failed
  const [meetingMarkers, setMeetingMarkers] = useState([]);
  const [editingRecords, setEditingRecords] = useState(false);
  const [editedRecords, setEditedRecords] = useState(null);
  const [savingRecords, setSavingRecords] = useState(false);
  const [meetingFilterStage, setMeetingFilterStage] = useState('');
  const [meetingFilterMode, setMeetingFilterMode] = useState('');
  const [meetingFilterSearch, setMeetingFilterSearch] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [speakerEditingId, setSpeakerEditingId] = useState(null);
  const [speakerEditName, setSpeakerEditName] = useState('');
  const [speakerEditRole, setSpeakerEditRole] = useState('');
  const [pendingMarkerTranscriptIndex, setPendingMarkerTranscriptIndex] = useState(0);
  const [archiveGenerating, setArchiveGenerating] = useState(false);
  const [agendaExpandOpen, setAgendaExpandOpen] = useState(false);
  const recordingStartedAtRef = useRef(null);
  const audioPlayerRef = useRef(null); // 音频播放器引用，用于转写联动
  const transcriptScrollRef = useRef(null);
  const transcriptBottomRef = useRef(null);

  // 新转写到达时自动滚动到顶部（最新消息在最上面）
  useEffect(() => {
    const doScroll = () => {
      const el = transcriptScrollRef.current;
      if (el) {
        el.scrollTop = 0;
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }, [transcriptUpdatedAt]);

  const isDemoMeeting = false; // 已移除 demo 数据，所有数据来自 API
  const currentUserName = currentUser?.name || '系统管理员';
  const currentUserDept = currentUser?.dept || '信息管理中心';
  const currentUserMeetingRole = currentUser?.meetingRole || (currentUser?.role === 'admin' ? '会议管理员' : '参会代表');

  // ── 音频处理工具（与手机端一致的 16kHz int16 PCM 转换）──────────────
  const TARGET_SAMPLE_RATE = 16000;
  const concatFloat32 = (a, b) => {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  };
  const downsampleTo16k = (buffer, inputSampleRate) => {
    if (inputSampleRate === TARGET_SAMPLE_RATE) return buffer;
    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const newLength = Math.max(1, Math.round(buffer.length / ratio));
    const result = new Float32Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i]; count += 1;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult += 1; offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };
  const floatToPcm16 = (float32Array) => {
    const output = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(output);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return output;
  };

  // ── 桌面麦克风采集 + Qwen3-ASR 实时识别 ──────────────────────────────
  const micStreamRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micWsRef = useRef(null);
  const micProcessorRef = useRef(null);
  const micMediaRecorderRef = useRef(null);
  const micAudioChunksRef = useRef([]);
  const micChunkIndexRef = useRef(0); // 流式上传 chunk 序号

  // 流式上传单个录音 chunk（每 3 秒调用一次，避免浏览器内存溢出）
  const uploadMicAudioChunk = async (blob, index) => {
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('meeting_id', currentMeetingId);
      form.append('chunk_index', String(index));
      form.append('file', blob, `chunk_${index}.webm`);
      const resp = await fetch('/api/meeting/recorder/audio/chunk', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) console.warn(`Chunk ${index} 上传失败: HTTP ${resp.status}`);
    } catch (e) {
      console.warn(`Chunk ${index} 上传异常:`, e);
    }
  };

  // 录音完成后通知后端合并所有 chunk
  const completeMicAudioUpload = async (durationSeconds, totalChunks) => {
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('meeting_id', currentMeetingId);
      form.append('meeting_title', currentMeetingTitle || '');
      form.append('agenda', '');
      form.append('duration_seconds', String(durationSeconds || 0));
      form.append('total_chunks', String(totalChunks));
      // 传录音开始时间，用于 Whisper 时间戳对齐会议时间轴
      if (recordingStartedAtRef.current) {
        form.append('recording_start_time', new Date(recordingStartedAtRef.current).toISOString());
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

  const uploadDesktopAudio = async () => {
    const chunks = micAudioChunksRef.current;
    if (!chunks || !chunks.length) return null;
    const audioBlob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    if (!audioBlob.size) return null;
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('meeting_id', currentMeetingId);
      form.append('meeting_title', currentMeetingTitle || '');
      form.append('agenda', '');
      form.append('duration_seconds', '0');
      form.append('file', audioBlob, `${currentMeetingId}-${Date.now()}.webm`);
      const resp = await fetch('/api/meeting/recorder/audio', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) {
        console.warn('桌面录音上传失败:', resp.status);
        return null;
      }
      return await resp.json();
    } catch (e) {
      console.warn('桌面录音上传异常:', e);
      return null;
    }
  };

  const postDesktopSession = async (action) => {
    try {
      const token = getStoredToken();
      await fetch('/api/meeting/recorder/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ meeting_id: currentMeetingId, meeting_title: currentMeetingTitle || '', agenda: '', action }),
      });
    } catch (_) {}
  };

  const stopAndUploadDesktopAudio = async () => {
    const recorder = micMediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (_) {}
    }
    micMediaRecorderRef.current = null;
    // 等一小段时间让 ondataavailable 触发
    await new Promise(r => setTimeout(r, 500));
    // 流式上传模式：chunk 已在录音过程中上传，此处通知后端合并
    const totalChunks = micChunkIndexRef.current;
    if (totalChunks > 0) {
      await completeMicAudioUpload(0, totalChunks);
    }
    micAudioChunksRef.current = [];
    await postDesktopSession('stop');
  };

  useEffect(() => {
    if (!recording) {
      if (micProcessorRef.current) { micProcessorRef.current.disconnect(); micProcessorRef.current = null; }
      if (micAudioCtxRef.current) { micAudioCtxRef.current.close(); micAudioCtxRef.current = null; }
      if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
      if (micWsRef.current) { micWsRef.current.close(); micWsRef.current = null; }
      return;
    }

    let stopped = false;
    let ws = null;

    const startMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        micStreamRef.current = stream;

        // MediaRecorder 录音兜底（Whisper 终审用）— 流式上传避免内存溢出
        try {
          const recorder = new MediaRecorder(stream);
          micAudioChunksRef.current = [];
          micChunkIndexRef.current = 0;
          recorder.ondataavailable = async e => {
            if (e.data?.size) {
              micAudioChunksRef.current.push(e.data);
              const idx = micChunkIndexRef.current++;
              uploadMicAudioChunk(e.data, idx);
            }
          };
          recorder.start(3000); // 每 3 秒分段，立即上传释放内存
          micMediaRecorderRef.current = recorder;
        } catch (recErr) {
          console.warn('MediaRecorder 启动失败（不影响实时ASR）:', recErr);
        }

        const token = getStoredToken();
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/meeting/asr/qwen/ws?token=${encodeURIComponent(token)}&meetingId=${encodeURIComponent(currentMeetingId)}`;
        ws = new WebSocket(wsUrl);
        micWsRef.current = ws;
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          if (stopped) { ws.close(); return; }
          message.success('桌面麦克风已接入 Qwen3-ASR');
        };

        ws.onmessage = (event) => {
          if (stopped) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'interim') {
              // 桌面麦克风 interim — 仅预览，不入库
              const text = String(payload.text || '').trim();
              if (text) setDesktopMicInterim(text);
              return;
            }
            const handleAsrText = (newText, fullText, vpInfo) => {
              const text = String(newText || '').trim();
              if (!text) return;
              const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const tempId = `desktop-mic-${Date.now()}-${Math.random()}`;
              // 声纹识别结果（如有）
              const voiceprintFields = vpInfo && vpInfo.speaker_name
                ? { speaker_name: vpInfo.speaker_name, speaker_confidence: vpInfo.speaker_confidence, identified_by: vpInfo.identified_by || 'voiceprint-realtime' }
                : {};
              setRemoteTranscripts(prev => [...prev, {
                id: tempId,
                speakerName: voiceprintFields.speaker_name || currentUserName,
                speakerRole: currentUserMeetingRole,
                transcript: text,
                clientTime: now,
                serverTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
                isFinal: true,
                source: 'desktop-mic',
                speakerConfidence: voiceprintFields.speaker_confidence || 0,
                identifiedBy: voiceprintFields.identified_by || 'manual',
              }].slice(-500));
              authFetchJson('/api/meeting/transcripts/chunk', {
                method: 'POST',
                body: JSON.stringify({
                  meeting_id: currentMeetingId, transcript: text, is_final: true, client_time: now,
                  speaker_name: voiceprintFields.speaker_name || currentUserName,
                  speaker_role: currentUserMeetingRole,
                  ...voiceprintFields,
                }),
              }).then(data => {
                const serverId = data?.record?.id;
                if (serverId) {
                  setRemoteTranscripts(prev => {
                    const serverEntryExists = prev.some(item => item.id === serverId);
                    if (serverEntryExists) {
                      return prev.filter(item => item.id !== tempId);
                    }
                    return prev.map(item =>
                      item.id === tempId ? { ...item, id: serverId } : item
                    );
                  });
                }
              }).catch(() => {});
            };
            if (payload.type === 'final' && payload.newText) {
              // 新协议：newText 是不重叠后缀，直接提交
              const vpInfo = payload.speaker_name ? {
                speaker_name: payload.speaker_name,
                speaker_confidence: payload.speaker_confidence,
                identified_by: payload.identified_by,
              } : null;
              handleAsrText(payload.newText, payload.fullText, vpInfo);
            } else if (payload.type === 'result' && payload.text) {
              // 兼容旧协议
              const vpInfo = payload.speaker_name ? {
                speaker_name: payload.speaker_name,
                speaker_confidence: payload.speaker_confidence,
                identified_by: payload.identified_by,
              } : null;
              handleAsrText(payload.text, payload.text, vpInfo);
            } else if (payload.type === 'error') {
              message.warning(`ASR: ${payload.message}`);
            }
          } catch (_) {}
        };

        ws.onerror = () => { if (!stopped) message.warning('麦克风 WebSocket 异常'); };
        ws.onclose = () => { if (!stopped) message.info('麦克风 ASR 已断开'); };

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        micAudioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 2.5; // 放大 2.5 倍，提升小声录音的 ASR 识别率
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        micProcessorRef.current = processor;
        // 积累 1 秒音频再发送，避免过多小 chunk 导致 429
        let audioBuf = new Float32Array(0);
        const CHUNK_SAMPLES = 16000; // 1 秒 @ 16kHz

        processor.onaudioprocess = (e) => {
          if (stopped || ws?.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const downsampled = downsampleTo16k(input, audioCtx.sampleRate);
          audioBuf = concatFloat32(audioBuf, downsampled);
          while (audioBuf.length >= CHUNK_SAMPLES) {
            const chunk = audioBuf.slice(0, CHUNK_SAMPLES);
            audioBuf = audioBuf.slice(CHUNK_SAMPLES);
            ws.send(floatToPcm16(chunk));
          }
        };

        source.connect(gainNode);
        gainNode.connect(processor);
        processor.connect(audioCtx.destination);

      } catch (err) {
        if (!stopped) message.error(`麦克风启动失败: ${err.message}`);
        setRecording(false);
      }
    };

    startMic();

    return () => {
      stopped = true;
      if (micProcessorRef.current) { micProcessorRef.current.disconnect(); micProcessorRef.current = null; }
      if (micAudioCtxRef.current) { micAudioCtxRef.current.close(); micAudioCtxRef.current = null; }
      // 停止 MediaRecorder 并上传录音
      if (micMediaRecorderRef.current && micMediaRecorderRef.current.state !== 'inactive') {
        try { micMediaRecorderRef.current.stop(); } catch (_) {}
      }
      micMediaRecorderRef.current = null;
      if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
      if (micWsRef.current) { micWsRef.current.close(); micWsRef.current = null; }
      // 异步上传录音文件（不阻塞 cleanup）
      const chunks = micAudioChunksRef.current;
      if (chunks && chunks.length) {
        const audioBlob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        if (audioBlob.size > 0) {
          const token = getStoredToken();
          const form = new FormData();
          form.append('meeting_id', currentMeetingId);
          form.append('meeting_title', currentMeetingTitle || '');
          form.append('agenda', '');
          form.append('duration_seconds', '0');
          form.append('file', audioBlob, `${currentMeetingId}-${Date.now()}.webm`);
          fetch('/api/meeting/recorder/audio', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          }).then(() => {
            return fetch('/api/meeting/recorder/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ meeting_id: currentMeetingId, meeting_title: currentMeetingTitle || '', agenda: '', action: 'stop' }),
            });
          }).catch(() => {});
        }
      }
      micAudioChunksRef.current = [];
    };
  }, [recording, currentMeetingId, currentUserName, currentUserMeetingRole]);
  const currentUserSeat = currentUser?.meetingSeat || (currentUser?.role === 'admin' ? '主控席' : '参会席位');
  const currentUserLabel = `${currentUserDept} ${currentUserName}`.trim();
  const issueImportRunning = issueImportStatus.running;
  const issueGenerationRunning = issueImportRunning || agendaGenerating;
  const isMajorMeeting = meetingMode !== 'normal';
  const groupedIssueSources = useMemo(() => groupIssueSourcesByPerson(chatMessages), [chatMessages]);
  const backToMeetingList = () => {
    setTimeout(() => setMeetingWorkspaceOpen(false), 0);
  };

  const handleBackToList = () => {
    const hasContent = !meetingCreated && (
      chatInput.trim() !== ''
      || chatMessages.length > 0
      || agendaTitle.trim() !== ''
      || projectName.trim() !== ''
      || meetingTitle.trim() !== ''
      || meetingMode !== 'normal'
      || agendaGenerated
    );
    if (hasContent) {
      setShowExitConfirm(true);
      return;
    }
    setTimeout(() => setMeetingWorkspaceOpen(false), 0);
  };

  const saveDraftAndExit = async () => {
    setSavingDraft(true);
    try {
      const draftId = currentMeetingId || createLocalMeetingId();
      const payload = {
        id: draftId,
        title: meetingTitle || agendaTitle || projectName || '未命名草稿',
        project: projectName || '待定项目',
        projectCode,
        agenda: agendaTitle || '待梳理议题',
        date: meetingDate || createLocalDate(),
        type: meetingOrg || '普通企业会议',
        meetingMode,
        phase: '问题收集中',
        issueSources: chatMessages,
        agendaDrafts: agendaGenerated ? activeIssueCards : [],
      };
      await authFetchJson('/api/meetings', { method: 'POST', body: JSON.stringify(payload) });
      await loadMeetings();
      message.success('草稿已保存，可从会议列表继续编辑。');
    } catch (err) {
      message.warning(`草稿保存失败：${err.message}。内容已保留在页面上。`);
    } finally {
      setSavingDraft(false);
      setShowExitConfirm(false);
      setTimeout(() => setMeetingWorkspaceOpen(false), 0);
    }
  };

  const discardAndExit = () => {
    setShowExitConfirm(false);
    setTimeout(() => setMeetingWorkspaceOpen(false), 0);
  };
  const filteredMeetingRecords = useMemo(() => {
    let result = meetingRecords;
    if (meetingFilterStage) result = result.filter(r => r.phase === meetingFilterStage);
    if (meetingFilterMode) result = result.filter(r => r.meetingMode === meetingFilterMode);
    if (meetingFilterSearch) {
      const keyword = meetingFilterSearch.toLowerCase();
      result = result.filter(r =>
        r.title.toLowerCase().includes(keyword)
        || r.creator.toLowerCase().includes(keyword)
        || r.project.toLowerCase().includes(keyword)
      );
    }
    return result;
  }, [meetingRecords, meetingFilterStage, meetingFilterMode, meetingFilterSearch]);

  const palette = {
    pageBg: 'var(--ui-bg-page)',
    panelBg: 'var(--ui-bg-panel)',
    panelSoft: 'var(--ui-fill-1)',
    ink: 'var(--ui-text-1)',
    text: 'var(--ui-text-2)',
    muted: 'var(--ui-text-3)',
    line: 'var(--ui-border-2)',
    blue: 'var(--ui-primary)',
    green: 'var(--ui-success)',
    amber: 'var(--ui-warning)',
    red: 'var(--ui-danger)',
  };

  const completion = useMemo(() => {
    const transcriptCount = remoteTranscripts.filter(item => item.transcript).length;
    const audioCount = remoteEvents.filter(item => item.type === 'audio' && item.playbackUrl).length;
    const signedCount = remoteTranscripts.filter(item => item.correctionSigned).length;
    let score = 0;
    if (chatMessages.length) score += 10;
    if (agendaFrozen || activeStage !== 'collect') score += 10;
    if (transcriptCount) score += 30;
    if (audioCount) score += 25;
    if (meetingGeneratedRecords?.generated) score += 15;
    if (signedCount) score += 10;
    return Math.min(score, 100);
  }, [activeStage, agendaFrozen, chatMessages.length, meetingGeneratedRecords?.generated, remoteEvents, remoteTranscripts]);

  const panelStyle = {
    background: palette.panelBg,
    border: `1px solid ${palette.line}`,
    borderRadius: 12,
    boxShadow: 'var(--ui-shadow-panel)',
  };

  const renderIssueSourceGroups = ({ compact = false } = {}) => {
    if (!groupedIssueSources.length) {
      return (
        <div style={{ padding: 14, borderRadius: 10, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>
          暂无外部问题。复制收集链接给参会部门，或在下方直接粘贴群聊内容。
        </div>
      );
    }

    return groupedIssueSources.map(group => {
      const expanded = Boolean(expandedIssueGroups[group.key]);
      const latest = group.items[group.items.length - 1] || {};
      const latestMeta = parseIssueMeta(latest.meta);
      const latestLabel = latestMeta.label || (latest.type === 'image' ? '图片素材' : '文字素材');
      const imageCount = group.items.reduce((count, item) => count + parseIssueMeta(item.meta).attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl).length, 0);
      const parsedName = String(group.name || '未知填报人').trim();
      const nameParts = parsedName.split(/\s+/).filter(Boolean);
      const personName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : parsedName;
      const unitName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '参会单位';
      const avatarText = personName.slice(0, 1) || '人';
      const summaryText = latest.content || '已收到素材，等待 AI 提炼';
      const sourceTypes = new Set(group.items.map(item => item.type === 'image' ? '图片素材' : '文字素材'));
      if (compact) {
        return (
          <div
            key={group.key}
            style={{
              borderRadius: 12,
              background: palette.panelBg,
              border: `1px solid ${expanded ? '#bfdbfe' : palette.line}`,
              overflow: 'hidden',
              boxShadow: expanded ? '0 10px 22px rgba(22, 93, 255, 0.08)' : 'none',
            }}
          >
            <button
              type="button"
              onClick={() => setExpandedIssueGroups(prev => ({ ...prev, [group.key]: !expanded }))}
              style={{
                width: '100%',
                border: 0,
                background: expanded ? (isDarkMode ? '#10213a' : '#f8fbff') : palette.panelBg,
                padding: '10px 11px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '30px minmax(0, 1fr) auto',
                gap: 9,
                alignItems: 'start',
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9,
                  display: 'grid',
                  placeItems: 'center',
                  background: isDarkMode ? '#10213a' : '#eef5ff',
                  border: '1px solid rgba(22, 93, 255, 0.16)',
                  color: palette.blue,
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                {avatarText}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <strong style={{ minWidth: 0, color: palette.ink, fontSize: 13, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personName}</strong>
                  <em style={{ flex: '0 0 auto', color: palette.muted, fontStyle: 'normal', fontSize: 11, lineHeight: 1 }}>{unitName}</em>
                </span>
                <span style={{ display: 'block', marginTop: 5, color: palette.text, fontSize: 12, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summaryText}
                </span>
                <span style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 7, minWidth: 0, overflow: 'hidden' }}>
                  <i style={{ flex: '0 0 auto', height: 20, padding: '0 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: '#e8f3ff', color: palette.blue, fontStyle: 'normal', fontSize: 11, fontWeight: 750 }}>{group.items.length} 条</i>
                  {[...sourceTypes].slice(0, 2).map(type => (
                    <i key={type} style={{ flex: '0 0 auto', height: 20, padding: '0 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: palette.panelSoft, color: palette.muted, border: `1px solid ${palette.line}`, fontStyle: 'normal', fontSize: 11, fontWeight: 650 }}>{type}</i>
                  ))}
                  {imageCount > 0 && <i style={{ flex: '0 0 auto', height: 20, padding: '0 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: '#e8fffb', color: '#08979c', border: '1px solid rgba(20, 201, 201, 0.18)', fontStyle: 'normal', fontSize: 11, fontWeight: 650 }}>{imageCount} 图</i>}
                </span>
              </span>
              <span style={{ color: palette.muted, fontSize: 11, whiteSpace: 'nowrap', lineHeight: '28px' }}>{group.latestTime}</span>
            </button>

            {expanded && (
              <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px', maxHeight: 236, overflowY: 'auto', overscrollBehavior: 'contain', background: isDarkMode ? '#0d1422' : '#fbfdff' }}>
                {group.items.map(item => {
                  const metaInfo = parseIssueMeta(item.meta);
                  const images = metaInfo.attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl);
                  return (
                    <div key={item.id || `${item.time}-${item.content}`} style={{ padding: 9, borderRadius: 9, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <Text style={{ color: palette.muted, fontSize: 11 }}>{item.time || item.serverTime || '--:--'}</Text>
                        {metaInfo.label && <Tag color="cyan" style={{ margin: 0 }}>{metaInfo.label}</Tag>}
                      </div>
                      {images.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))', gap: 7, marginTop: 8 }}>
                          {images.map(attachment => (
                            <button
                              key={attachment.id || attachment.name}
                              type="button"
                              onClick={() => setIssueImagePreview(attachment)}
                              style={{ border: `1px solid ${palette.line}`, borderRadius: 8, padding: 0, background: '#fff', overflow: 'hidden', cursor: 'zoom-in' }}
                            >
                              <img src={attachment.imageDataUrl} alt={attachment.name} style={{ width: '100%', height: 74, objectFit: 'cover', display: 'block' }} />
                            </button>
                          ))}
                        </div>
                      )}
                      <div style={{ marginTop: 7, color: palette.text, lineHeight: 1.55, fontSize: 12, overflowWrap: 'anywhere' }}>{item.content}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }
      return (
        <div key={group.key} style={{ borderRadius: 14, background: palette.panelBg, border: `1px solid ${palette.line}`, overflow: 'hidden', boxShadow: compact ? 'none' : '0 8px 20px rgba(15, 23, 42, 0.04)' }}>
          <button
            type="button"
            onClick={() => setExpandedIssueGroups(prev => ({ ...prev, [group.key]: !expanded }))}
            style={{
              width: '100%',
              border: 0,
              background: palette.panelBg,
              padding: compact ? 10 : 12,
              textAlign: 'left',
              cursor: 'pointer',
              display: 'grid',
              gap: compact ? 8 : 10,
            }}
          >
            <div style={{ padding: compact ? 0 : 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <Text strong style={{ color: palette.ink, fontSize: 13, lineHeight: 1.4 }}>{unitName} {personName}</Text>
                <Text style={{ color: palette.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{group.latestTime}</Text>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <StatusPill color="blue">{group.items.length} 条提交</StatusPill>
                {[...sourceTypes].map(type => <StatusPill key={type} color="default">{type}</StatusPill>)}
                {imageCount > 0 && <StatusPill color="cyan">{imageCount} 张原图</StatusPill>}
                {latestLabel && ![...sourceTypes].includes(latestLabel) && <StatusPill color="default">{latestLabel}</StatusPill>}
              </div>
              <div style={{ marginTop: 9, color: palette.text, fontSize: 13, lineHeight: 1.62, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: expanded ? 3 : 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
                {summaryText}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '44px minmax(0, 1fr) auto',
                gap: 12,
                alignItems: 'center',
                padding: compact ? '9px 10px' : '12px',
                borderRadius: 12,
                border: `1px solid ${palette.line}`,
                background: palette.panelSoft,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', color: palette.blue, background: isDarkMode ? '#10213a' : '#eef5ff', border: '1px solid rgba(22, 93, 255, 0.18)', fontWeight: 700, fontSize: 17 }}>
                {avatarText}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: palette.ink, fontWeight: 700, fontSize: 14, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personName}</div>
                <div style={{ marginTop: 3, color: palette.muted, fontSize: 12, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unitName}</div>
              </div>
              <div style={{ color: expanded ? palette.blue : palette.red, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
                {expanded ? '收起明细' : `已提交${group.items.length}条`}
              </div>
            </div>
          </button>

          {expanded && (
            <div style={{ display: 'grid', gap: 8, padding: compact ? '0 10px 10px' : '0 12px 12px', maxHeight: compact ? 260 : 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {group.items.map(item => {
                const metaInfo = parseIssueMeta(item.meta);
                const images = metaInfo.attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl);
                return (
                  <div key={item.id || `${item.time}-${item.content}`} style={{ padding: 10, borderRadius: 10, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: palette.muted, fontSize: 12 }}>{item.time || item.serverTime || '--:--'}</Text>
                      {metaInfo.label && <Tag color="cyan" style={{ margin: 0 }}>{metaInfo.label}</Tag>}
                    </div>
                    {images.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8, marginTop: 8 }}>
                        {images.map(attachment => (
                          <button
                            key={attachment.id || attachment.name}
                            type="button"
                            onClick={() => setIssueImagePreview(attachment)}
                            style={{ border: `1px solid ${palette.line}`, borderRadius: 10, padding: 0, background: '#fff', overflow: 'hidden', cursor: 'zoom-in' }}
                          >
                            <img src={attachment.imageDataUrl} alt={attachment.name} style={{ width: '100%', height: 92, objectFit: 'cover', display: 'block' }} />
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8, color: palette.text, lineHeight: 1.62, fontSize: 13, overflowWrap: 'anywhere' }}>{item.content}</div>
                    {metaInfo.attachments.filter(attachment => attachment.type !== 'image').map(attachment => (
                      <div key={attachment.id || attachment.name} style={{ marginTop: 8, padding: 8, borderRadius: 8, background: palette.panelSoft, color: palette.muted, fontSize: 12, lineHeight: 1.55 }}>
                        <FileTextOutlined style={{ marginRight: 6, color: palette.blue }} />
                        <strong style={{ color: palette.ink }}>{attachment.name}</strong>
                        <span>：{attachment.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  const renderCompactIssueSourceList = () => {
    if (!groupedIssueSources.length) {
      return (
        <div style={{ padding: 14, borderRadius: 10, background: palette.panelBg, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>
          暂无外部问题。复制收集链接给参会部门，或在下方直接粘贴群聊内容。
        </div>
      );
    }

    return groupedIssueSources.map(group => {
      const expanded = Boolean(expandedIssueGroups[group.key]);
      const latest = group.items[group.items.length - 1] || {};
      const parsedName = String(group.name || '未知填报人').trim();
      const nameParts = parsedName.split(/\s+/).filter(Boolean);
      const personName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : parsedName;
      const unitName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '参会单位';
      const imageCount = group.items.reduce((count, item) => count + parseIssueMeta(item.meta).attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl).length, 0);
      const summaryText = latest.content || '已收到素材，等待 AI 提炼';
      const sourceLabel = latest.type === 'image' ? '图片' : '文字';
      return (
        <div key={group.key} style={{ minHeight: 72, borderRadius: 10, border: `1px solid ${palette.line}`, background: palette.panelBg, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setIssueSourceDetailGroup(group)}
            style={{
              width: '100%',
              minHeight: 64,
              border: 0,
              background: palette.panelBg,
              padding: '9px 10px',
              display: 'grid',
              gridTemplateColumns: '26px minmax(0, 1fr) auto',
              gap: 8,
              alignItems: 'center',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 24, height: 24, borderRadius: 8, background: '#e8f3ff', color: palette.blue, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
              {personName.slice(0, 1) || '人'}
            </span>
            <span style={{ minWidth: 0, display: 'block' }}>
              <span style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 }}>
                <strong style={{ minWidth: 0, color: palette.ink, fontSize: 13, lineHeight: 1.25, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personName}</strong>
                <em style={{ flex: '0 0 auto', color: palette.muted, fontStyle: 'normal', fontSize: 11 }}>{unitName}</em>
              </span>
              <span style={{ display: 'block', marginTop: 4, color: palette.text, fontSize: 12, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summaryText}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, color: palette.muted, fontSize: 11, lineHeight: 1 }}>
                <span>{group.items.length} 条</span>
                <span>{sourceLabel}</span>
                {imageCount > 0 && <span>{imageCount} 图</span>}
                <span>{group.latestTime}</span>
              </span>
            </span>
            <span style={{ height: 24, padding: '0 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: `1px solid ${palette.line}`, color: palette.blue, fontSize: 11, fontWeight: 750, whiteSpace: 'nowrap' }}>
              详情
            </span>
          </button>
        </div>
      );
    });
  };

  const recorderShareUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams({ meetingId: currentMeetingId });
    // 同时传递会议标题，手机登录页可直接显示无需等待 API
    if (meetingTitle) params.set('meeting', meetingTitle);
    if (projectName) params.set('project', projectName);
    return `${origin}/mobile-recorder?${params.toString()}`;
  }, [currentMeetingId, meetingTitle, projectName]);

  // 会议短标识用于核对
  const meetingShortId = useMemo(() => {
    if (!currentMeetingId) return '';
    return currentMeetingId.replace('meeting-', '').slice(-12);
  }, [currentMeetingId]);

  const recorderQrUrl = useMemo(() => {
    const trimmedOrigin = externalShareOrigin.trim().replace(/\/+$/, '');
    if (!trimmedOrigin) return recorderShareUrl;
    try {
      const base = new URL(recorderShareUrl);
      return `${trimmedOrigin}${base.pathname}${base.search}`;
    } catch {
      return recorderShareUrl;
    }
  }, [externalShareOrigin, recorderShareUrl]);

  const recorderQrUsesLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(recorderQrUrl);
  const agendaDisplayTitle = (agendaTitle || meetingTitle || '待确认议题').trim();
  const agendaTitleLines = agendaDisplayTitle.length > 18
    ? agendaDisplayTitle.replace(/(.{12,18})(?=.)/, '$1\n').split('\n')
    : [agendaDisplayTitle];

  const issueCollectShareUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams({
      meetingId: currentMeetingId,
      meeting: meetingTitle,
      agenda: agendaTitle,
      project: projectName,
      projectCode,
      date: meetingDate,
      mode: meetingMode,
    });
    return `${origin}/issue-collect?${params.toString()}`;
  }, [agendaTitle, currentMeetingId, meetingDate, meetingMode, meetingTitle, projectCode, projectName]);

  const activeIssueCards = useMemo(
    () => (agendaGenerated || meetingCreated ? agendaDrafts : []),
    [agendaDrafts, agendaGenerated, meetingCreated],
  );

  const selectedIssueCards = useMemo(
    () => activeIssueCards.filter(item => selectedIssueIds.includes(item.id)),
    [activeIssueCards, selectedIssueIds],
  );

  const materialRows = useMemo(() => {
    const uploadedByName = new Map(meetingMaterials.map(item => [item.name, item]));
    // 重大会议需核验的固定材料清单；普通会议无预设清单
    const checklist = isMajorMeeting
      ? ['可研修订说明', '资金来源测算表', '法务审查意见', '合同变更草案']
      : [];
    const standardRows = checklist.map(name => {
      const uploaded = uploadedByName.get(name);
      if (!uploaded) return { name, uploaded: false, status: '待上传', tone: 'orange' };
      return {
        name,
        ...uploaded,
        status: '已上传',
        tone: 'green',
        uploaded: true,
      };
    });
    const extraRows = meetingMaterials
      .filter(item => !checklist.some(name => name === item.name))
      .map(item => ({ ...item, status: item.status || '已上传', tone: item.tone || 'green', uploaded: true }));
    return [...standardRows, ...extraRows];
  }, [meetingMaterials, isMajorMeeting]);

  const missingMaterialCount = useMemo(
    () => materialRows.filter(item => !item.uploaded).length,
    [materialRows],
  );
  const effectiveMissingMaterialCount = isMajorMeeting ? missingMaterialCount : 0;

  const hydrateMeetingDetail = (meeting) => {
    if (!meeting?.id) return;
    const normalized = normalizeMeetingRecord(meeting);
    setCurrentMeetingId(normalized.id);
    setProjectName(normalized.project);
    setProjectCode(normalized.projectCode || `LOCAL-${normalized.date.replaceAll('-', '')}-001`);
    setMeetingDate(normalized.date);
    setMeetingTitle(normalized.title);
    setMeetingOrg(normalized.type);
    setMeetingMode(normalized.meetingMode === 'normal' ? 'normal' : 'major');
    setAgendaTitle(normalized.agenda);
    const nextIssueSources = Array.isArray(meeting.issueSources) ? meeting.issueSources : [];
    setChatMessages(nextIssueSources);
    const derivedDrafts = deriveIssueDraftsFromSources({ ...meeting, issueSources: nextIssueSources });
    const nextAgendaDrafts = Array.isArray(meeting.agendaDrafts) && meeting.agendaDrafts.length
      ? meeting.agendaDrafts
      : derivedDrafts;
    setAgendaDrafts(nextAgendaDrafts);
    const sourceChanged = nextIssueSources.length !== chatMessages.length;
    const draftReady = !['问题收集中', '待创建会议'].includes(normalized.phase) || (agendaGenerated && !sourceChanged);
    setAgendaGenerated(prev => draftReady || prev);
    const nextSelectedIds = draftReady ? nextAgendaDrafts.map(item => item.id).filter(Boolean) : [];
    setSelectedIssueIds(nextSelectedIds);
    setSelectedIssueId(nextSelectedIds[0] || 'issue-001');
    if (draftReady && nextSelectedIds.length > 1) {
      setAgendaTitle(nextAgendaDrafts.map(item => item.title).filter(Boolean).join('；'));
    }
    setMeetingMaterials(Array.isArray(meeting.materials) ? meeting.materials : []);
    setProjectBound(Boolean(meeting.projectBound));
    setAgendaFrozen(Boolean(meeting.agendaFrozen));
    setReviewDone(Boolean(meeting.reviewDone));
    setArchiveDone(Boolean(meeting.archiveDone));
    setMeetingCreated(!['问题收集中', '待创建会议'].includes(normalized.phase));
    const stageByPhase = {
      问题收集中: 'collect',
      待创建会议: 'collect',
      会前确认: 'collect',
      会中记录: 'meeting',
      会后终审: 'audit',
      已归档: 'archive',
    };
    setActiveStage(stageByPhase[normalized.phase] || 'collect');
  };

  const loadMeetings = async () => {
    setMeetingsLoading(true);
    try {
      const data = await authFetchJson('/api/meetings');
      const rows = (data.meetings || []).map(normalizeMeetingRecord);
      setMeetingRecords(rows);
      setMeetingDataReady(true);
      return rows;
    } catch (error) {
      setMeetingDataReady(false);
      message.warning(`会议数据接口暂不可用：${error.message}`);
      return meetingRecords;
    } finally {
      setMeetingsLoading(false);
    }
  };

  const loadMeetingDetail = async (meetingId, { createIfMissing = false } = {}) => {
    try {
      const data = await authFetchJson(`/api/meetings/${meetingId}`);
      hydrateMeetingDetail(data.meeting);
      return data.meeting;
    } catch (error) {
      if (!createIfMissing) {
        message.warning(`会议详情加载失败：${error.message}`);
        return null;
      }
      const created = await authFetchJson('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          id: meetingId,
          title: meetingTitle,
          project: projectName,
          projectCode,
          agenda: agendaTitle,
          date: meetingDate,
          type: meetingOrg,
          meetingMode,
          phase: '问题收集中',
          issueSources: chatMessages,
          agendaDrafts: selectedIssueCards.length ? selectedIssueCards : activeIssueCards,
        }),
      });
      hydrateMeetingDetail(created.meeting);
      await loadMeetings();
      return created.meeting;
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await loadMeetings();
      if (!alive) return;
      if (directCollectEntry) {
        await loadMeetingDetail(currentMeetingId, { createIfMissing: true });
        setMeetingWorkspaceOpen(true);
        return;
      }
      const current = rows.find(item => item.id === currentMeetingId);
      if (current && meetingWorkspaceOpen) {
        await loadMeetingDetail(current.id);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!meetingWorkspaceOpen) return undefined;
    if (meetingCreated && activeStage !== 'collect') return undefined;
    let alive = true;
    const syncCurrentMeetingIssues = async () => {
      try {
        const data = await authFetchJson(`/api/meetings/${currentMeetingId}`);
        if (!alive) return;
        const issueCount = Array.isArray(data.meeting?.issueSources) ? data.meeting.issueSources.length : 0;
        const draftCount = Array.isArray(data.meeting?.agendaDrafts) ? data.meeting.agendaDrafts.length : 0;
        if (issueCount !== chatMessages.length || draftCount !== agendaDrafts.length) {
          hydrateMeetingDetail(data.meeting);
        }
      } catch (err) { console.warn("API error:", err); }
    };
    const timer = window.setInterval(syncCurrentMeetingIssues, 3000);
    syncCurrentMeetingIssues();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeStage, agendaDrafts.length, chatMessages.length, currentMeetingId, meetingCreated, meetingWorkspaceOpen]);

  useEffect(() => {
    if (!issueImportStatus.running) return undefined;
    const timer = window.setInterval(() => {
      setIssueImportStatus(prev => {
        if (!prev.running) return prev;
        return { ...prev, step: Math.min(prev.step + 1, ISSUE_IMPORT_STEPS.length - 1) };
      });
    }, 2400);
    return () => window.clearInterval(timer);
  }, [issueImportStatus.running]);

  const loadMeetingTranscripts = async () => {
    try {
      const data = await authFetchJson(`/api/meeting/transcripts/${currentMeetingId}?limit=2000`);
      setRemoteEvents(data.events || []);
      setRemoteTranscripts(data.transcripts || []);
      setTranscriptUpdatedAt(data.updatedAt || '');
    } catch (err) {
      console.warn("Transcripts load failed:", err);
      setRemoteEvents([]);
      setRemoteTranscripts([]);
    }
  };

  useEffect(() => {
    if (!currentMeetingId) return;
    setRemoteEvents([]);
    setRemoteTranscripts([]);
    setTranscriptUpdatedAt('');
    setMeetingGeneratedRecords(null);

    let markersLoaded = false;

    let eventSource = null;
    let pollTimer = null;
    let sseReconnectTimer = null;
    let stopped = false;

    const doPoll = async () => {
      try {
        const data = await authFetchJson(`/api/meeting/transcripts/${currentMeetingId}?limit=2000`);
        // 合并而非替换——避免覆盖 SSE 增量推送的数据
        setRemoteEvents(prev => {
          const apiEvents = data.events || [];
          const existingIds = new Set(apiEvents.map(e => e.id));
          const kept = (prev || []).filter(e => !existingIds.has(e.id));
          return [...kept, ...apiEvents].slice(-200);
        });
        setRemoteTranscripts(prev => {
          const apiList = data.transcripts || [];
          const apiMap = new Map(apiList.map(t => [t.id, t]));
          // 用 API 数据更新已有条目，新增 API 中有但本地没有的
          const merged = (prev || []).map(item =>
            apiMap.has(item.id) ? { ...item, ...apiMap.get(item.id) } : item
          );
          // 追加 API 中有但本地没有的
          const existingIds = new Set(merged.map(t => t.id));
          for (const t of apiList) {
            if (!existingIds.has(t.id)) merged.push(t);
          }
          // 按 clientTime 排序（多设备同步时 clientTime 更准确），serverTime 作为 fallback
          merged.sort((a, b) => (a.clientTime || a.serverTime || '').localeCompare(b.clientTime || b.serverTime || ''));
          return merged.slice(-300);
        });
        setTranscriptUpdatedAt(data.updatedAt || '');

        // 首次轮询成功后再加载 markers（避免会议未就绪时 404）
        if (!markersLoaded) {
          markersLoaded = true;
          loadMeetingMarkers();
        }

        // 会议已结束时停止高频轮询
        const phase = data.meetingPhase;
        if (phase && !['问题收集中', '待创建会议', '会前确认', '进行中'].includes(phase)) {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (eventSource) { eventSource.close(); eventSource = null; }
        }
      } catch (err) { console.warn("Parse error:", err); }
    };

    // 轮询作为主通道，1.5秒一次保证低延迟
    doPoll();
    pollTimer = window.setInterval(doPoll, 1500);

    // SSE 作为加速通道，连接成功则推送更快
    const connectSSE = () => {
      if (stopped || !currentMeetingId) return;
      const token = getStoredToken();
      const sseUrl = token
        ? `/api/meetings/${currentMeetingId}/transcripts/sse?token=${encodeURIComponent(token)}`
        : `/api/meetings/${currentMeetingId}/transcripts/sse`;
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'transcript' && payload.data) {
            const t = payload.data;
            setRemoteTranscripts(prev => {
              const existing = prev.find(item => item.id === t.id);
              if (existing) {
                return prev.map(item => item.id === t.id
                  ? { ...item, transcript: t.transcript, isFinal: t.isFinal, speakerName: t.speakerName || item.speakerName }
                  : item);
              }
              return [...prev, {
                id: t.id, transcript: t.transcript, isFinal: t.isFinal,
                speakerName: t.speakerName, speakerRole: t.speakerRole,
                clientTime: t.time, serverTime: t.time, username: '',
              }].slice(-500);
            });
            setTranscriptUpdatedAt(new Date().toISOString());
          } else if (payload.type === 'session' && payload.data) {
            setRemoteEvents(prev => [...prev, payload.data].slice(-100));
          }
        } catch (err) { console.warn("Parse error:", err); }
      };

      let sseRetries = 0;
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        // 指数退避: 3s → 6s → 12s → ... → max 60s
        const delay = Math.min(3000 * Math.pow(2, sseRetries), 60000);
        sseRetries++;
        sseReconnectTimer = window.setTimeout(() => {
          if (!stopped) connectSSE();
        }, delay);
      };
      eventSource.onopen = () => { sseRetries = 0; };
    };

    connectSSE();

    return () => {
      stopped = true;
      eventSource?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      if (sseReconnectTimer) window.clearTimeout(sseReconnectTimer);
    };
  }, [currentMeetingId]);

  const loadGeneratedMeetingRecords = async (force = false) => {
    if (!currentMeetingId) return null;
    setMeetingRecordsLoading(true);
    try {
      const url = `/api/meetings/${currentMeetingId}/records${force ? '?force=true' : ''}`;
      const data = await authFetchJson(url);
      setMeetingGeneratedRecords(data.records || null);
      return data.records || null;
    } catch (err) {
      message.error(`会议记录生成失败：${err.message}`);
      return null;
    } finally {
      setMeetingRecordsLoading(false);
    }
  };

  useEffect(() => {
    if (activeStage !== 'audit' && activeStage !== 'archive') return;
    loadGeneratedMeetingRecords();
  }, [activeStage, currentMeetingId]);

  // Whisper 终审状态轮询：在 audit 阶段每 10 秒检查一次，完成后自动刷新 records
  useEffect(() => {
    if (activeStage !== 'audit' && activeStage !== 'archive') return;
    if (!currentMeetingId) return;
    let alive = true;
    const poll = async () => {
      try {
        const data = await authFetchJson(`/api/meetings/${currentMeetingId}/whisper-review`);
        const results = data?.whisperReview || [];
        if (!alive) return;
        if (results.length > 0) {
          const hasGood = results.some(r => (r.text || '').length > 50);
          if (hasGood && whisperStatus !== 'done') {
            setWhisperStatus('done');
            // Whisper 完成，强制刷新 records（后端已更新 generatedRecords）
            loadGeneratedMeetingRecords(true);
          }
        } else {
          // 检查 whisperDocx 状态判断是否正在生成
          const wd = meetingGeneratedRecords?.whisperDocx;
          if (wd?.status === 'generating') {
            setWhisperStatus('running');
          } else if (whisperStatus === 'running') {
            setWhisperStatus('idle');
          }
        }
      } catch {}
    };
    poll();
    const timer = window.setInterval(poll, 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activeStage, currentMeetingId, whisperStatus]);

  // 每 5 分钟批量送 DeepSeek 做议题-发言比对
  useEffect(() => {
    if (activeStage !== 'meeting' || !remoteTranscripts.length) {
      setAgendaRealtimeChecks({});
      setAgendaRealtimeProvider('');
      return undefined;
    }
    const agendaRows = (activeIssueCards.length ? activeIssueCards : [{ id: 'agenda-current', title: agendaTitle }])
      .slice(0, 8)
      .map((item, index) => ({
        id: item.id || `agenda-${index}`,
        title: item.title || agendaTitle,
      }));
    if (!agendaRows.length) return undefined;

    let alive = true;
    let lastCheckAt = 0;
    const MIN_INTERVAL = 5 * 60 * 1000; // 5分钟

    const doCheck = async () => {
      if (!alive) return;
      const now = Date.now();
      if (now - lastCheckAt < MIN_INTERVAL) return;
      lastCheckAt = now;
      try {
        setAgendaRealtimeLoading(true);
        const data = await authFetchJson(`/api/meetings/${currentMeetingId}/agenda/realtime-check`, {
          method: 'POST',
          body: JSON.stringify({
            agendaDrafts: agendaRows,
            latestTranscripts: remoteTranscripts.slice(-50),  // 送更多上下文
            meetingMode,
          }),
        });
        if (!alive) return;
        const checks = {};
        (data.results || []).forEach(item => {
          if (item.agendaId) checks[item.agendaId] = item;
        });
        setAgendaRealtimeChecks(checks);
        setAgendaRealtimeProvider(data.aiProvider || '');
      } catch (_) {
        if (alive) { setAgendaRealtimeChecks({}); setAgendaRealtimeProvider(''); }
      } finally {
        if (alive) setAgendaRealtimeLoading(false);
      }
    };

    // 首次延迟5秒执行，之后每30秒检查一次是否需要（但实际只每5分钟发一次）
    const timer = window.setTimeout(() => { doCheck(); }, 5000);
    const interval = window.setInterval(doCheck, 30000);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [activeStage, activeIssueCards, agendaTitle, currentMeetingId, meetingMode, remoteTranscripts.length]);

  useEffect(() => {
    const parseMeetingTimestamp = value => {
      const text = String(value || '').trim();
      if (!text) return null;
      const normalized = text.includes('T') ? text : text.replace(' ', 'T');
      const timestamp = Date.parse(normalized);
      return Number.isFinite(timestamp) ? timestamp : null;
    };
    const remoteTimes = [
      ...remoteEvents.map(item => item.serverTime),
      ...remoteTranscripts.map(item => item.serverTime),
    ]
      .map(parseMeetingTimestamp)
      .filter(Boolean);
    const hasRemoteMeetingActivity = remoteEvents.some(item => ['join', 'start', 'chunk', 'transcript', 'audio-uploaded'].includes(item.action || item.type)) || remoteTranscripts.length > 0;
    if (!recording && !hasRemoteMeetingActivity) {
      recordingStartedAtRef.current = null;
      setMeetingElapsedText('00:00:00');
      return undefined;
    }
    const remoteStartedAt = remoteTimes.length ? Math.min(...remoteTimes) : null;
    if (!recordingStartedAtRef.current) {
      recordingStartedAtRef.current = remoteStartedAt || Date.now();
    } else if (remoteStartedAt) {
      recordingStartedAtRef.current = Math.min(recordingStartedAtRef.current, remoteStartedAt);
    }
    const formatElapsed = () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
      const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
      const seconds = String(elapsedSeconds % 60).padStart(2, '0');
      setMeetingElapsedText(`${hours}:${minutes}:${seconds}`);
    };
    formatElapsed();
    const timer = window.setInterval(formatElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [recording, remoteEvents, remoteTranscripts.length, transcriptUpdatedAt]);

  const remoteSpeakerRows = useMemo(() => {
    const speakerMap = new Map();

    remoteEvents.forEach(event => {
      const speaker = event.speaker || {};
      const name = speaker.displayName || speaker.username || '未命名参会人';
      const current = speakerMap.get(name) || {
        name,
        role: speaker.meetingRole || '参会代表',
        device: `${name}的手机`,
        status: '已连接',
        confidence: 94,
        transcriptCount: 0,
        lastTime: '',
        lastAction: '',
        username: speaker.username || '',
        fromRemote: true,
      };
      speakerMap.set(name, {
        ...current,
        role: speaker.meetingRole || current.role,
        device: speaker.seat || current.device || `${name}的手机`,
        lastTime: event.serverTime || current.lastTime,
        lastAction: event.action || current.lastAction,
        username: speaker.username || current.username,
        fromRemote: true,
      });
    });

    remoteTranscripts.forEach(item => {
      const name = item.speakerName || item.username || '未命名参会人';
      const current = speakerMap.get(name) || {
        name,
        role: item.speakerRole || '参会代表',
        device: item.seat || `${name}的手机`,
        status: '已转写',
        confidence: Math.round((item.confidence || 0.94) * 100),
        transcriptCount: 0,
        lastTime: '',
        lastAction: '',
        username: item.username || '',
        fromRemote: true,
      };
      speakerMap.set(name, {
        ...current,
        role: item.speakerRole || current.role,
        device: item.seat || current.device,
        confidence: Math.round((item.confidence || 0.94) * 100),
        transcriptCount: (current.transcriptCount || 0) + 1,
        lastTime: item.serverTime || current.lastTime,
        username: item.username || current.username,
        fromRemote: true,
      });
    });

    return Array.from(speakerMap.values()).map(item => ({
      ...item,
      status: item.lastAction === 'start'
        ? '录音中'
        : item.lastAction === 'join'
          ? '已接入，待录音'
          : item.lastAction === 'stop'
            ? '录音已结束'
        : item.transcriptCount > 0
          ? `已转写 ${item.transcriptCount} 条`
          : item.fromRemote
            ? '已接入'
            : item.status,
    })).sort((a, b) => {
      if (a.fromRemote !== b.fromRemote) return a.fromRemote ? -1 : 1;
      return String(b.lastTime || '').localeCompare(String(a.lastTime || ''));
    });
  }, [remoteEvents, remoteTranscripts]);

  const liveTranscriptRows = useMemo(() => {
    // suffix alignment 协议保证 newText 不重叠，ID + 精确文本去重即可
    const seenIds = new Set();
    const seenTextKeys = new Set();
    const remoteRows = [];
    for (const item of remoteTranscripts.slice().reverse()) {
      if (!item.id) continue;
      if (seenIds.has(item.id)) continue;  // 轮询/SSE 双通道重复
      seenIds.add(item.id);
      const textKey = `${item.speakerName || ''}|${(item.transcript || '').trim()}`;
      if (textKey && seenTextKeys.has(textKey)) continue;  // 相同说话人相同文本
      if (textKey) seenTextKeys.add(textKey);
      remoteRows.push({
        id: item.id,
        time: item.clientTime || item.serverTime?.slice(11, 16) || '--:--',
        rawTime: item.clientTime || item.serverTime || '', // 原始时间戳，用于音频联动
        speaker: item.speakerName,
        role: item.speakerRole,
        text: item.transcript,
        active: true,
        source: item.source || 'mobile',
        seat: item.seat,
        dept: item.speakerDept,
      });
    }
    return remoteRows;
  }, [remoteTranscripts]);

  const recordingPlaybackRows = useMemo(
    () => remoteEvents
      .filter(item => item.type === 'audio' && item.playbackUrl)
      .slice(-8)
      .reverse(),
    [remoteEvents],
  );

  const signedTranscriptRows = useMemo(
    () => remoteTranscripts
      .filter(item => item.correctionSigned)
      .slice(-8)
      .reverse()
      .map(item => ({
        id: item.id,
        signer: item.correctionAuthor || item.speakerName || item.username || '未命名参会人',
        role: item.speakerRole || '参会代表',
        signedAt: item.correctionClientTime || item.correctionSignedAt || item.serverTime || '--',
        text: item.correctedTranscript || item.transcript || '',
        signatureData: item.signatureData || '',
      })),
    [remoteTranscripts],
  );

  const latestSignatureData = signedTranscriptRows.find(item => item.signatureData)?.signatureData || '';

  // 实时待办提取：每 10 条新转写触发一次
  useEffect(() => {
    if (!recording || !currentMeetingId) return;
    const count = remoteTranscripts.length;
    const lastExtract = lastTodoExtractCountRef.current;
    if (count - lastExtract < 10) return; // 每 10 条提取一次
    lastTodoExtractCountRef.current = count;
    const doExtract = async () => {
      setRealtimeTodosLoading(true);
      try {
        const token = getStoredToken();
        const resp = await fetch(`/api/meetings/${currentMeetingId}/realtime-todos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ transcripts: remoteTranscripts.slice(-20) }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.todos?.length) {
            setRealtimeTodos(prev => {
              const existing = new Set(prev.map(t => t.task));
              const fresh = data.todos.filter(t => !existing.has(t.task));
              return [...prev, ...fresh].slice(-10); // 最多保留 10 条
            });
          }
        }
      } catch (_) {} finally {
        setRealtimeTodosLoading(false);
      }
    };
    doExtract();
  }, [remoteTranscripts.length, recording, currentMeetingId]);

  const recentRemoteEvents = useMemo(
    () => remoteEvents.slice(-8).reverse(),
    [remoteEvents],
  );

  const selectedIssue = useMemo(
    () => activeIssueCards.find(item => item.id === selectedIssueId) || selectedIssueCards[0] || activeIssueCards[0] || null,
    [activeIssueCards, selectedIssueCards, selectedIssueId],
  );

  const selectedAgendaTitle = useMemo(
    () => selectedIssueCards.map(item => item.title).filter(Boolean).join('；'),
    [selectedIssueCards],
  );

  const toggleIssueSelection = (item) => {
    const nextIds = selectedIssueIds.includes(item.id)
      ? selectedIssueIds.filter(id => id !== item.id)
      : [...selectedIssueIds, item.id];
    const nextSelectedItems = activeIssueCards.filter(issue => nextIds.includes(issue.id));
    setSelectedIssueIds(nextIds);
    if (!nextIds.includes(selectedIssueId)) {
      setSelectedIssueId(nextIds[0] || item.id);
    } else if (!selectedIssueIds.includes(item.id)) {
      setSelectedIssueId(item.id);
    }
    if (!selectedIssueIds.includes(item.id)) {
      setProjectName(item.project && item.project !== '待绑定干部档案' ? item.project : projectName);
      setMeetingTitle(item.project && item.project !== '待绑定干部档案' ? `${item.project}专题会` : meetingTitle);
    }
    setAgendaTitle(nextSelectedItems.map(issue => issue.title).filter(Boolean).join('；'));
  };

  const addChatMessage = async () => {
    if (!chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput('');
    setAgendaGenerated(false);
    setSelectedIssueIds([]);
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          name: `${currentUserDept} 当前用户`,
          type: 'text',
          content,
          source: 'manual',
        }),
      });
      hydrateMeetingDetail(data.meeting);
      setAgendaGenerated(false);
      setSelectedIssueIds([]);
      await loadMeetings();
      message.success('AI 已将新发言写入当前会议议题池');
    } catch (error) {
      setChatMessages(prev => [
        ...prev,
        { id: Date.now(), name: `${currentUserDept} 当前用户`, time: new Date().toTimeString().slice(0, 5), type: 'text', content },
      ]);
      message.warning(`已临时显示，但未写入后端：${error.message}`);
    }
  };

  const generateAgendaFromCollectedIssues = async () => {
    if (!chatMessages.length) {
      message.warning('请先收集至少一条问题或素材');
      return;
    }
    setAgendaGenerating(true);
    setIssueImportStatus({
      running: true,
      fileName: `${chatMessages.length} 条收集素材`,
      step: 0,
      importedCount: chatMessages.length,
    });
    try {
      window.setTimeout(() => {
        setIssueImportStatus(prev => (prev.running ? { ...prev, step: Math.max(prev.step, 1) } : prev));
      }, 450);
      await authFetchJson(`/api/meetings/${currentMeetingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          issueSources: chatMessages,
          meetingMode,
          phase: '问题收集中',
        }),
      });
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/agenda/generate`, {
        method: 'POST',
      });
      const drafts = data.agendaDrafts || data.meeting?.agendaDrafts || [];
      if (!drafts.length) {
        throw new Error('AI 未返回有效待办');
      }
      setIssueImportStatus(prev => ({
        ...prev,
        step: ISSUE_IMPORT_STEPS.length - 1,
        importedCount: data.sourceCount || chatMessages.length,
      }));
      hydrateMeetingDetail(data.meeting);
      setAgendaDrafts(drafts);
      setAgendaGenerated(true);
      const nextIds = drafts.map(item => item.id).filter(Boolean);
      setSelectedIssueIds(nextIds);
      setSelectedIssueId(nextIds[0] || 'issue-001');
      setAgendaTitle(drafts.map(item => item.title).filter(Boolean).join('；'));
      await loadMeetings();
      const providerText = data.aiProvider === 'deepseek' ? 'DeepSeek 已真实提炼' : 'DeepSeek 暂不可用，已用本地规则兜底';
      message.success(`${providerText}：${data.sourceCount || chatMessages.length} 条素材生成 ${drafts.length} 个开会待办`);
    } catch (error) {
      const drafts = deriveIssueDraftsFromSources({
        project: projectName || '本次会议',
        agenda: agendaTitle,
        meetingMode,
        issueSources: chatMessages,
      });
      if (!drafts.length) {
        message.warning(`当前素材不足，无法生成开会待办：${error.message}`);
        return;
      }
      setAgendaDrafts(drafts);
      setAgendaGenerated(true);
      const nextIds = drafts.map(item => item.id).filter(Boolean);
      setSelectedIssueIds(nextIds);
      setSelectedIssueId(nextIds[0] || 'issue-001');
      setAgendaTitle(drafts.map(item => item.title).filter(Boolean).join('；'));
      message.warning(`后端 AI 生成失败，已临时使用前端兜底：${error.message}`);
    } finally {
      setAgendaGenerating(false);
      window.setTimeout(() => {
        setIssueImportStatus({
          running: false,
          fileName: '',
          step: 0,
          importedCount: 0,
        });
      }, 900);
    }
  };

  const handleMeetingModeChange = async (value) => {
    setMeetingMode(value);
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ meetingMode: value }),
      });
      if (data?.meeting) hydrateMeetingDetail(data.meeting);
      message.success(value === 'major' ? '已切换为三重一大会议' : '已切换为普通会议');
    } catch (error) {
      message.warning(`会议性质已本地切换，后端暂未写入：${error.message}`);
    }
    if (!agendaGenerated || !chatMessages.length) return;
    const drafts = deriveIssueDraftsFromSources({
      project: projectName || '本次会议',
      agenda: agendaTitle,
      meetingMode: value,
      issueSources: chatMessages,
    });
    setAgendaDrafts(drafts);
    const nextIds = drafts.map(item => item.id).filter(Boolean);
    setSelectedIssueIds(nextIds);
    setSelectedIssueId(nextIds[0] || 'issue-001');
  };

  const downloadIssueTemplate = async () => {
    try {
      const headers = new Headers();
      const token = getStoredToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch('/api/meetings/issues/template', { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'AI会议问题收集模板.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(`模板下载失败：${error.message}`);
    }
  };

  const importExcelIssues = async (file) => {
    if (!file) return;
    setIssueImportStatus({
      running: true,
      fileName: file.name || '问题台账',
      step: 0,
      importedCount: 0,
    });
    try {
      const formData = new FormData();
      formData.append('file', file);
      window.setTimeout(() => {
        setIssueImportStatus(prev => (prev.running ? { ...prev, step: Math.max(prev.step, 1) } : prev));
      }, 450);
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/issues/import-excel`, {
        method: 'POST',
        body: formData,
      });
      setIssueImportStatus(prev => ({
        ...prev,
        step: ISSUE_IMPORT_STEPS.length - 1,
        importedCount: data.importedCount || 0,
      }));
      hydrateMeetingDetail(data.meeting);
      setAgendaGenerated(true);
      setSelectedIssueIds((data.meeting?.agendaDrafts || []).map(item => item.id).filter(Boolean));
      await loadMeetings();
      const providerText = data.aiProvider === 'deepseek' ? 'DeepSeek 已真实提炼议题' : '已用本地规则兜底提炼议题';
      message.success(`已导入 ${data.importedCount || 0} 条问题，${providerText}`);
    } catch (error) {
      message.warning(`Excel 台账未写入后端：${error.message}`);
    } finally {
      window.setTimeout(() => {
        setIssueImportStatus({
          running: false,
          fileName: '',
          step: 0,
          importedCount: 0,
        });
      }, 900);
    }
  };

  const copyIssueCollectUrl = async () => {
    try {
      if (!meetingCreated) {
        const data = await authFetchJson('/api/meetings', {
          method: 'POST',
          body: JSON.stringify({
            id: currentMeetingId,
            title: meetingTitle || 'AI 会议问题收集',
            project: projectName || '本地事项',
            projectCode,
            agenda: agendaTitle || '待梳理议题',
            date: meetingDate,
            type: meetingOrg,
            meetingMode,
            phase: '问题收集中',
            issueSources: chatMessages,
            agendaDrafts: selectedIssueCards.length ? selectedIssueCards : activeIssueCards,
          }),
        });
        hydrateMeetingDetail(data.meeting);
        await loadMeetings();
      }
      await navigator.clipboard?.writeText(issueCollectShareUrl);
      message.success(`问题收集链接已复制，提交会回到当前会议：${currentMeetingId}`);
    } catch (error) {
      message.warning(`收集链接复制失败：${error.message}`);
    }
  };

  const copyRecorderUrl = async () => {
    try {
      await navigator.clipboard?.writeText(recorderQrUrl);
      message.success('手机录音邀请链接已复制');
    } catch {
      message.info('请手动复制手机录音页链接');
    }
  };

  const createMeeting = async () => {
    if (!meetingDate) {
      message.warning('请选择会议日期');
      return;
    }
    if (!meetingTitle.trim()) {
      message.warning('请输入会议名称');
      return;
    }
    // 议题来源：AI勾选 + 手动添加，至少有一个
    const allAgendaItems = [...selectedIssueCards, ...manualAgendaItems];
    if (!allAgendaItems.length && !agendaTitle.trim()) {
      message.warning('请至少添加一个议题（勾选 AI 议题或手动输入）');
      return;
    }
    const meetingAgendaTitle = (selectedAgendaTitle || agendaTitle || allAgendaItems.map(i => i.title).join('；')).trim();
    const resolvedMeetingSubject = projectName.trim() || allAgendaItems[0]?.title || meetingAgendaTitle || '本次会议';
    // 新建会议始终生成新 ID，不复用 URL 带入的旧 meetingId
    const recordId = createLocalMeetingId();
    try {
      const data = await authFetchJson('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          id: recordId,
          title: meetingTitle,
          project: resolvedMeetingSubject,
          projectCode,
          agenda: meetingAgendaTitle,
          date: meetingDate,
          type: meetingOrg,
          meetingMode,
          phase: '会前确认',
          issueSources: chatMessages,
          agendaDrafts: [...selectedIssueCards, ...manualAgendaItems],
        }),
      });
      hydrateMeetingDetail(data.meeting);
      setMeetingCreated(true);
      setActiveStage('collect');
      setProjectBound(data.meeting.projectBound || false);
      setAgendaFrozen(data.meeting.agendaFrozen || false);
      setRecording(false);
      setReviewDone(data.meeting.reviewDone || false);
      setArchiveDone(data.meeting.archiveDone || false);
      await loadMeetings();
      message.success('会议批次已创建并保存，进入会前议题确认');
    } catch (error) {
      setCurrentMeetingId(recordId);
      setMeetingCreated(true);
      setActiveStage('collect');
      setMeetingRecords(prev => {
        const nextRecord = {
          id: recordId,
          title: meetingTitle,
          project: resolvedMeetingSubject,
          projectCode,
          agenda: meetingAgendaTitle,
          date: meetingDate,
          type: meetingOrg,
          meetingMode,
          creator: currentUserLabel,
          createdAt: createLocalTimestamp(),
          phase: '会前确认',
          statusColor: 'green',
          issueCount: allAgendaItems.length,
        };
        const exists = prev.some(item => item.id === recordId);
        return exists ? prev.map(item => (item.id === recordId ? nextRecord : item)) : [nextRecord, ...prev];
      });
      message.warning(`会议已临时创建，但未保存到后端：${error.message}`);
    }
  };

  const openNewMeetingDraft = () => {
    setMeetingWorkspaceOpen(true);
    setMeetingCreated(false);
    const nextDate = createLocalDate();
    setCurrentMeetingId(createLocalMeetingId());
    setProjectName('');
    setProjectCode(`LOCAL-${nextDate.replaceAll('-', '')}-001`);
    setMeetingDate(nextDate);
    setMeetingTitle('');
    setMeetingOrg('普通企业会议');
    setMeetingMode('normal');
    setAgendaTitle('');
    setSelectedIssueId('issue-001');
    setSelectedIssueIds([]);
    setAgendaGenerated(false);
    setChatMessages([]);
    setAgendaDrafts([]);
    setMeetingMaterials([]);
    setProjectBound(false);
    setAgendaFrozen(false);
    setRecording(false);
    setReviewDone(false);
    setArchiveDone(false);
    setMeetingNotes('');
    setMeetingMarkers([]);
    setManualAgendaItems([]);
    setNewAgendaInput('');
  };

  const openMeetingRecord = async (record) => {
    setMeetingWorkspaceOpen(true);
    hydrateMeetingDetail({
      ...record,
      issueSources: chatMessages,
      agendaDrafts: activeIssueCards,
    });
    await loadMeetingDetail(record.id);
  };

  const deleteMeetingRecord = async (recordId) => {
    try {
      await authFetchJson(`/api/meetings/${recordId}`, { method: 'DELETE' });
      setMeetingRecords(prev => prev.filter(item => item.id !== recordId));
      message.success('已从列表归档该会议，录音和转写不会被删除');
    } catch (error) {
      setMeetingRecords(prev => prev.filter(item => item.id !== recordId));
      message.warning(`后端归档失败，仅本地移除：${error.message}`);
    }
  };

  const confirmDeleteMeetingRecord = (record) => {
    Modal.confirm({
      title: '删除会议批次',
      content: `确认从列表归档"${record.title}"？该操作不会删除录音、转写或归档文件。`,
      okText: '归档',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deleteMeetingRecord(record.id),
    });
  };

  const persistStage = async (nextStage, phase) => {
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage: nextStage, phase }),
      });
      hydrateMeetingDetail(data.meeting);
      await loadMeetings();
      return true;
    } catch (error) {
      message.warning(`阶段状态未写入后端：${error.message}`);
      return false;
    }
  };

  // 持久化议题到后端
  const saveAgendaDrafts = async (drafts) => {
    if (!currentMeetingId) return;
    try {
      await authFetchJson(`/api/meetings/${currentMeetingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ agendaDrafts: drafts }),
      });
    } catch (err) {
      console.warn('议题保存失败:', err);
    }
  };

  const bindCurrentProject = async () => {
    setProjectBound(true);
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ projectBound: true, project: projectName, projectCode }),
      });
      hydrateMeetingDetail(data.meeting);
      await loadMeetings();
      message.success('本地项目已绑定到当前会议');
    } catch (error) {
      message.warning(`本地项目仅临时绑定：${error.message}`);
    }
  };

  const uploadMeetingMaterial = async (materialName, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('material_name', materialName);
    setMaterialUploading(materialName);
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/materials/upload`, {
        method: 'POST',
        body: formData,
      });
      hydrateMeetingDetail(data.meeting);
      await loadMeetings();
      message.success(`已上传：${materialName}`);
    } catch (error) {
      message.error(`材料上传失败：${error.message}`);
    } finally {
      setMaterialUploading('');
    }
  };

  const downloadMeetingMaterial = async (material) => {
    if (!material?.downloadUrl) return;
    try {
      const headers = new Headers();
      const token = getStoredToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(material.downloadUrl, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = material.fileName || material.name || 'meeting-material';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(`材料下载失败：${error.message}`);
    }
  };

  const downloadArchiveDocx = async () => {
    try {
      const headers = new Headers();
      const token = getStoredToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(`/api/meetings/${currentMeetingId}/archive/docx`, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const safeTitle = (meetingTitle || currentMeetingId).replace(/[\\/:*?"<>|]/g, '_');
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeTitle}_红头会议纪要.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success('已下载可编辑红头 DOCX');
    } catch (error) {
      message.error(`红头 DOCX 下载失败：${error.message}`);
    }
  };

  const saveMeetingMarker = async (markerLabel, markerAgenda, latestTranscript) => {
    const markerTypeMap = { '标决议': 'decision', '记待办': 'todo', '有争议': 'dispute', '缺材料': 'material' };
    const markerType = markerTypeMap[markerLabel] || 'event';
    const hasTranscript = Boolean(latestTranscript?.text || latestTranscript?.transcript);
    try {
      await authFetchJson(`/api/meetings/${currentMeetingId}/markers`, {
        method: 'POST',
        body: JSON.stringify({
          marker_type: markerType,
          agenda_id: markerAgenda?.id || '',
          agenda_title: markerAgenda?.title || agendaTitle,
          transcript_id: hasTranscript ? (latestTranscript?.id || '') : '',
          transcript_text: hasTranscript ? (latestTranscript?.text || latestTranscript?.transcript || '') : '',
          transcript_time: hasTranscript ? (latestTranscript?.time || latestTranscript?.clientTime || latestTranscript?.serverTime?.slice(11, 19) || '') : '',
          transcript_speaker: hasTranscript ? (latestTranscript?.speaker || latestTranscript?.speakerName || latestTranscript?.username || '') : '',
        }),
      });
      loadMeetingMarkers();
    } catch (err) {
      message.warning(`标记保存失败：${err.message}`);
    }
  };

  const loadMeetingMarkers = async () => {
    if (!currentMeetingId) return;
    try {
      const data = await authFetchJson(`/api/meetings/${currentMeetingId}/markers`);
      setMeetingMarkers(data.markers || []);
    } catch (_) {
      // silent for polling
    }
  };

  const deleteMeetingMarker = async (markerId) => {
    try {
      await authFetchJson(`/api/meetings/${currentMeetingId}/markers/${markerId}`, { method: 'DELETE' });
      setMeetingMarkers(prev => prev.filter(m => m.id !== markerId));
      message.success('标记已删除');
    } catch (err) {
      message.warning(`标记删除失败：${err.message}`);
    }
  };

  const updateTranscriptSpeaker = async (transcriptId, speakerName, speakerRole, speakerDept) => {
    try {
      await authFetchJson(`/api/meeting/transcripts/${currentMeetingId}/${transcriptId}/speaker`, {
        method: 'POST',
        body: JSON.stringify({ speakerName, speakerRole, speakerDept: speakerDept || '' }),
      });
      // 乐观更新本地转写列表
      setRemoteTranscripts(prev => prev.map(item =>
        item.id === transcriptId
          ? { ...item, speakerName, speakerRole, speakerDept: speakerDept || '' }
          : item));
      message.success(`发言人已更新为 ${speakerName}`);
    } catch (err) {
      message.warning(`发言人更新失败：${err.message}`);
    }
  };

  const handleAgendaTimer = async (agendaId, action, extra = {}) => {
    try {
      const params = new URLSearchParams({ action, ...extra });
      const data = await authFetchJson(
        `/api/meetings/${currentMeetingId}/agenda-timer/${agendaId}?${params}`,
        { method: 'POST' },
      );
      const drafts = data.agendaDrafts || [];
      // 找到活跃议题的信息
      const active = drafts.find(d => d.timerStartedAt);
      if (active && action !== 'reset' && action !== 'extend') {
        setAgendaTimerActive(true);
        setAgendaTimerSeconds(0);
      } else if (active && action === 'extend') {
        // 延长时保持当前计时不重置
        setAgendaTimerActive(true);
      } else if (action === 'reset') {
        setAgendaTimerActive(false);
        setAgendaTimerSeconds(0);
      }
      // 更新本地的 agendaDrafts 以获取最新 duration
      if (drafts.length) {
        setAgendaDrafts(prev => prev.map(d => {
          const updated = drafts.find(nd => nd.id === d.id);
          return updated ? { ...d, ...updated } : d;
        }));
      }
      if (action === 'advance' && data.activeAgendaId) {
        setActiveMeetingAgendaId(data.activeAgendaId);
        // 自动为新议题开始计时
        setAgendaTimerActive(true);
        setAgendaTimerSeconds(0);
        message.success('已切换到下一个议题，自动开始计时');
      } else if (action === 'extend') {
        message.success(`议题已延长 ${extra.extend_minutes || 5} 分钟`);
      }
    } catch (err) {
      message.warning(`计时器操作失败：${err.message}`);
    }
  };

  // 议题倒计时
  useEffect(() => {
    if (!agendaTimerActive) return;
    agendaTimerRef.current = window.setInterval(() => {
      setAgendaTimerSeconds(prev => prev + 1);
    }, 1000);
    return () => {
      if (agendaTimerRef.current) window.clearInterval(agendaTimerRef.current);
    };
  }, [agendaTimerActive]);

  const startEditingRecords = () => {
    setEditedRecords({
      summary: [...(meetingGeneratedRecords?.summary || [])],
      minutes: (meetingGeneratedRecords?.minutes || []).map(item => ({ ...item })),
      decisions: (meetingGeneratedRecords?.decisions || []).map(item => ({ ...item })),
      todos: (meetingGeneratedRecords?.todos || []).map(item => ({ ...item })),
    });
    setEditingRecords(true);
  };

  const saveEditedRecords = async () => {
    if (!editedRecords) return;
    setSavingRecords(true);
    try {
      await authFetchJson(`/api/meetings/${currentMeetingId}/records/update`, {
        method: 'POST',
        body: JSON.stringify(editedRecords),
      });
      setMeetingGeneratedRecords(prev => prev ? { ...prev, ...editedRecords } : editedRecords);
      setEditingRecords(false);
      setEditedRecords(null);
      message.success('会议记录已保存，导出 DOCX 将使用最新修订。');
    } catch (err) {
      message.error(`保存失败：${err.message}`);
    } finally {
      setSavingRecords(false);
    }
  };

  const runStageAction = async () => {
    if (activeStage === 'collect') {
      setProjectBound(true);
      setAgendaFrozen(true);
      setActiveStage('meeting');
      setRecording(true);
      await persistStage('meeting', '会中记录');
      message.success('议题已冻结，会议录音与声纹识别已启动');
      // 自动弹出扫码邀请二维码
      window.setTimeout(() => setRecorderInviteOpen(true), 500);
      return;
    }
    if (activeStage === 'meeting') {
      await stopAndUploadDesktopAudio();
      setRecording(false);
      setActiveStage('audit');
      await persistStage('audit', '会后终审');
      const hideLoading = message.loading('AI 正在分析全部转写，提取待办事项和会议纪要…', 0);
      try {
        const records = await loadGeneratedMeetingRecords();
        const todoCount = (records?.todos || []).length;
        hideLoading();
        if (todoCount > 0) {
          message.success(`AI 已提取 ${todoCount} 个待办事项，请查看会议决议面板`);
        } else {
          message.info('会议已结束。待办事项可在终审页面手动生成。');
        }
      } catch (_) {
        hideLoading();
        message.success('会议已结束，进入会后终审拦截');
      }
      return;
    }
    if (activeStage === 'audit') {
      if (effectiveMissingMaterialCount > 0) {
        message.warning(`还有 ${effectiveMissingMaterialCount} 项材料未上传，不能通过终审`);
        return;
      }
      setReviewDone(true);
      setActiveStage('archive');
      await persistStage('archive', '已归档');
      message.success(isMajorMeeting ? '材料缺口已补齐，终审通过' : '会后材料已整理，进入归档');
      return;
    }
    setArchiveDone(true);
    await persistStage('archive', '已归档');
    message.success('红头纪要、电子签和防伪归档包已生成');
  };

  if (!meetingWorkspaceOpen) {
    return (
      <div className="meeting-compliance-page" style={{ height: '100%', padding: 16, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <section style={{ ...panelStyle, padding: 16, flex: '0 0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14, alignItems: 'center' }}>
              <div>
                <Space size={8} wrap style={{ marginBottom: 8 }}>
                  <StatusPill color="blue">AI 会议管理</StatusPill>
                  <StatusPill color="default">{meetingRecords.length} 个会议批次</StatusPill>
                  <StatusPill color={meetingDataReady ? 'green' : 'orange'}>{meetingsLoading ? '同步中' : meetingDataReady ? '已连接真实数据' : '本地兜底'}</StatusPill>
                </Space>
                <Title level={3} style={{ margin: 0, color: palette.ink }}>会议列表</Title>
                <div style={{ marginTop: 7, color: palette.muted, fontSize: 13, lineHeight: 1.65 }}>
                  先管理会议批次，再进入问题收集、AI 议题池和会中录音。列表保留创建时间、创建人和当前阶段，方便秘书回到草稿继续处理。
                </div>
              </div>
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openNewMeetingDraft} style={{ height: 44, fontWeight: 600 }}>
                创建 AI 会议
              </Button>
            </div>
          </section>

          <main style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
            {meetingsLoading ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[1, 2, 3].map(n => (
                  <Skeleton key={n} active paragraph={{ rows: 2 }} />
                ))}
              </div>
            ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {meetingRecords.map(record => (
                <div key={record.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,1fr) 150px 150px 120px 190px', gap: 12, alignItems: 'center', padding: 14, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text strong style={{ color: palette.ink, fontSize: 15 }}>{record.title}</Text>
                      <Tag color={record.statusColor} style={{ margin: 0 }}>{record.phase}</Tag>
                      {record.meetingMode === 'major' && <Tag color="red" style={{ margin: 0 }}>三重一大</Tag>}
                    </div>
                    <div style={{ marginTop: 6, color: palette.muted, fontSize: 12, lineHeight: 1.6 }}>
                      {record.project} · {record.agenda}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: palette.muted, fontSize: 12 }}>会议日期</div>
                    <div style={{ marginTop: 4, color: palette.ink, fontWeight: 600 }}>{record.date}</div>
                  </div>
                  <div>
                    <div style={{ color: palette.muted, fontSize: 12 }}>创建人</div>
                    <div style={{ marginTop: 4, color: palette.ink, fontWeight: 600 }}>{record.creator}</div>
                  </div>
                  <div>
                    <div style={{ color: palette.muted, fontSize: 12 }}>议题数</div>
                    <div style={{ marginTop: 4, color: palette.ink, fontWeight: 600 }}>{record.issueCount} 个</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => openMeetingRecord(record)}>编辑</Button>
                    <Button size="small" icon={<FolderOpenOutlined />} onClick={() => openMeetingRecord(record)}>进入</Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDeleteMeetingRecord(record)}>删除</Button>
                  </div>
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, paddingTop: 10, borderTop: `1px solid ${palette.line}` }}>
                    <span style={{ color: palette.muted, fontSize: 12 }}>创建时间</span>
                    <span style={{ color: palette.text, fontSize: 12 }}>{record.createdAt}</span>
                  </div>
                </div>
              ))}
              {!meetingRecords.length && (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <Empty description="暂无会议批次" />
                  <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openNewMeetingDraft} style={{ marginTop: 16 }}>
                    创建第一个 AI 会议
                  </Button>
                </div>
              )}
            </div>
            )}
          </main>
        </div>
        
      </div>
    );
  }

  if (!meetingCreated) {
    return (
      <div className="meeting-compliance-page" style={{ height: '100%', padding: 16, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
        <div className="meeting-create-layout" style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(330px, 0.9fr) minmax(380px, 1fr) minmax(360px, 0.95fr)', gridTemplateRows: 'minmax(0, 1fr)', gap: 12 }}>
          <section style={{ ...panelStyle, padding: 18, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <Space size={8} wrap>
                <StatusPill color="blue">01 问题收集</StatusPill>
                <StatusPill color="default">群聊 / 图片 / 单据</StatusPill>
              </Space>
              <button type="button" className="ant-btn ant-btn-sm ant-btn-default" style={{ borderRadius: 8, height: 32, paddingInline: 15, cursor: 'pointer', border: '1px solid #d9d9d9', background: '#fff', fontWeight: 500, fontSize: 14 }} onClick={handleBackToList}>返回列表</button>
            </div>
            <Title level={3} style={{ margin: 0, color: palette.ink }}>先收集碰到的问题</Title>
            <div style={{ marginTop: 8, color: palette.muted, lineHeight: 1.6, fontSize: 13 }}>
              参会部门不用先填会议表。先把现场问题、资金疑点、图片单据像群聊一样扔进来，AI 再聚类成可上会的议题。
            </div>

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Button icon={<DownloadOutlined />} onClick={downloadIssueTemplate} style={{ height: 38, fontWeight: 600 }}>
                下载模板
              </Button>
              <input
                id="meeting-issue-excel-input"
                type="file"
                accept=".xlsx,.csv"
                style={{ display: 'none' }}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  importExcelIssues(file);
                }}
              />
              <Button
                icon={<FileExcelOutlined />}
                loading={issueImportRunning}
                disabled={issueGenerationRunning}
                onClick={() => document.getElementById('meeting-issue-excel-input')?.click()}
                style={{ height: 38, fontWeight: 600 }}
              >
                {issueImportRunning ? 'AI 提炼中' : '上传台账'}
              </Button>
              <Button icon={<ShareAltOutlined />} onClick={copyIssueCollectUrl} style={{ height: 38, fontWeight: 600 }}>
                复制收集链接
              </Button>
            </div>
            <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: isDarkMode ? '#172033' : '#f8fafc', border: `1px solid ${palette.line}`, color: palette.muted, fontSize: 12, lineHeight: 1.55 }}>
              浙政钉、企业微信里的问题不用对接接口：发收集链接给部门填写，或下载模板后让部门按列填写再上传；零散聊天内容可直接粘贴到下方输入框。
            </div>

            <div style={{ marginTop: 14, flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 9 }}>
              {renderIssueSourceGroups()}
            </div>

            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 38px', gap: 8, flexShrink: 0 }}>
              <Input value={chatInput} onChange={e => setChatInput(e.target.value)} onPressEnter={addChatMessage} placeholder="粘贴群聊、表格行或继续补充问题" />
              <Button type="primary" icon={<SendOutlined />} onClick={addChatMessage} />
            </div>
          </section>

          <section className="meeting-issue-pool" style={{ ...panelStyle, padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div className="meeting-issue-pool-head">
              <div className="meeting-issue-pool-icon">
                <RobotOutlined />
              </div>
              <div className="meeting-issue-pool-copy">
                <div className="meeting-issue-pool-title">
                  <span>{agendaGenerated ? `AI 已整理出 ${activeIssueCards.length} 个开会待办` : '等待生成开会待办'}</span>
                </div>
                <div className="meeting-issue-pool-desc">收集完成后点击生成，再勾选要纳入本次会议的议题。</div>
              </div>
              <Button size="small" type={agendaGenerated ? 'default' : 'primary'} icon={<RobotOutlined />} onClick={generateAgendaFromCollectedIssues} loading={agendaGenerating} disabled={!chatMessages.length || issueGenerationRunning}>
                {agendaGenerating ? '生成中' : (agendaGenerated ? '重新生成' : '生成待办')}
              </Button>
            </div>

            <div className="meeting-issue-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {issueGenerationRunning && (
                <div className="meeting-ai-generating-card">
                  <div className="meeting-ai-generating-orb">
                    <MeetingAiPulse active />
                    <span />
                    <span />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ color: palette.ink, fontWeight: 700, fontSize: 15 }}>DeepSeek 正在生成议题</div>
                      <StatusPill color="processing">{ISSUE_IMPORT_STEPS[issueImportStatus.step]}</StatusPill>
                    </div>
                    <div style={{ marginTop: 7, color: palette.muted, fontSize: 12, lineHeight: 1.6 }}>
                      已收到《{issueImportStatus.fileName}》，正在读取问题、梳理开会待办、按会议性质生成候选项。请保持页面打开。
                    </div>
                    <div className="meeting-ai-generating-track" style={{ marginTop: 12 }}>
                      <i style={{ width: `${Math.max(18, ((issueImportStatus.step + 1) / ISSUE_IMPORT_STEPS.length) * 100)}%` }} />
                    </div>
                    <div className="meeting-ai-generating-steps">
                      {ISSUE_IMPORT_STEPS.map((step, index) => (
                        <span key={step} className={index <= issueImportStatus.step ? 'is-active' : ''}>
                          {step}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {!agendaGenerated && (
                <div style={{ padding: 22, borderRadius: 12, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, lineHeight: 1.75, textAlign: 'center' }}>
                  <div style={{ color: palette.ink, fontWeight: 700 }}>等待生成开会待办</div>
                  <div style={{ marginTop: 6 }}>先让各部门提交完问题，再点击上方"生成待办"。系统会根据当前 {chatMessages.length} 条素材生成最终候选议题。</div>
                  <Button type="primary" icon={<RobotOutlined />} onClick={generateAgendaFromCollectedIssues} loading={agendaGenerating} disabled={!chatMessages.length || issueGenerationRunning} style={{ marginTop: 12 }}>
                    {agendaGenerating ? '生成中' : '生成开会待办'}
                  </Button>
                </div>
              )}
              {agendaGenerated && activeIssueCards.map((item, index) => {
                const selected = selectedIssueIds.includes(item.id);
                const dynamicTitle = item.title;
                const dynamicProject = item.id === 'issue-001' ? (projectName || '本次会议') : item.project;
                const todoText = item.todoText || (item.changes || []).find(change => String(change).startsWith('生成待办：'))?.replace('生成待办：', '') || (isMajorMeeting ? '补材料、定责任人、安排会议审议' : '确认讨论范围，安排会议讨论');
                const riskColor = isMajorMeeting ? (item.risk === '高风险' ? 'red' : 'orange') : 'blue';
                const riskText = isMajorMeeting ? item.risk : '普通议题';
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={selected ? 'meeting-issue-row is-selected' : 'meeting-issue-row'}
                    aria-pressed={selected}
                    onClick={() => toggleIssueSelection(item)}
                  >
                    <div className="meeting-issue-row-index">{String(index + 1).padStart(2, '0')}</div>
                    <div className="meeting-issue-row-main">
                      <div className="meeting-issue-row-top">
                        <div className="meeting-issue-row-title">{dynamicTitle}</div>
                        <Tag color={riskColor} className="meeting-issue-risk-tag">{riskText}</Tag>
                      </div>
                      <div className="meeting-issue-row-meta">
                        <span>{isMajorMeeting ? '事项' : '来源'}：<strong>{dynamicProject}</strong></span>
                        <span>{item.type}</span>
                        <span>{item.source}</span>
                      </div>
                      <div className="meeting-issue-row-todo">
                        <span>下一步</span>
                        <strong>{todoText}</strong>
                      </div>
                    </div>
                    <span className="meeting-issue-row-check" aria-hidden="true">
                      {selected ? <CheckCircleOutlined /> : null}
                    </span>
                  </button>
                );
              })}
              {agendaGenerated && !activeIssueCards.length && (
                <div style={{ padding: 22, borderRadius: 12, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, lineHeight: 1.7, textAlign: 'center' }}>
                  还没有生成议题。先在左侧粘贴问题，或下载 Excel 模板后上传台账，AI 会把素材整理成可上会事项。
                </div>
              )}
            </div>

            <div className="meeting-issue-flow-note" style={{ flexShrink: 0 }}>
              <CheckCircleOutlined />
              <div>
                {(() => {
                  const plannedItems = [...selectedIssueCards, ...manualAgendaItems];
                  return (
                    <>
                <div className="meeting-issue-flow-title">已勾选 {plannedItems.length} 个议题：{plannedItems.length ? plannedItems.map(item => item.title).join('、') : '等待选择'}</div>
                <div className="meeting-issue-flow-desc">确认后这些议题会一起进入会议议程，再冻结议程、发手机录音链接。AI 议题需在上方勾选，手动议题可在右侧直接输入。</div>
                {plannedItems.length > 0 && (
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    {plannedItems.map((item, idx) => {
                      const isManual = item.source === 'manual';
                      return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <Tag color={isManual ? 'green' : 'blue'} style={{ margin: 0 }}>{isManual ? '手动' : `议题${idx + 1}`}</Tag>
                        <span style={{ flex: 1, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                        <Select
                          size="small"
                          value={item.durationMinutes || 15}
                          onChange={val => {
                            if (isManual) {
                              setManualAgendaItems(prev => prev.map(d => d.id === item.id ? { ...d, durationMinutes: val } : d));
                            } else {
                              setAgendaDrafts(prev => prev.map(d => d.id === item.id ? { ...d, durationMinutes: val } : d));
                            }
                          }}
                          style={{ width: 80 }}
                          options={[5, 10, 15, 20, 25, 30, 45, 60].map(m => ({ label: `${m}分钟`, value: m }))}
                        />
                        {isManual && (
                          <span onClick={() => setManualAgendaItems(prev => prev.filter(x => x.id !== item.id))}
                            style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1 }} title="删除">×</span>
                        )}
                      </div>
                      );
                    })}
                    <div style={{ color: '#64748b', marginTop: 2 }}>
                      ⏱ 预计总时长：{plannedItems.reduce((sum, item) => sum + (item.durationMinutes || 15), 0)} 分钟
                    </div>
                  </div>
                )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* 手动添加议题（无需 AI，直接进左侧议程） */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e2e8f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input value={newAgendaInput} onChange={e => setNewAgendaInput(e.target.value)}
                  placeholder="手动输入议题后回车 / 点添加（无需 AI）" size="middle"
                  style={{ borderRadius: 8, flex: 1 }}
                  onPressEnter={() => {
                    if (newAgendaInput.trim()) {
                      setManualAgendaItems(prev => [...prev, { id: `m-${Date.now()}`, title: newAgendaInput.trim(), type: '手动', risk: '普通', source: 'manual' }]);
                      setNewAgendaInput('');
                    }
                  }} />
                <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => {
                  if (newAgendaInput.trim()) {
                    setManualAgendaItems(prev => [...prev, { id: `m-${Date.now()}`, title: newAgendaInput.trim(), type: '手动', risk: '普通', source: 'manual' }]);
                    setNewAgendaInput('');
                  }
                }}>添加议题</Button>
              </div>
            </div>
          </section>

          <section className="meeting-create-panel" style={{ ...panelStyle }}>
            <div className="meeting-create-panel-scroll">
              <Title level={3} style={{ margin: 0, color: palette.ink }}>创建 AI 会议</Title>
              <div style={{ marginTop: 6, color: palette.muted, fontSize: 13 }}>
                填写会议基本信息后开始会前准备
              </div>

              <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
                {/* 会议名称 — 大字突出 */}
                <div>
                  <div style={{ color: '#0f172a', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>会议名称</div>
                  <Input
                    value={meetingTitle}
                    onChange={e => setMeetingTitle(e.target.value)}
                    placeholder="例如：高新区二期厂房消防改造专题会"
                    size="large"
                    autoFocus
                    style={{ fontSize: 16, height: 48, borderRadius: 10 }}
                  />
                </div>

                {/* 日期 + 性质 一行 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ color: '#0f172a', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>会议日期</div>
                    <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                      size="large" style={{ height: 44, borderRadius: 10 }} />
                  </div>
                  <div>
                    <div style={{ color: '#0f172a', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>会议性质</div>
                    <div style={{ display: 'flex', gap: 0, borderRadius: 10, border: '1.5px solid #e2e8f0', overflow: 'hidden', height: 44 }}>
                      {[['normal','普通',<FileTextOutlined key="f2" style={{fontSize:16}}/>],['major','三重一大',<SafetyCertificateOutlined key="s2" style={{fontSize:16}}/>]].map(([v, label, icon]) => (
                        <button key={v} type="button" onClick={() => setMeetingMode(v)}
                          style={{ flex: 1, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: meetingMode === v ? 700 : 400,
                            background: meetingMode === v ? '#1d5fd7' : '#fff', color: meetingMode === v ? '#fff' : '#64748b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {icon}{label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 议题摘要 */}
                <div>
                  <div style={{ color: '#0f172a', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                    待上会议题 {selectedIssueCards.length + manualAgendaItems.length > 0 && `（${selectedIssueCards.length + manualAgendaItems.length} 项）`}
                  </div>
                  {(selectedIssueCards.length > 0 || manualAgendaItems.length > 0) && (
                    <div style={{ display: 'grid', gap: 4, maxHeight: 160, overflowY: 'auto', marginBottom: 6 }}>
                      {[...selectedIssueCards, ...manualAgendaItems].map((item, i) => {
                        const isManual = item.source === 'manual';
                        return (
                          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 6, fontSize: 13, color: '#334155' }}>
                            <span style={{ flex: 1 }}>{i + 1}. {item.title}</span>
                            <Tag color={isManual ? 'green' : 'blue'} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                              {isManual ? '手动' : 'AI'}
                            </Tag>
                            {isManual && (
                              <span onClick={() => setManualAgendaItems(prev => prev.filter(x => x.id !== item.id))}
                                style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1 }} title="删除">×</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!selectedIssueCards.length && !manualAgendaItems.length && (
                    <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, color: '#94a3b8', fontSize: 13, marginTop: 6 }}>
                      可勾选 AI 议题，也可在下方直接手动添加议题（无需 AI）
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="meeting-create-action-bar">
              <div />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Button size="large" onClick={() => setMeetingWorkspaceOpen(false)}>取消</Button>
                <Button type="primary" size="large" icon={<FileDoneOutlined />}
                  onClick={createMeeting}
                  disabled={!meetingTitle.trim()}>
                  {meetingTitle.trim() ? `创建会议 — ${meetingTitle}` : '请先输入会议名称'}
                </Button>
              </div>
            </div>
          </section>
        </div>
        

        <Modal
          title="保存草稿？"
          open={showExitConfirm}
          onCancel={() => setShowExitConfirm(false)}
          footer={[
            <Button key="cancel" onClick={() => setShowExitConfirm(false)}>取消</Button>,
            <Button key="discard" danger onClick={discardAndExit}>放弃草稿</Button>,
            <Button key="save" type="primary" loading={savingDraft} onClick={saveDraftAndExit}>保存草稿</Button>,
          ]}
          width={440}
          centered
        >
          <div style={{ color: palette.text, fontSize: 14, lineHeight: 1.7 }}>
            当前创建流程已有填写内容：
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {chatMessages.length > 0 && (
              <div style={{ color: palette.muted, fontSize: 13 }}>· {chatMessages.length} 条问题素材</div>
            )}
            {agendaTitle.trim() && (
              <div style={{ color: palette.muted, fontSize: 13 }}>· 议题：{agendaTitle}</div>
            )}
            {projectName.trim() && (
              <div style={{ color: palette.muted, fontSize: 13 }}>· 项目：{projectName}</div>
            )}
            {meetingTitle.trim() && (
              <div style={{ color: palette.muted, fontSize: 13 }}>· 会议标题：{meetingTitle}</div>
            )}
            {agendaGenerated && (
              <div style={{ color: palette.muted, fontSize: 13 }}>· 已生成 AI 议题池</div>
            )}
          </div>
          <div style={{ marginTop: 12, color: palette.muted, fontSize: 13, lineHeight: 1.65 }}>
            保存草稿后可返回会议列表，下次从列表进入继续编辑。放弃草稿将丢失当前所有填写内容。
          </div>
        </Modal>

      </div>
    );
  }
  const renderStageDetail = () => {
    if (activeStage === 'collect') {
      return (
        <div style={{ display: 'grid', gap: 10 }}>
          {activeIssueCards.map(item => (
            <div key={item.id} style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: palette.ink, fontWeight: 600 }}>{item.id === 'issue-001' ? agendaTitle : item.title}</div>
                  <div style={{ marginTop: 5, color: palette.muted, fontSize: 12 }}>{item.source} · {item.type}</div>
                </div>
                <StatusPill color={isMajorMeeting ? (item.risk === '高风险' ? 'red' : 'orange') : 'blue'}>{isMajorMeeting ? item.risk : '普通议题'}</StatusPill>
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: isDarkMode ? '#10213a' : '#edf5ff', border: `1px solid ${isDarkMode ? '#1d4ed8' : '#bfdbfe'}` }}>
                <span style={{ color: palette.blue, fontWeight: 600 }}>会议来源：{item.id === 'issue-001' ? (projectName || '本次会议') : item.project}</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(item.changes || []).map(change => <Tag key={change} color="default" style={{ margin: 0 }}>{change}</Tag>)}
              </div>
            </div>
          ))}
          {!activeIssueCards.length && (
            <div style={{ padding: 22, borderRadius: 10, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, lineHeight: 1.7, textAlign: 'center' }}>
              当前会议还没有议题。请先在左侧素材池补充问题，系统会生成待确认议题。
            </div>
          )}

          {/* 声纹注册区域 */}
          <VoiceprintEnrollSection
            palette={palette}
            isDarkMode={isDarkMode}
            currentUserName={currentUserName}
            currentUserRole={currentUserMeetingRole}
            currentUserDept={currentUserDept}
            participants={remoteSpeakerRows}
          />
        </div>
      );
    }

    if (activeStage === 'meeting') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ padding: 12, borderRadius: 12, background: isDarkMode ? '#0d1b31' : 'linear-gradient(135deg,#f5f9ff 0%, #ffffff 100%)', border: `1px solid ${isDarkMode ? '#1e3a5f' : '#bfdbfe'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <Space size={8} wrap>
                    <StatusPill color={recording ? 'processing' : 'gold'}>{recording ? `录音中 ${meetingElapsedText}` : '待开始录音'}</StatusPill>
                    <StatusPill color={recording ? 'blue' : 'default'}>{recording ? '声纹识别中' : '声纹待启动'}</StatusPill>
                    <StatusPill color={agendaFrozen ? 'green' : 'gold'}>{agendaFrozen ? '议程已冻结' : '议程待确认'}</StatusPill>
                  </Space>
                  <div style={{ marginTop: 9, color: palette.ink, fontWeight: 600, fontSize: 16 }}>当前议题：{agendaTitle}</div>
                  <div style={{ marginTop: 5, color: palette.muted, fontSize: 12 }}>{meetingDate} · {isMajorMeeting ? '三重一大会议' : '普通会议'} · {projectName || '本次会议'}</div>
                  <div style={{ marginTop: 5, color: palette.muted, fontSize: 13 }}>{isMajorMeeting ? 'AI 正在实时转写、提炼阶段结论，并同步检查三重一大触发条件。' : 'AI 正在实时转写、提炼阶段结论，并对照会前待办生成纪实、纪要和决议。'}</div>
                </div>
                <MeetingAiPulse active={recording} />
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text strong style={{ color: palette.ink }}>实时转写与声纹分轨</Text>
                <Button size="small" icon={<AudioOutlined />} onClick={async () => { if (recording) { await stopAndUploadDesktopAudio(); } setRecording(prev => !prev); }}>
                  {recording ? '暂停录音' : '开始录音'}
                </Button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {liveTranscriptRows.length > 0 ? liveTranscriptRows.map(line => (
                  <div key={`${line.time}-${line.speaker || line.id}`} style={{ display: 'grid', gridTemplateColumns: '54px 92px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: 10, borderRadius: 10, background: line.active ? (isDarkMode ? '#10213a' : '#eff6ff') : palette.panelBg, border: `1px solid ${line.active ? '#93c5fd' : palette.line}` }}>
                    <Text style={{ color: palette.muted, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{line.time}</Text>
                    <div>
                      <Text strong style={{ color: palette.ink, fontSize: 13 }}>{line.speaker || '未识别'}</Text>
                      <div style={{ color: palette.muted, fontSize: 11 }}>{line.role || ''}</div>
                    </div>
                    <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.65 }}>{line.text}</div>
                  </div>
                )) : (
                  <div style={{ padding: 20, textAlign: 'center', color: palette.muted, fontSize: 13, lineHeight: 1.7 }}>
                    等待手机端录音接入…<br />转写文本将实时显示在这里。
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ padding: 12, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <Text strong style={{ color: palette.ink }}>AI 实时总结</Text>
                <StatusPill color="blue">自动更新</StatusPill>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {agendaRealtimeChecks && Object.keys(agendaRealtimeChecks).length > 0 ? (
                  Object.entries(agendaRealtimeChecks).slice(0, 3).map(([agendaId, check], index) => (
                    <div key={agendaId} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, color: palette.text, fontSize: 13, lineHeight: 1.6 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 999, background: '#e8f1ff', color: palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{index + 1}</span>
                      <span>{check.reason || '正在分析议题与发言匹配度…'}</span>
                    </div>
                  ))
                ) : liveTranscriptRows.length > 0 ? (
                  [{ key: 'recording', text: '系统正在记录发言时间线，AI 将在检测到有效讨论后生成阶段结论。' },
                   { key: 'post', text: '会议结束后自动整理纪实、纪要和决议，无需手动操作。' },
                   { key: 'todos', text: '未回应的待办会自动进入会后清单，方便秘书继续跟进。' }].map((item, index) => (
                    <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, color: palette.text, fontSize: 13, lineHeight: 1.6 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 999, background: '#e8f1ff', color: palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{index + 1}</span>
                      <span>{item.text}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: palette.muted, fontSize: 13, padding: 12, textAlign: 'center' }}>
                    等待手机端录音接入，AI 将自动生成实时总结。
                  </div>
                )}
              </div>
            </div>

            {/* 实时待办提取 */}
            {realtimeTodos.length > 0 && (
              <div style={{ padding: 12, borderRadius: 12, background: isDarkMode ? '#0f2922' : '#f0fdf4', border: `1px solid ${isDarkMode ? '#16a34a' : '#86efac'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong style={{ color: isDarkMode ? '#4ade80' : '#166534' }}>📌 实时待办</Text>
                  {realtimeTodosLoading && <Spin size="small" />}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {realtimeTodos.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 1.5 }}>
                      <Tag color={t.priority === '高' ? 'red' : t.priority === '中' ? 'orange' : 'default'} style={{ margin: 0, fontSize: 10 }}>{t.priority || '中'}</Tag>
                      <span style={{ fontWeight: 600, color: palette.ink }}>{t.owner || '待定'}</span>
                      <span style={{ color: palette.text, flex: 1 }}>{t.task || t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ padding: 12, borderRadius: 12, background: isDarkMode ? '#2d2112' : '#fffbeb', border: `1px solid ${isDarkMode ? '#854d0e' : '#fde68a'}` }}>
              <Text strong style={{ color: palette.amber }}>{isMajorMeeting ? '会中合规提示' : '会中记录提示'}</Text>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {(isMajorMeeting ? [
                  ...(agendaRealtimeChecks && Object.keys(agendaRealtimeChecks).length > 0
                    ? Object.entries(agendaRealtimeChecks).slice(0, 3).map(([id, check]) => [id.slice(0, 12), check.reason || '等待实时检查结果'])
                    : [['项目名称', '已生成本地项目名称，待秘书确认是否沿用'],
                       ['材料缺口', '可研修订说明、资金来源测算表、法审意见未齐'],
                       ['程序提醒', '需提交党委会/总办会集体决策，不得临时动议直接表决']]),
                ] : [
                  ['议题回应', '优先记录是否讨论到会前待办，不做材料拦截。'],
                  ['纪要素材', '标记结论、争议和会后待办，结束后进入成果包。'],
                  ['证据沉淀', '保留手机录音、转写底稿和本人修正签名。'],
                ]).map(([title, desc]) => (
                  <div key={title} style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 8, fontSize: 12, lineHeight: 1.55 }}>
                    <span style={{ color: palette.amber, fontWeight: 600 }}>{title}</span>
                    <span style={{ color: isDarkMode ? '#fde68a' : '#92400e' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeStage === 'audit') {
      return (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 10, background: isDarkMode ? '#2d1618' : '#fff1f2', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fecdd3'}` }}>
            <div style={{ color: palette.red, fontWeight: 600 }}>合规拦截：触发三重一大但材料未闭环</div>
          <div style={{ marginTop: 6, color: isDarkMode ? '#fecaca' : '#b42318', lineHeight: 1.6 }}>系统要求先确认本地项目名称，并补齐可研修订说明、资金测算表、法务审查意见。</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            {materialRows.map((item, index) => (
              <div key={item.name} style={{ padding: 10, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ color: palette.ink, fontWeight: 600 }}>{item.name}</div>
                <div style={{ marginTop: 7, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Tag color={item.tone}>{item.status}</Tag>
                  {item.fileName && <span style={{ color: palette.muted, fontSize: 12 }}>{item.fileName}</span>}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id={`audit-stage-material-${index}`}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      uploadMeetingMaterial(item.name, file);
                    }}
                  />
                  <Button size="small" icon={<UploadOutlined />} loading={materialUploading === item.name} onClick={() => document.getElementById(`audit-stage-material-${index}`)?.click()}>
                    上传
                  </Button>
                  {item.uploaded && (
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadMeetingMaterial(item)}>
                      下载
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
        {[
          ['红头纪要', '项目信息、会议日程、A/B/C 发言和任务分工一键入模版', <FileDoneOutlined />],
          ['线上表决电子签', '班子成员投票表决并绑定个人电子签名', <SignatureOutlined />],
          ['防伪归档包', '聊天碎片、音视频原件、审查报告和水印文件打包归档', <FolderOpenOutlined />],
        ].map(([title, desc, icon]) => (
          <div key={title} style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
            <div style={{ color: palette.blue, fontSize: 20 }}>{icon}</div>
            <div style={{ marginTop: 8, color: palette.ink, fontWeight: 600 }}>{title}</div>
            <div style={{ marginTop: 6, color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
          </div>
        ))}
      </div>
    );
  };

  const getStageState = (stageKey) => {
    if (activeStage === 'collect') {
      return stageKey === 'collect' ? 'active' : 'locked';
    }
    if (activeStage === 'meeting') {
      if (stageKey === 'collect') return 'complete';
      if (stageKey === 'meeting') return 'active';
      return 'locked';
    }
    if (activeStage === 'audit') {
      if (['collect', 'meeting'].includes(stageKey)) return 'complete';
      return stageKey === 'audit' ? 'active' : 'locked';
    }
    if (['collect', 'meeting', 'audit'].includes(stageKey)) return 'complete';
    return archiveDone ? 'complete' : 'active';
  };

  const getActionText = () => {
    if (activeStage === 'collect') return '确认议题并开始会议';
    if (activeStage === 'meeting') return isMajorMeeting ? '结束会议，进入终审' : '结束会议，整理纪要';
    if (activeStage === 'audit') return isMajorMeeting ? '补齐材料并通过终审' : '确认纪要并归档';
    return archiveDone ? '已完成归档' : '生成红头文件并归档';
  };

  const currentStageCopy = {
    collect: ['会前确认 / 01 正在运行', isMajorMeeting ? '会议批次已创建，秘书核对 AI 议题、项目名称和议程范围。录音、声纹、终审、归档都没有数据源。' : '会议批次已创建，秘书核对 AI 提炼的待办议题和会议范围。录音、纪要、归档都没有数据源。'],
    meeting: ['会中 / 02 正在运行', '手机端发言实时同步到 PC，秘书只盯实时转写、会前待办是否被回应、会后会生成什么。'],
    audit: [isMajorMeeting ? '会后 / 03 正在运行' : '会后整理 / 03 正在运行', isMajorMeeting ? '会议已经结束，系统扫描会前素材、会中底稿和项目材料，缺项目或缺材料就卡住流程。' : '会议已经结束，系统对照会前待办生成会议纪实、会议纪要、会议决议和督办清单。'],
    archive: ['发文 / 04 正在运行', isMajorMeeting ? '终审红灯已经转绿，系统生成红头纪要、表决电子签和防伪归档包。' : '会议材料已确认，系统生成可编辑纪要、签署记录和归档包。'],
  }[activeStage];

  const renderStageTimeline = () => (
    <div className="meeting-stage-strip">
      {STAGES.map(stage => {
        const state = getStageState(stage.key);
        const isActive = state === 'active';
        const isComplete = state === 'complete';
        return (
          <div
            key={stage.key}
            className={`meeting-stage-card is-${state}`}
            style={{
              border: `1px solid ${isActive ? '#93c5fd' : palette.line}`,
              background: isActive ? (isDarkMode ? '#10213a' : '#eff6ff') : palette.panelSoft,
              opacity: state === 'locked' ? 0.58 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ color: isActive ? palette.blue : isComplete ? palette.green : palette.muted, fontWeight: 600, fontSize: 12 }}>{stage.no}</span>
              {isComplete ? <CheckCircleOutlined style={{ color: palette.green }} /> : isActive ? <SyncOutlined spin style={{ color: palette.blue }} /> : <ClockCircleOutlined style={{ color: palette.muted }} />}
            </div>
            <div style={{ color: palette.ink, fontWeight: 600, marginTop: 5 }}>{stage.title}</div>
            <div style={{ color: palette.muted, fontSize: 12, marginTop: 3, lineHeight: 1.35 }}>{stage.desc}</div>
          </div>
        );
      })}
    </div>
  );

  const renderChatPanel = () => (
    <section style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '11px 14px 9px', borderBottom: `1px solid ${palette.line}`, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'start', background: isDarkMode ? '#111827' : '#fbfdff' }}>
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ color: palette.ink }}><MessageOutlined style={{ color: palette.blue, marginRight: 8 }} />素材收集箱</Text>
          <div style={{ marginTop: 3, color: palette.muted, fontSize: 12, lineHeight: 1.35 }}>一行一个来源，点"查看"展开原文。</div>
        </div>
        <StatusPill color="blue">{chatMessages.length} 条</StatusPill>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'grid', alignContent: 'start', gap: 9, background: isDarkMode ? '#0f172a' : '#f8fafc' }}>
        {renderCompactIssueSourceList()}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${palette.line}`, display: 'grid', gridTemplateColumns: '1fr 40px', gap: 8, flexShrink: 0, background: palette.panelBg }}>
        <Input value={chatInput} onChange={e => setChatInput(e.target.value)} onPressEnter={addChatMessage} placeholder="粘贴一条问题或群聊原文" style={{ height: 40, borderRadius: 10 }} />
        <Button type="primary" icon={<SendOutlined />} onClick={addChatMessage} style={{ width: 40, height: 40, borderRadius: 10 }} />
      </div>
    </section>
  );

  const renderMinuteCard = () => {
    const baseData = meetingGeneratedRecords;
    const editSrc = editingRecords ? editedRecords : null;
    const summaryItems = editSrc?.summary || baseData?.summary || [];
    const chronicleItems = editSrc?.chronicle || baseData?.chronicle || [];
    const todosItems = editSrc?.todos || baseData?.todos || [];
    const minutesItems = editSrc?.minutes || baseData?.minutes || [];
    const decisionsItems = editSrc?.decisions || baseData?.decisions || [];
    const hasRecords = Boolean(baseData?.generated);

    const updateEditField = (field, index, value) => {
      if (!editedRecords) return;
      const next = { ...editedRecords };
      if (field === 'summary') {
        const arr = [...(editedRecords.summary || [])];
        arr[index] = value;
        next.summary = arr;
      } else if (field === 'minutes') {
        // minutes 结构: {agenda, status, keyPoints:[]} — 编辑时整体替换 keyPoints
        const arr = (editedRecords.minutes || []).map((m, i) => {
          if (i !== index) return m;
          const points = String(value).split('\n').map(s => s.trim()).filter(Boolean);
          return { ...m, keyPoints: points };
        });
        next.minutes = arr;
      } else if (field === 'decisions') {
        const arr = (editedRecords.decisions || []).map((d, i) => i === index ? { ...d, decision: value } : d);
        next.decisions = arr;
      } else if (field === 'todos') {
        const arr = (editedRecords.todos || []).map((t, i) => i === index ? { ...t, task: value } : t);
        next.todos = arr;
      }
      setEditedRecords(next);
    };

    const editActionBar = (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {editingRecords ? (
          <>
            <Button size="small" loading={savingRecords} type="primary" icon={<CheckCircleOutlined />} onClick={saveEditedRecords}>保存修订</Button>
            <Button size="small" onClick={() => { setEditingRecords(false); setEditedRecords(null); }}>取消</Button>
          </>
        ) : (
          hasRecords && (
            <Button size="small" icon={<EditOutlined />} onClick={startEditingRecords}>修订记录</Button>
          )
        )}
      </div>
    );

    return (
      <section style={{ ...panelStyle, padding: 14, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <Text strong style={{ color: palette.ink }}>会议记录生成</Text>
            <div style={{ marginTop: 3, color: palette.muted, fontSize: 12 }}>
              {editingRecords ? '人工修订中，未保存的修订将丢失' : (baseData?.source || '等待真实转写')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {editActionBar}
            {!editingRecords && (
              <Button size="small" icon={<SyncOutlined spin={meetingRecordsLoading} />} loading={meetingRecordsLoading} onClick={loadGeneratedMeetingRecords} style={{ borderRadius: 999 }}>
                重新生成
              </Button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {[
            ['转写', `${baseData?.transcriptCount || 0} 条`],
            ['录音', `${baseData?.audioCount || 0} 段`],
            ['来源', baseData?.aiProvider === 'deepseek' ? 'DeepSeek' : baseData?.aiProvider === 'local-rule' ? '本地整理' : '未生成'],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: '8px 9px', borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ color: palette.muted, fontSize: 11 }}>{label}</div>
              <div style={{ color: palette.ink, fontWeight: 700, marginTop: 3, fontSize: 13 }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6, marginTop: 12 }}>
          {[
            ['summary', '总结'],
            ['chapters', '纪实'],
            ['minutes', '纪要'],
            ['todos', '待办'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMinuteView(key)}
              style={{
                border: `1px solid ${minuteView === key ? '#93c5fd' : palette.line}`,
                background: minuteView === key ? (isDarkMode ? '#10213a' : '#eff6ff') : palette.panelBg,
                color: minuteView === key ? palette.blue : palette.text,
                borderRadius: 8,
                padding: '7px 8px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {!hasRecords && !editingRecords && (
            <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, lineHeight: 1.65 }}>
              {baseData?.message || '还没有真实转写，不能生成真实会议记录。请先让手机端录音并回传发言。'}
            </div>
          )}
          {minuteView === 'summary' && summaryItems.map((item, index) => (
            editingRecords ? (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'start' }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: '#e8f1ff', color: palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{index + 1}</span>
                <Input.TextArea value={item} onChange={e => updateEditField('summary', index, e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 13 }} />
              </div>
            ) : (
              <div key={item} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'start', color: palette.text, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: '#e8f1ff', color: palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{index + 1}</span>
                <span>{item}</span>
              </div>
            )
          ))}
          {minuteView === 'chapters' && (chronicleItems || []).map((item, index) => (
            <div key={`${item.time}-${item.speaker}-${index}`} style={{ padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text strong style={{ color: palette.ink, fontSize: 13 }}>{item.speaker || '参会人'} <span style={{ color: palette.muted, fontWeight: 400 }}>{item.role || ''}</span></Text>
                <Tag color={item.signed ? 'green' : 'blue'} style={{ margin: 0 }}>{item.time || '--:--'}</Tag>
              </div>
              <div style={{ marginTop: 5, color: palette.muted, fontSize: 12, lineHeight: 1.55 }}>{item.content}</div>
            </div>
          ))}
          {minuteView === 'minutes' && (() => {
            const items = minutesItems.length ? minutesItems : baseData?.minutes || [];
            return items.map((item, index) => (
              editingRecords ? (
                <div key={item.agenda || index} style={{ padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{item.agenda || item.title || `议题 ${index + 1}`}</div>
                  <Input.TextArea
                    value={Array.isArray(item.keyPoints) ? item.keyPoints.join('\n') : ''}
                    onChange={e => updateEditField('minutes', index, e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 5 }} style={{ fontSize: 13 }}
                    placeholder="每行一个要点"
                  />
                </div>
              ) : (
                <div key={item.agenda || item.title || index} style={{ padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{item.agenda || item.title || `议题 ${index + 1}`}</div>
                  <div style={{ marginTop: 5, color: palette.muted, fontSize: 12, lineHeight: 1.55 }}>
                    {(Array.isArray(item.keyPoints) && item.keyPoints.length > 0)
                      ? item.keyPoints.map((p, j) => <div key={j}>• {p}</div>)
                      : (item.status || '暂无纪要内容')}
                  </div>
                </div>
              )
            ))
          })()}
          {minuteView === 'todos' && todosItems.map((item, index) => (
            editingRecords ? (
              <div key={item.sourceTime || index} style={{ padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <Input.TextArea value={item.task || ''} onChange={e => updateEditField('todos', index, e.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="待办事项" style={{ fontSize: 13 }} />
                </div>
                <div style={{ marginTop: 5, display: 'flex', justifyContent: 'space-between', gap: 8, color: palette.muted, fontSize: 12 }}>
                  <span>{item.owner}</span>
                  <span>{item.sourceTime || item.status}</span>
                </div>
              </div>
            ) : (
              <div key={item.sourceTime || item.task || index} style={{ padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{item.task}</div>
                <div style={{ marginTop: 5, display: 'flex', justifyContent: 'space-between', gap: 8, color: palette.muted, fontSize: 12 }}>
                  <span>{item.owner}</span>
                  <span>{item.sourceTime || item.status}</span>
                </div>
              </div>
            )
          ))}
        </div>
      </section>
    );
  };

  const formatAudioSize = value => {
    const bytes = Number(value || 0);
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDuration = value => {
    const seconds = Math.max(0, Number(value || 0));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  };

  const renderMeetingResultPackage = ({ compact = false } = {}) => {
    const transcriptRows = liveTranscriptRows.slice(0, compact ? 4 : 8);
    const hasAudio = recordingPlaybackRows.length > 0;
    return (
      <section style={{ ...panelStyle, padding: compact ? 12 : 14, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <Text strong style={{ color: palette.ink }}><FolderOpenOutlined style={{ color: palette.blue, marginRight: 8 }} />会议成果包</Text>
            <div style={{ marginTop: 4, color: palette.muted, fontSize: 12, lineHeight: 1.45 }}>结束会议后统一查看录音回放、转写底稿、纪实、纪要和决议。</div>
          </div>
          <StatusPill color={hasAudio ? 'green' : transcriptRows.length ? 'blue' : 'default'}>{hasAudio ? `${recordingPlaybackRows.length} 段录音` : `${transcriptRows.length} 条转写`}</StatusPill>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <Text strong style={{ color: palette.ink }}><AudioOutlined style={{ color: palette.blue, marginRight: 6 }} />录音回放</Text>
              <Tag color={hasAudio ? 'green' : 'default'} style={{ margin: 0 }}>{hasAudio ? '可回放' : '暂无文件'}</Tag>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
              {recordingPlaybackRows.map(item => {
                const speaker = item.speaker || {};
                const url = item.playbackUrl?.startsWith('http') ? item.playbackUrl : item.playbackUrl;
                return (
                  <div key={item.id} style={{ display: 'grid', gap: 7, padding: 10, borderRadius: 9, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: palette.muted, fontSize: 12 }}>
                      <span>{speaker.displayName || speaker.username || '参会人'} · {speaker.meetingRole || '参会代表'}</span>
                      <span>{formatDuration(item.durationSeconds)} · {formatAudioSize(item.audioSize)}</span>
                    </div>
                    <MeetingAudioPlayer playbackUrl={url} audioRef={audioPlayerRef} />
                  </div>
                );
              })}
              {!hasAudio && (
                <div style={{ color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>手机端结束录音后，音频文件会自动上传到这里。旧数据只有转写和音频大小，没有真实回放文件。</div>
              )}
            </div>
          </div>

          <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <Text strong style={{ color: palette.ink }}><FileTextOutlined style={{ color: palette.blue, marginRight: 6 }} />转写底稿</Text>
              <Tag color={transcriptRows.length ? 'blue' : 'default'} style={{ margin: 0 }}>{transcriptRows.length ? `${transcriptRows.length} 条` : '暂无转写'}</Tag>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {transcriptRows.map(line => {
                // 计算音频偏移量：转写时间 - 录音开始时间
                const getAudioOffset = () => {
                  if (!line.rawTime || !recordingStartedAtRef.current) return null;
                  try {
                    const transcriptTime = new Date(line.rawTime.replace(' ', 'T')).getTime();
                    const offset = (transcriptTime - recordingStartedAtRef.current) / 1000;
                    return offset > 0 ? offset : null;
                  } catch { return null; }
                };
                const offset = getAudioOffset();
                return (
                  <div
                    key={line.id || `${line.time}-${line.speaker}-${line.text.slice(0, 8)}`}
                    onClick={() => {
                      if (offset !== null && audioPlayerRef.current?.seekTo) {
                        audioPlayerRef.current.seekTo(offset);
                      }
                    }}
                    style={{
                      display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr)', gap: 8, padding: 9, borderRadius: 9,
                      background: palette.panelBg, border: `1px solid ${palette.line}`,
                      cursor: offset !== null ? 'pointer' : 'default',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (offset !== null) e.currentTarget.style.background = isDarkMode ? '#1a2a44' : '#f0f7ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = palette.panelBg; }}
                  >
                    <span style={{ color: offset !== null ? palette.blue : palette.muted, fontSize: 12, textDecoration: offset !== null ? 'underline' : 'none' }}>{line.time}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: palette.ink, fontSize: 13, fontWeight: 700 }}>{line.speaker || '参会人'} <em style={{ color: palette.muted, fontStyle: 'normal', fontWeight: 400 }}>{line.role || line.seat || ''}</em></div>
                      <div style={{ marginTop: 4, color: palette.text, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{line.text}</div>
                    </div>
                  </div>
                );
              })}
              {!transcriptRows.length && (
                <div style={{ color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>暂无转写。请先进入会中阶段，发送手机录音链接，让参会人登录并录音。</div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {[
              ['会议纪实', transcriptRows.length ? '按时间轴沉淀，支持回看原声和转写。' : '等待转写生成。', <ClockCircleOutlined />],
              ['会议纪要', '按议题整理讨论要点、结论、责任人和截止时间。', <FileDoneOutlined />],
              ['会议决议', '生成同意、暂缓、补材料后再议等可编辑决议草稿。', <CheckCircleOutlined />],
            ].map(([title, desc, icon]) => (
              <div key={title} style={{ padding: 11, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ color: palette.blue, fontSize: 18 }}>{icon}</div>
                <div style={{ marginTop: 7, color: palette.ink, fontWeight: 700, fontSize: 13 }}>{title}</div>
                <div style={{ marginTop: 4, color: palette.muted, fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  };

  const renderCollectWorkspace = () => (
    <div className="meeting-workspace collect-workspace">
      {renderChatPanel()}
      <section style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${palette.line}` }}>
          <Text strong style={{ color: palette.ink }}><RobotOutlined style={{ color: palette.blue, marginRight: 8 }} />AI 议题生成看板</Text>
          <div style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>只处理会前输入：多对一聚类、一对多拆分、变更留痕。</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
          {renderStageDetail()}
        </div>
      </section>
    </div>
  );

  const getMeetingParticipantState = () => {
    const connectedSpeakers = remoteSpeakerRows.filter(item => item.fromRemote);
    const hostSpeaker = { name: `${currentUserName}（我）`, role: currentUserMeetingRole, status: '主持中', confidence: 100, fromHost: true };
    const liveSpeaker = connectedSpeakers.find(item => item.lastAction === 'start') || connectedSpeakers.find(item => item.fromRemote) || hostSpeaker;
    const actualParticipants = [hostSpeaker, ...connectedSpeakers.filter(item => item.name !== currentUserName && item.name !== `${currentUserName}（我）`).slice(0, 5)];
    const participantSlots = [
      ...actualParticipants,
      ...Array.from({ length: Math.max(0, 6 - actualParticipants.length) }, (_, index) => ({
        name: '待接入',
        role: index === 0 ? '发送手机录音链接后进入' : '等待参会人登录',
        status: '未接入',
        empty: true,
      })),
    ].slice(0, 6);
    const participantStrip = participantSlots.map((item, index) => ({
      ...item,
      color: item.empty ? '#f1f5f9' : ['#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#cffafe', '#ffe4e6'][index % 6],
      active: !item.empty && (item.name === liveSpeaker.name || item.lastAction === 'start'),
    }));
    return {
      connectedSpeakers,
      liveSpeaker,
      actualParticipants,
      participantStrip,
      connectedCount: actualParticipants.filter(item => !item.empty).length,
      hasRemoteParticipants: connectedSpeakers.some(item => item.fromRemote),
    };
  };

  const renderHeaderParticipantStrip = () => {
    const { participantStrip } = getMeetingParticipantState();
    return (
      <div className="meeting-header-participant-wrap">
        <div className="meeting-header-participant-strip">
          {participantStrip.map((item, index) => (
            <div key={`${item.name}-${index}`} className={`meeting-voice-chip ${item.active ? 'is-speaking' : ''} ${item.empty ? 'is-empty' : ''}`} style={{ background: item.color }}>
              <div className="meeting-video-face">{item.empty ? '+' : item.name.slice(0, 1)}</div>
              <div className="meeting-voice-chip-text">
                <strong>{item.name}</strong>
                <span>{item.empty ? '待接入' : item.role || '参会人'}</span>
              </div>
              {item.active && <em>说话中</em>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMeetingWorkspace = () => {
    const { connectedSpeakers, liveSpeaker, actualParticipants, connectedCount, hasRemoteParticipants } = getMeetingParticipantState();
    const keyEvents = isMajorMeeting
      ? [
          { time: '19:08', type: '材料缺口', color: 'orange', title: '资金来源测算表未补齐', owner: '财务部 李倩' },
          { time: '19:45', type: '待办', color: 'blue', title: '补可研修订说明', owner: '项目管理部 王明' },
          { time: '19:32', type: '合规提醒', color: 'red', title: '已触发三重一大', owner: '终审阶段复核' },
        ]
      : [
          { time: '19:08', type: '讨论进展', color: 'blue', title: '已围绕会前待办展开讨论', owner: '会议秘书' },
          { time: '19:45', type: '会后待办', color: 'green', title: '会后生成纪要与责任清单', owner: '会议秘书' },
        ];
    const markerActions = [
      ['标决议', <CheckCircleOutlined />, 'decision'],
      ['记待办', <ClockCircleOutlined />, 'todo'],
      ['有争议', <MessageOutlined />, 'dispute'],
      ...(isMajorMeeting ? [['缺材料', <FileDoneOutlined />, 'material']] : []),
    ];
    const hasMeetingSpeech = remoteTranscripts.length > 0 || remoteEvents.some(item => ['start', 'stop', 'chunk'].includes(item.action));
    const meetingElapsed = meetingElapsedText;
    const currentAiConclusion = !hasRemoteParticipants
      ? '等待参会人从手机录音链接接入，AI 将在发言后生成提醒。'
      : hasMeetingSpeech
        ? (isMajorMeeting ? '可以继续讨论，终审前必须补齐三项材料。' : '可以继续讨论，会后将生成纪实、纪要、决议和待办比对。')
        : '会议已开始，但还没有检测到有效发言，AI 暂不生成结论。';
    const visibleKeyEvents = hasMeetingSpeech ? keyEvents : [];
    const currentMaterialGapCount = hasMeetingSpeech ? effectiveMissingMaterialCount : 0;
    const aiValueCards = [
      { label: '听谁在说', value: hasMeetingSpeech ? liveSpeaker.name : '等待发言', desc: hasMeetingSpeech ? (liveSpeaker.role || '当前发言人') : '暂无有效声音', tone: palette.blue },
      { label: '抓到了什么', value: visibleKeyEvents.length, desc: hasMeetingSpeech ? '关键事件已标记' : '尚未生成事件', tone: palette.amber },
      { label: '下一步做什么', value: currentMaterialGapCount ? `补 ${currentMaterialGapCount} 项材料` : (hasMeetingSpeech ? '会后整理' : '等待发言'), desc: hasMeetingSpeech ? (currentMaterialGapCount ? '先补齐再表决' : '生成纪要与决议') : '有发言后再判断', tone: hasMeetingSpeech ? (currentMaterialGapCount ? palette.red : palette.green) : palette.muted },
    ];
    const meetingLiveRows = liveTranscriptRows;

    const agendaCheckRows = activeIssueCards.length ? activeIssueCards.slice(0, 6).map((item, index) => {
      const title = item.id === 'issue-001' ? agendaDisplayTitle : item.title;
      const id = item.id || `agenda-${index}`;
      const realtimeCheck = agendaRealtimeChecks[id];
      const relation = realtimeCheck?.relation || (remoteTranscripts.length ? 'checking' : 'waiting');
      const isResolved = relation === 'resolved';
      const isMatched = relation === 'matched';
      const isIrrelevant = relation === 'irrelevant';
      return {
        id,
        title,
        status: realtimeCheck?.status || (remoteTranscripts.length ? '判断中' : '等待讨论'),
        hint: isMatched ? `${agendaRealtimeProvider === 'deepseek' ? 'DeepSeek 语义比对' : '本地规则临时判断'}：${realtimeCheck?.reason || '命中当前议题。'}`
          : isIrrelevant ? (realtimeCheck?.reason || '已收到发言，暂未命中当前议题。')
            : agendaRealtimeLoading ? 'AI 正在判断最近发言是否关联当前议题...' : '',
        color: isResolved ? 'green' : isMatched ? 'blue' : isIrrelevant ? 'default' : remoteTranscripts.length ? 'orange' : 'default',
        relation,
      };
    }) : [{
      id: 'agenda-current',
      title: agendaDisplayTitle,
      status: agendaRealtimeChecks['agenda-current']?.status || (remoteTranscripts.length ? '判断中' : '等待讨论'),
      hint: agendaRealtimeChecks['agenda-current']?.reason || (agendaRealtimeLoading ? 'AI 正在判断最近发言是否关联当前议题...' : ''),
      color: agendaRealtimeChecks['agenda-current']?.relation === 'matched' ? 'blue' : 'default',
      relation: agendaRealtimeChecks['agenda-current']?.relation || 'waiting',
    }];
    const activeAgendaId = activeMeetingAgendaId || agendaCheckRows[0]?.id;
    const triggerAgendaMarker = (label, agendaItem = agendaCheckRows.find(item => item.id === activeAgendaId) || agendaCheckRows[0]) => {
      if (!agendaItem) return;
      setActiveMeetingAgendaId(agendaItem.id);
      setMeetingAgendaMarkers(prev => ({
        ...prev,
        [agendaItem.id]: [...(prev[agendaItem.id] || []), { label, time: new Date().toTimeString().slice(0, 8) }].slice(-6),
      }));
      setPendingMarkerTranscriptIndex(0);
      setMeetingActionType(`marker:${label}`);
    };
    const currentAgendaCount = agendaCheckRows.length || 1;
    const resultPreviewRows = [
      ['会议纪实', hasMeetingSpeech ? '按时间轴保留谁在什么时候说了什么，可回放手机录音证据。' : '等待实时转写进入后生成。'],
      ['会议纪要', hasMeetingSpeech ? '按议题生成摘要、决定事项、责任人和截止时间。' : '会后根据完整转写生成。'],
      ['会议决议', hasMeetingSpeech ? '沉淀"同意/暂缓/补材料后再议"等可编辑决议文本。' : '结束会议后根据待办比对结果生成。'],
    ];

    return (
      <div className="meeting-workspace live-workspace live-call-workspace">
        <section className="meeting-call-shell" style={{ ...panelStyle, background: isDarkMode ? '#0f172a' : '#ffffff', border: `1px solid ${palette.line}` }}>
          <div className="meeting-share-toolbar" style={{ borderBottom: `1px solid ${palette.line}` }}>
            <div className="meeting-share-topic">
              <span>当前议题：{agendaDisplayTitle}</span>
              <Button size="small" type={!isMajorMeeting ? 'primary' : 'default'} onClick={() => handleMeetingModeChange('normal')}>普通会议</Button>
              <Button size="small" danger={isMajorMeeting} type={isMajorMeeting ? 'primary' : 'default'} onClick={() => handleMeetingModeChange('major')}>三重一大</Button>
            </div>
            <div className="meeting-share-mode-actions">
              <ClockCircleOutlined />
              <span>已讨论 {hasMeetingSpeech || recording ? meetingElapsed : '00:00:00'}</span>
              {activeIssueCards.length > 0 && (() => {
                const activeAgenda = activeIssueCards.find(a => a.id === activeMeetingAgendaId) || activeIssueCards[0];
                const dur = activeAgenda?.durationMinutes || 15;
                const min = Math.floor(agendaTimerSeconds / 60);
                const sec = agendaTimerSeconds % 60;
                const remain = Math.max(0, dur - min);
                return (
                  <>
                    <span style={{ marginLeft: 12, fontSize: 12 }}>
                      <span style={{ color: remain <= 2 ? '#c24135' : remain <= 5 ? '#b45309' : '#64748b' }}>
                        议题{activeIssueCards.findIndex(a => a.id === (activeMeetingAgendaId || activeIssueCards[0]?.id)) + 1 || 1} · {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')} / {dur}分
                        {agendaTimerActive && remain <= 5 && remain > 0 && ` ⚠️ 剩余${remain}分`}
                        {agendaTimerActive && remain <= 0 && ' ⏰ 已超时'}
                      </span>
                    </span>
                    <Space size={4} style={{ marginLeft: 8 }}>
                      {!agendaTimerActive ? (
                        <Button size="small" type="primary" onClick={() => { setActiveMeetingAgendaId(activeAgenda.id); handleAgendaTimer(activeAgenda.id, 'start'); }}>开始计时</Button>
                      ) : (
                        <>
                          <Button size="small" onClick={() => handleAgendaTimer(activeAgenda.id, 'extend', { extend_minutes: 5 })}>+5分</Button>
                          {activeIssueCards.length > 1 && (
                            <Button size="small" onClick={() => handleAgendaTimer(activeAgenda.id, 'advance')}>下一议题</Button>
                          )}
                          <Button size="small" onClick={() => handleAgendaTimer(activeAgenda.id, 'reset')}>重置</Button>
                        </>
                      )}
                    </Space>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="meeting-share-stage meeting-runtime-stage">
            <section className="meeting-runtime-panel meeting-transcript-panel">
              <div className="meeting-runtime-head">
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[
                    ['chronicle', '会议纪实', meetingLiveRows.length],
                    ['minutes', '会议纪要', meetingGeneratedRecords?.minutes?.length || 0],
                    ['todos', '待办事项', meetingGeneratedRecords?.todos?.length || 0],
                  ].map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTranscriptTab(key)}
                      style={{
                        padding: '5px 14px',
                        borderRadius: 99,
                        border: transcriptTab === key ? '1.5px solid #1d5fd7' : '1px solid #e2e8f0',
                        background: transcriptTab === key ? '#eef6ff' : '#fff',
                        color: transcriptTab === key ? '#1d5fd7' : '#64748b',
                        fontSize: 13,
                        fontWeight: transcriptTab === key ? 600 : 400,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}{count > 0 ? ` ${count}` : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div className="meeting-live-transcript-list">
                {transcriptTab === 'chronicle' && (
                  meetingLiveRows.length > 0 ? (
                    <div ref={transcriptScrollRef} style={{ height: 520, overflowY: 'auto' }}>
                      {meetingLiveRows.map((line) => {
                        const speakerName = line.speaker || '参会人';
                        const speakerInitial = speakerName.slice(0, 1);
                        const speakerColor = ['#1d5fd7','#12b3a8','#e87b35','#8b5cf6','#ec4899','#0891b2'][speakerName.charCodeAt(0) % 6];
                        return (
                          <div key={line.id || `${line.time}-${speakerName}`} className="meeting-speech-card">
                            <div className="meeting-speech-avatar" style={{ background: speakerColor }}>{speakerInitial}</div>
                            <div className="meeting-speech-body">
                              <div className="meeting-speech-meta">
                                <strong>{speakerName}</strong>
                                <em>{line.role || line.seat || '参会人'}</em>
                                <span>{line.time}</span>
                              </div>
                              <div className="meeting-speech-text">{line.text}</div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={transcriptBottomRef} />
                    </div>
                  ) : (
                    <div className="meeting-runtime-empty">
                      <strong>等待手机端实时转写</strong>
                      <span>点击"扫码邀请录音"，参会人登录手机录音页并开始说话后，文本会实时回传到 PC。</span>
                    </div>
                  )
                )}
                {transcriptTab === 'minutes' && (
                  meetingGeneratedRecords?.minutes?.length > 0 ? (
                    <div style={{ height: 520, overflowY: 'auto', padding: 8 }}>
                      {meetingGeneratedRecords.minutes.map((item, i) => {
                        // item 结构: {agenda, status, keyPoints:[]}
                        const title = item.agenda || item.title || `议题 ${i + 1}`;
                        const points = Array.isArray(item.keyPoints) ? item.keyPoints : [];
                        return (
                          <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, lineHeight: 1.7, color: '#334155' }}>
                            <div style={{ fontWeight: 600, color: '#1d5fd7', marginBottom: 4 }}>{i + 1}. {title}</div>
                            {points.length > 0 ? points.map((p, j) => (
                              <div key={j} style={{ paddingLeft: 20, color: '#475569' }}>• {p}</div>
                            )) : <div style={{ paddingLeft: 20, color: '#94a3b8' }}>{item.status || '暂无要点'}</div>}
                          </div>
                        );
                      })}
                      {meetingGeneratedRecords?.summary?.length > 0 && (
                        <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
                          <strong style={{ color: '#0f172a' }}>会议摘要</strong>
                          {meetingGeneratedRecords.summary.map((s, i) => <p key={i} style={{ margin: '4px 0' }}>{s}</p>)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="meeting-runtime-empty">
                      <strong>暂无会议纪要</strong>
                      <span>结束会议后 AI 会自动生成纪要，或点击下方"生成纪要"手动触发。</span>
                    </div>
                  )
                )}
                {transcriptTab === 'todos' && (
                  <div style={{ height: 520, overflowY: 'auto', padding: 8 }}>
                    {/* 手动添加待办 */}
                    <div style={{ padding: 10, marginBottom: 10, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#0c4a6e', marginBottom: 8 }}>手动添加待办</div>
                      <Input value={newTodoText} onChange={e => setNewTodoText(e.target.value)}
                        placeholder="待办事项内容" size="small" style={{ marginBottom: 6, borderRadius: 6 }} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
                        <Input value={newTodoOwner} onChange={e => setNewTodoOwner(e.target.value)}
                          placeholder="责任人" size="small" style={{ borderRadius: 6 }} />
                        <Input value={newTodoDeadline} onChange={e => setNewTodoDeadline(e.target.value)}
                          placeholder="截止日期" size="small" style={{ borderRadius: 6 }} />
                        <Button type="primary" size="small" disabled={!newTodoText.trim()}
                          onClick={() => {
                            setManualTodos(prev => [...prev, {
                              task: newTodoText.trim(),
                              responsible: newTodoOwner.trim() || '待指定',
                              deadline: newTodoDeadline.trim() || '待定',
                              source: 'manual',
                            }]);
                            setNewTodoText(''); setNewTodoOwner(''); setNewTodoDeadline('');
                          }}
                          style={{ borderRadius: 6, whiteSpace: 'nowrap' }}>添加</Button>
                      </div>
                    </div>

                    {/* 手动待办 */}
                    {manualTodos.map((item, i) => (
                      <div key={`m-${i}`} style={{ padding: 10, marginBottom: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ background: '#22c55e', color: '#fff', borderRadius: 99, padding: '0 7px', fontSize: 11, fontWeight: 600 }}>手动 {i + 1}</span>
                          <span style={{ color: '#64748b', fontSize: 11 }}>{item.responsible}</span>
                          <span style={{ color: '#64748b', fontSize: 11, marginLeft: 'auto' }}>{item.deadline}</span>
                          <Button type="text" size="small" danger onClick={() => setManualTodos(prev => prev.filter((_,j) => j !== i))}
                            style={{ padding: 0, minWidth: 20 }}>×</Button>
                        </div>
                        <div style={{ color: '#1e293b' }}>{item.task}</div>
                      </div>
                    ))}

                    {/* AI 待办 */}
                    {(meetingGeneratedRecords?.todos || []).map((item, i) => (
                      <div key={`ai-${i}`} style={{ padding: 10, marginBottom: 6, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 99, padding: '0 7px', fontSize: 11, fontWeight: 600 }}>AI {i + 1}</span>
                          {item.responsible && <span style={{ color: '#64748b', fontSize: 11 }}>{item.responsible}</span>}
                          {item.deadline && <span style={{ color: '#64748b', fontSize: 11, marginLeft: 'auto' }}>{item.deadline}</span>}
                        </div>
                        <div style={{ color: '#1e293b' }}>{item.task || item}</div>
                      </div>
                    ))}

                    {!manualTodos.length && !(meetingGeneratedRecords?.todos || []).length && (
                      <div className="meeting-runtime-empty">
                        <strong>暂无待办事项</strong>
                        <span>线上方手动添加，或结束会议后 AI 自动从转写中提取。</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="meeting-side-stack">
              <section className="meeting-runtime-panel meeting-agenda-check-panel" style={{ maxHeight: 280 }}>
                <div className="meeting-runtime-head">
                  <div>
                    <Text strong style={{ color: palette.ink }}>本次会议议题</Text>
                    {agendaRealtimeLoading && <div>AI 正在实时比对发言与议题…</div>}
                    {!agendaRealtimeLoading && remoteTranscripts.length > 0 && (
                      <div>{agendaRealtimeProvider === 'deepseek' ? 'DeepSeek 实时判断发言与议题关联。' : '本地规则实时提示发言与议题关联。'}</div>
                    )}
                    {!remoteTranscripts.length && <div>等待手机端录音接入，AI 将自动比对发言内容。</div>}
                  </div>
                  <StatusPill color="blue">{agendaCheckRows.length} 项</StatusPill>
                </div>
                {/* 会中议题编辑区 */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setAgendaEditModal({ open: true, mode: 'add', item: null })}>
                    添加议题
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => setAgendaEditModal({ open: true, mode: 'list', item: null })}>
                    编辑议题
                  </Button>
                </div>
                <div className="meeting-agenda-timeline">
                  {(agendaCheckRows.length > 2 ? agendaCheckRows.slice(0, 2) : agendaCheckRows).map((item, index) => {
                    const isActive = item.id === activeAgendaId;
                    const rel = item.relation || 'waiting';
                    const isMatched = rel === 'matched';
                    const isIrrelevant = rel === 'irrelevant';
                    const isResolved = rel === 'resolved';
                    const isChecking = rel === 'checking';
                    const statusText = isResolved ? '已讨论' : isMatched ? '已命中' : isIrrelevant ? '未命中' : isChecking ? '判断中' : '待讨论';
                    const statusTone = isResolved ? 'is-green' : isMatched ? 'is-blue' : isIrrelevant ? 'is-orange' : isChecking ? 'is-orange' : 'is-gray';
                    const rowClass = [
                      isActive ? 'is-active' : '',
                      isResolved ? 'is-completed' : '',
                      isMatched ? 'is-matched' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`agenda-timeline-row ${rowClass}`}
                        onClick={() => setActiveMeetingAgendaId(item.id)}
                      >
                        <span className="agenda-tl-node">{isResolved ? '✓' : index + 1}</span>
                        <div className="agenda-tl-body">
                          <div className="agenda-tl-title-row">
                            {isActive && <span className="agenda-tl-badge">正在讨论</span>}
                            <strong>{item.title}</strong>
                          </div>
                          {item.hint && <em>✨ {item.hint}</em>}
                        </div>
                        <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 4 }}>{(activeIssueCards.find(a => a.id === item.id) || item).durationMinutes || 15}分</span>
                        <span className={`agenda-tl-status ${statusTone}`}>{statusText}</span>
                        <div className="agenda-tl-actions" aria-label="议题快捷标记">
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('标决议', item); }}><CheckCircleOutlined />决议</b>
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('记待办', item); }}><ClockCircleOutlined />待办</b>
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('有争议', item); }}><MessageOutlined />争议</b>
                        </div>
                      </button>
                    );
                  })}
                  {agendaCheckRows.length > 2 && (
                    <button
                      type="button"
                      className="agenda-timeline-row agenda-expand-row"
                      onClick={() => setAgendaExpandOpen(true)}
                    >
                      <span className="agenda-tl-node">+{agendaCheckRows.length - 2}</span>
                      <div className="agenda-tl-body">
                        <strong>展开全部 {agendaCheckRows.length} 项议题</strong>
                      </div>
                      <span className="agenda-tl-status is-blue">查看</span>
                    </button>
                  )}
                </div>
                {/* 议题编辑弹窗 */}
                <Modal
                  title={agendaEditModal.mode === 'add' ? '添加议题' : '编辑议题'}
                  open={agendaEditModal.open}
                  onCancel={() => setAgendaEditModal({ open: false, mode: 'list', item: null })}
                  footer={null}
                  width={480}
                >
                  {agendaEditModal.mode === 'add' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <Text style={{ display: 'block', marginBottom: 4 }}>议题名称</Text>
                        <Input
                          placeholder="输入议题名称"
                          value={agendaEditForm.title}
                          onChange={e => setAgendaEditForm(f => ({ ...f, title: e.target.value }))}
                          onPressEnter={() => {
                            if (!agendaEditForm.title.trim()) return;
                            const newId = `agenda-manual-${Date.now()}`;
                            const newItem = {
                              id: newId, title: agendaEditForm.title.trim(),
                              type: agendaEditForm.type, risk: '低',
                              durationMinutes: agendaEditForm.durationMinutes,
                              source: '会中手动添加',
                            };
                            setAgendaDrafts(prev => {
                              const next = [...prev, newItem];
                              saveAgendaDrafts(next);
                              return next;
                            });
                            setActiveMeetingAgendaId(newId);
                            setAgendaEditForm({ title: '', type: '普通', durationMinutes: 15 });
                            setAgendaEditModal({ open: false, mode: 'list', item: null });
                            message.success('议题已添加');
                          }}
                          autoFocus
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <Text style={{ display: 'block', marginBottom: 4 }}>类型</Text>
                          <Select value={agendaEditForm.type} onChange={v => setAgendaEditForm(f => ({ ...f, type: v }))} style={{ width: '100%' }}>
                            <Select.Option value="普通">普通</Select.Option>
                            <Select.Option value="重大决策">重大决策</Select.Option>
                            <Select.Option value="重大项目">重大项目</Select.Option>
                            <Select.Option value="人事任免">人事任免</Select.Option>
                            <Select.Option value="资金运作">资金运作</Select.Option>
                          </Select>
                        </div>
                        <div style={{ flex: 1 }}>
                          <Text style={{ display: 'block', marginBottom: 4 }}>预计时长（分钟）</Text>
                          <Input type="number" value={agendaEditForm.durationMinutes} min={5} max={120}
                            onChange={e => setAgendaEditForm(f => ({ ...f, durationMinutes: parseInt(e.target.value) || 15 }))} />
                        </div>
                      </div>
                      <Button type="primary" block disabled={!agendaEditForm.title.trim()} onClick={() => {
                        const newId = `agenda-manual-${Date.now()}`;
                        const newItem = {
                          id: newId, title: agendaEditForm.title.trim(),
                          type: agendaEditForm.type, risk: '低',
                          durationMinutes: agendaEditForm.durationMinutes,
                          source: '会中手动添加',
                        };
                        setAgendaDrafts(prev => {
                          const next = [...prev, newItem];
                          saveAgendaDrafts(next);
                          return next;
                        });
                        setActiveMeetingAgendaId(newId);
                        setAgendaEditForm({ title: '', type: '普通', durationMinutes: 15 });
                        setAgendaEditModal({ open: false, mode: 'list', item: null });
                        message.success('议题已添加');
                      }}>确认添加</Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                      {agendaDrafts.map((item, idx) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f9fa', borderRadius: 8 }}>
                          <span style={{ color: '#999', fontSize: 12, minWidth: 20 }}>{idx + 1}</span>
                          <Input size="small" defaultValue={item.title} style={{ flex: 1 }}
                            onPressEnter={e => {
                              const v = e.target.value.trim();
                              if (v && v !== item.title) {
                                setAgendaDrafts(prev => {
                                  const next = prev.map(d => d.id === item.id ? { ...d, title: v } : d);
                                  saveAgendaDrafts(next);
                                  return next;
                                });
                                message.success('已更新');
                              }
                            }}
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== item.title) {
                                setAgendaDrafts(prev => {
                                  const next = prev.map(d => d.id === item.id ? { ...d, title: v } : d);
                                  saveAgendaDrafts(next);
                                  return next;
                                });
                              }
                            }}
                          />
                          <Select size="small" value={item.type || '普通'} style={{ width: 90 }}
                            onChange={v => setAgendaDrafts(prev => {
                              const next = prev.map(d => d.id === item.id ? { ...d, type: v } : d);
                              saveAgendaDrafts(next);
                              return next;
                            })}>
                            <Select.Option value="普通">普通</Select.Option>
                            <Select.Option value="重大决策">重大决策</Select.Option>
                            <Select.Option value="重大项目">重大项目</Select.Option>
                          </Select>
                          <Popconfirm title="确认删除此议题？" onConfirm={() => {
                            setAgendaDrafts(prev => {
                              const next = prev.filter(d => d.id !== item.id);
                              saveAgendaDrafts(next);
                              return next;
                            });
                            message.success('已删除');
                          }} okText="删除" cancelText="取消">
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </div>
                      ))}
                      {!agendaDrafts.length && <Empty description="暂无议题" />}
                      <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setAgendaEditModal({ open: true, mode: 'add', item: null })}>
                        添加新议题
                      </Button>
                    </div>
                  )}
                </Modal>
                {/* 议题全部展开弹窗 */}
                <Modal
                  title={`本次会议议题（${agendaCheckRows.length} 项）`}
                  open={agendaExpandOpen}
                  onCancel={() => setAgendaExpandOpen(false)}
                  footer={null}
                  width={560}
                  centered
                  styles={{ body: { padding: '0 12px 12px', maxHeight: '60vh', overflow: 'auto' } }}
                >
                  {agendaCheckRows.map((item, index) => {
                    const isActive = item.id === activeAgendaId;
                    const rel = item.relation || 'waiting';
                    const isMatched = rel === 'matched';
                    const isIrrelevant = rel === 'irrelevant';
                    const isResolved = rel === 'resolved';
                    const isChecking = rel === 'checking';
                    const statusText = isResolved ? '已讨论' : isMatched ? '已命中' : isIrrelevant ? '未命中' : isChecking ? '判断中' : '待讨论';
                    const statusTone = isResolved ? 'is-green' : isMatched ? 'is-blue' : isIrrelevant ? 'is-orange' : isChecking ? 'is-orange' : 'is-gray';
                    const rowClass = [
                      isActive ? 'is-active' : '',
                      isResolved ? 'is-completed' : '',
                      isMatched ? 'is-matched' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`agenda-timeline-row ${rowClass}`}
                        style={{ width: '100%', marginTop: 4 }}
                        onClick={() => { setActiveMeetingAgendaId(item.id); setAgendaExpandOpen(false); }}
                      >
                        <span className="agenda-tl-node">{isResolved ? '✓' : index + 1}</span>
                        <div className="agenda-tl-body">
                          <div className="agenda-tl-title-row">
                            {isActive && <span className="agenda-tl-badge">正在讨论</span>}
                            <strong>{item.title}</strong>
                          </div>
                          {item.hint && <em style={{ animation: 'none' }}>✨ {item.hint}</em>}
                        </div>
                        <span className={`agenda-tl-status ${statusTone}`}>{statusText}</span>
                        <div className="agenda-tl-actions" aria-label="议题快捷标记">
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('标决议', item); }}><CheckCircleOutlined />决议</b>
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('记待办', item); }}><ClockCircleOutlined />待办</b>
                          <b onClick={(e) => { e.stopPropagation(); triggerAgendaMarker('有争议', item); }}><MessageOutlined />争议</b>
                        </div>
                      </button>
                    );
                  })}
                </Modal>
              </section>
            </div>
          </div>

          <div className="meeting-bottom-bar" style={{ background: isDarkMode ? '#111827' : '#f8fafc', borderTop: `1px solid ${palette.line}` }}>
            {[
              ['麦克风', <AudioOutlined />, recording ? 'is-on' : '', 'mic'],
              ['手机接入', <MobileOutlined />, '', 'mobile'],
              ['权限设置', <CheckCircleOutlined />, '', 'permission'],
              [`参会人 ${connectedCount}`, <UserOutlined />, '', 'participants'],
              ['聊天', <MessageOutlined />, '', 'chat'],
              ['停止共享', <ShareAltOutlined />, 'is-stop-share', 'stopShare'],
              ['录制', <ClockCircleOutlined />, recording ? 'is-on' : '', 'record'],
            ].map(([label, icon, mode, action]) => (
              <button
                key={label}
                type="button"
                className={`meeting-control-button ${mode}`}
                onClick={action === 'mobile' ? () => setRecorderInviteOpen(true) : () => setMeetingActionType(action)}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <button type="button" className="meeting-control-button" onClick={() => setMeetingActionType('evidence')}>
              <FolderOpenOutlined />
              <span>证据底稿</span>
            </button>
            <button type="button" className="meeting-leave-button" onClick={() => setMeetingActionType('endMeeting')}>结束会议</button>
          </div>

        </section>
      </div>
    );
  };

  const renderAuditWorkspace = () => {
    if (!isMajorMeeting) {
      const todos = meetingGeneratedRecords?.todos || [];
      const decisions = meetingGeneratedRecords?.decisions || [];
      const summary = meetingGeneratedRecords?.summary || [];
      const transcriptRows = liveTranscriptRows.slice(0, 20);
      const hasAudio = recordingPlaybackRows.length > 0;
      const minutesItems = meetingGeneratedRecords?.minutes || [];

      // 普通会议会后整理
      return (
        <div className="audit-layout">
          {/* 左侧：状态 + AI 纪要 */}
          <div className="audit-layout-main">
              {/* 状态栏 */}
              <section style={{ ...panelStyle, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text strong style={{ color: palette.ink, fontSize: 16 }}><FileDoneOutlined style={{ color: palette.blue, marginRight: 8, fontSize: 16 }} />03 会后整理</Text>
                  <StatusPill color={meetingGeneratedRecords?.generated ? 'green' : 'blue'}>{meetingGeneratedRecords?.generated ? 'AI 已完成' : '自动生成中'}</StatusPill>
                </div>
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                  {[
                    ['转写', `${meetingGeneratedRecords?.transcriptCount || 0} 条`],
                    ['录音', `${meetingGeneratedRecords?.audioCount || 0} 段`],
                    ['来源', meetingGeneratedRecords?.aiProvider === 'deepseek' ? 'DeepSeek' : meetingGeneratedRecords?.aiProvider === 'local-rule' ? '本地整理' : '未生成'],
                    ['Whisper 终审', whisperStatus === 'done' ? '✓ 已完成' : whisperStatus === 'running' ? '⏳ 转写中…' : meetingGeneratedRecords?.whisperEnhanced ? '✓ 已完成' : '未触发'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: '8px 9px', borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                      <div style={{ color: palette.muted, fontSize: 11 }}>{label}</div>
                      <div style={{ color: label === 'Whisper 终审' && (whisperStatus === 'done' || meetingGeneratedRecords?.whisperEnhanced) ? '#52c41a' : palette.ink, fontWeight: 700, marginTop: 3, fontSize: 13 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Button
                    type="primary"
                    icon={meetingRecordsLoading ? <SyncOutlined spin /> : <FileDoneOutlined />}
                    loading={meetingRecordsLoading}
                    onClick={generateArchiveRecords}
                    block
                    style={{ height: 40, fontWeight: 600 }}
                  >
                    {meetingGeneratedRecords?.generated ? '重新生成纪要' : 'AI 生成纪要'}
                  </Button>
                </div>
                {!meetingGeneratedRecords?.generated && !meetingRecordsLoading && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 12, lineHeight: 1.6 }}>
                    还没有真实转写，不能生成真实会议记录。请先让手机端录音并回传发言。
                  </div>
                )}
              </section>

              {/* AI 会议纪要 */}
              <section style={{ ...panelStyle, padding: 16, flex: 1, minHeight: 0, overflow: 'auto' }}>
                <Text strong style={{ color: palette.ink, fontSize: 16 }}><RobotOutlined style={{ color: palette.blue, marginRight: 8, fontSize: 16 }} />AI 会议纪要</Text>
                {meetingRecordsLoading ? (
                  <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 12, color: palette.muted, fontSize: 13 }}>AI 正在分析会议转写，生成结构化纪要…</div>
                  </div>
                ) : meetingGeneratedRecords?.generated ? (
                  <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
                    {/* 会议摘要 */}
                    <div>
                      <Text strong style={{ color: palette.ink, fontSize: 14 }}>会议摘要</Text>
                      <div style={{ marginTop: 8, color: palette.text, fontSize: 13, lineHeight: 1.8 }}>
                        {summary.length > 0
                          ? summary.slice(0, 4).map((s, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 6, marginBottom: 4 }}>
                              <span style={{ width: 16, height: 16, borderRadius: 999, background: '#e8f3ff', color: palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, marginTop: 2 }}>{i + 1}</span>
                              <span>{s}</span>
                            </div>
                          ))
                          : <div style={{ color: palette.muted }}>暂无摘要</div>}
                      </div>
                    </div>

                    {/* 会议决议 */}
                    <div>
                      <Text strong style={{ color: palette.ink, fontSize: 14 }}><CheckCircleOutlined style={{ color: palette.green, marginRight: 6, fontSize: 14 }} />会议决议</Text>
                      {decisions.length > 0 ? (
                        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                          {decisions.slice(0, 8).map((d, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                              <span style={{ width: 18, height: 18, borderRadius: 999, background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: palette.ink, fontSize: 13 }}>{d.content || d}</div>
                                {d.status && <Tag style={{ marginTop: 4, fontSize: 10 }}>{d.status}</Tag>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, color: palette.muted, fontSize: 13 }}>未检测到明确决议</div>
                      )}
                    </div>

                    {/* 待办事项 */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong style={{ color: palette.ink, fontSize: 14 }}><ClockCircleOutlined style={{ color: palette.amber, marginRight: 6, fontSize: 14 }} />待办事项</Text>
                        <Tag color="blue">{todos.length} 项</Tag>
                      </div>
                      {todos.length > 0 ? (
                        <div style={{ marginTop: 8, borderRadius: 8, border: `1px solid ${palette.line}`, overflow: 'hidden' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px 50px', padding: '8px 10px', background: palette.panelSoft, fontSize: 11, fontWeight: 600, color: palette.muted, borderBottom: `1px solid ${palette.line}` }}>
                            <div>负责人</div>
                            <div>任务</div>
                            <div>截止</div>
                            <div>优先级</div>
                          </div>
                          {todos.map((t, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px 50px', padding: '10px', borderTop: `1px solid ${palette.line}`, fontSize: 12, alignItems: 'center', background: i % 2 === 0 ? 'transparent' : (isDarkMode ? '#0f172a' : '#f8fafc') }}>
                              <div style={{ fontWeight: 600, color: palette.ink }}>{t.owner || '—'}</div>
                              <div style={{ color: palette.text }}>
                                {t.task || t}
                                {t.reference && <div style={{ fontSize: 10, color: palette.muted, marginTop: 2, fontStyle: 'italic' }}>"{t.reference}"</div>}
                              </div>
                              <div style={{ color: palette.muted, fontSize: 11 }}>{t.deadline || '—'}</div>
                              <div><Tag color={t.priority === '高' ? 'red' : t.priority === '中' ? 'orange' : 'default'} style={{ margin: 0, fontSize: 10 }}>{t.priority || '中'}</Tag></div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, color: palette.muted, fontSize: 13 }}>未检测到待办事项</div>
                      )}
                    </div>

                    {/* 讨论要点 */}
                    {minutesItems.length > 0 && (
                      <div>
                        <Text strong style={{ color: palette.ink, fontSize: 14 }}><MessageOutlined style={{ color: palette.blue, marginRight: 6, fontSize: 14 }} />讨论要点</Text>
                        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                          {minutesItems.slice(0, 6).map((m, i) => (
                            <div key={i} style={{ padding: '8px 10px', borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                              <div style={{ fontWeight: 600, color: palette.ink, fontSize: 13 }}>{m.agenda || `议题 ${i + 1}`}</div>
                              <div style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>
                                {(m.keyPoints || []).slice(0, 3).map((p, j) => <div key={j}>• {p}</div>)}
                              </div>
                              {m.status && <Tag style={{ marginTop: 4, fontSize: 10 }} color={m.status === '已讨论' ? 'green' : 'blue'}>{m.status}</Tag>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 24, textAlign: 'center', color: palette.muted, fontSize: 13 }}>
                    会议结束后将自动生成结构化纪要
                  </div>
                )}
              </section>
          </div>

          {/* 右侧侧边栏：转写与录音 */}
          <div className="audit-layout-side">
            <section style={{ ...panelStyle, padding: 16, flex: 1, minHeight: 0, overflow: 'auto' }}>
              <Text strong style={{ color: palette.ink, fontSize: 16 }}><AudioOutlined style={{ color: palette.blue, marginRight: 8, fontSize: 16 }} />{meetingGeneratedRecords?.whisperEnhanced ? 'Whisper 终审转写' : '转写与录音'}</Text>
                {hasAudio && (
                  <div style={{ marginTop: 12 }}>
                    {recordingPlaybackRows.map(item => (
                      <div key={item.id} style={{ padding: 8, borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}`, marginBottom: 6 }}>
                        <MeetingAudioPlayer playbackUrl={item.playbackUrl} audioRef={audioPlayerRef} />
                      </div>
                    ))}
                  </div>
                )}
                {meetingGeneratedRecords?.whisperEnhanced && (meetingGeneratedRecords?.chronicle || []).length > 0 ? (
                  <div style={{ marginTop: 12, display: 'grid', gap: 4, maxHeight: hasAudio ? 400 : 600, overflow: 'auto' }}>
                    {(meetingGeneratedRecords.chronicle).slice(0, 100).map((item, idx) => (
                      <div
                        key={idx}
                        style={{ display: 'grid', gridTemplateColumns: '50px minmax(0, 1fr)', gap: 6, padding: '6px 8px', borderRadius: 6, background: palette.panelSoft, border: `1px solid ${palette.line}`, fontSize: 12 }}
                      >
                        <span style={{ color: palette.muted }}>{item.time || ''}</span>
                        <div><strong style={{ color: '#52c41a' }}>{item.speaker || 'Whisper'}</strong> <span style={{ color: palette.text }}>{item.content || ''}</span></div>
                      </div>
                    ))}
                  </div>
                ) : transcriptRows.length > 0 ? (
                  <div style={{ marginTop: 12, display: 'grid', gap: 4, maxHeight: hasAudio ? 400 : 600, overflow: 'auto' }}>
                    {transcriptRows.map(line => (
                      <div
                        key={line.id}
                        onClick={() => {
                          if (line.rawTime && recordingStartedAtRef.current && audioPlayerRef.current?.seekTo) {
                            try {
                              const offset = (new Date(line.rawTime.replace(' ', 'T')).getTime() - recordingStartedAtRef.current) / 1000;
                              if (offset > 0) audioPlayerRef.current.seekTo(offset);
                            } catch {}
                          }
                        }}
                        style={{ display: 'grid', gridTemplateColumns: '50px minmax(0, 1fr)', gap: 6, padding: '6px 8px', borderRadius: 6, background: palette.panelSoft, border: `1px solid ${palette.line}`, fontSize: 12, cursor: line.rawTime ? 'pointer' : 'default' }}
                      >
                        <span style={{ color: palette.muted }}>{line.time}</span>
                        <div><strong style={{ color: palette.ink }}>{line.speaker || '—'}</strong> <span style={{ color: palette.text }}>{line.text}</span></div>
                      </div>
                    ))}
                  </div>
                ) : (
                <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, textAlign: 'center' }}>
                  暂无转写记录
                </div>
              )}
            </section>
          </div>
        </div>
      );
    }

    // 重大会议会后终审
    return (
      <div className="audit-layout">
        {/* 左侧：状态 + 材料 + AI 审查 */}
        <div className="audit-layout-main">
            {/* 状态与材料核验 */}
            <section style={{ ...panelStyle, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong style={{ color: palette.ink, fontSize: 16 }}><SafetyCertificateOutlined style={{ color: palette.red, marginRight: 8, fontSize: 16 }} />03 会后终审</Text>
                <StatusPill color={reviewDone ? 'green' : effectiveMissingMaterialCount ? 'red' : 'green'}>{reviewDone ? '已通过' : effectiveMissingMaterialCount ? `缺 ${effectiveMissingMaterialCount} 项` : '材料已齐'}</StatusPill>
              </div>
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: isDarkMode ? '#2d1618' : '#fff1f2', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fecdd3'}` }}>
                <div style={{ color: palette.red, fontWeight: 600, fontSize: 13 }}>触发"三重一大"：重大项目安排 + 大额度资金运作</div>
                <div style={{ marginTop: 6, color: isDarkMode ? '#fecaca' : '#b42318', lineHeight: 1.6, fontSize: 12 }}>会前素材、会中发言和项目材料已汇总扫描。缺材料时不允许进入表决和发文。</div>
              </div>
              <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                {materialRows.map((item, index) => (
                  <div key={item.name} style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        {item.fileName && (
                          <div style={{ marginTop: 4, color: palette.muted, fontSize: 11, wordBreak: 'break-all' }}>
                            {item.fileName} · {Math.max(1, Math.round((item.size || 0) / 1024))} KB
                          </div>
                        )}
                      </div>
                      <Tag color={item.tone} style={{ margin: 0 }}>{item.status}</Tag>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        id={`audit-material-${index}`}
                        type="file"
                        style={{ display: 'none' }}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          uploadMeetingMaterial(item.name, file);
                        }}
                      />
                      <Button size="small" type={item.uploaded ? 'default' : 'primary'} icon={<UploadOutlined />} loading={materialUploading === item.name} onClick={() => document.getElementById(`audit-material-${index}`)?.click()}>
                        {item.uploaded ? '重新上传' : '上传文件'}
                      </Button>
                      {item.uploaded && (
                        <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadMeetingMaterial(item)}>
                          下载附件
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* AI 审查结果与催办 */}
            <section style={{ ...panelStyle, padding: 16, flex: 1, minHeight: 0, overflow: 'auto' }}>
              <Text strong style={{ color: palette.ink, fontSize: 16 }}><RobotOutlined style={{ color: palette.blue, marginRight: 8, fontSize: 16 }} />AI 审查结果</Text>
              <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
                {/* 合规审查结论 */}
                <div style={{ padding: 14, borderRadius: 10, background: isDarkMode ? '#2d1618' : '#fff1f2', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fecdd3'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <SafetyCertificateOutlined style={{ color: palette.red, fontSize: 14 }} />
                    <Text strong style={{ color: palette.red, fontSize: 14 }}>合规拦截</Text>
                  </div>
                  <div style={{ color: isDarkMode ? '#fecaca' : '#b42318', fontSize: 13, lineHeight: 1.6 }}>
                    {effectiveMissingMaterialCount > 0
                      ? `当前缺少 ${effectiveMissingMaterialCount} 项必要材料，流程被拦截。请在上方补齐所有材料后重新审查。`
                      : reviewDone
                        ? '所有材料已补齐，合规审查通过。可进入归档阶段。'
                        : '材料已齐全，请确认审查结果后进入归档。'}
                  </div>
                </div>

                {/* 项目绑定 */}
                <div>
                  <Text strong style={{ color: palette.ink, fontSize: 14 }}><LinkOutlined style={{ color: palette.blue, marginRight: 6, fontSize: 14 }} />项目绑定</Text>
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {[
                      ['项目名称', `已登记：${projectName}`, true],
                      ['材料催办', '@ 项目管理部王明 补可研修订说明', false],
                      ['财务催办', '@ 财务部李倩 补资金来源测算表', false],
                      ['法务催办', '@ 法务周法务 出具变更法审意见', false],
                    ].map(([title, desc, ok]) => (
                      <div key={title} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, alignItems: 'start', padding: '8px 10px', borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                        {ok ? <CheckCircleOutlined style={{ color: palette.green, marginTop: 2, fontSize: 14 }} /> : <ClockCircleOutlined style={{ color: palette.amber, marginTop: 2, fontSize: 14 }} />}
                        <div>
                          <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{title}</div>
                          <div style={{ color: palette.muted, fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI 会议纪要（如有） */}
                {meetingGeneratedRecords?.generated && (
                  <div>
                    <Text strong style={{ color: palette.ink, fontSize: 14 }}><FileDoneOutlined style={{ color: palette.blue, marginRight: 6, fontSize: 14 }} />会议纪要</Text>
                    <div style={{ marginTop: 8, color: palette.text, fontSize: 13, lineHeight: 1.7 }}>
                      {(meetingGeneratedRecords.summary || []).slice(0, 3).map((s, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>• {s}</div>
                      ))}
                      {(meetingGeneratedRecords.todos || []).length > 0 && (
                        <div style={{ marginTop: 6, color: palette.muted }}>
                          待办事项 {(meetingGeneratedRecords.todos || []).length} 项，决议 {(meetingGeneratedRecords.decisions || []).length} 项
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Whisper 终审状态 */}
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: palette.muted }}>Whisper 终审：</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: whisperStatus === 'done' || meetingGeneratedRecords?.whisperEnhanced ? '#52c41a' : whisperStatus === 'running' ? '#faad14' : palette.muted }}>
                    {whisperStatus === 'done' || meetingGeneratedRecords?.whisperEnhanced ? '✓ 已完成（高精度转写已注入纪实）' : whisperStatus === 'running' ? '⏳ 转写中…' : '未触发'}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* 右侧侧边栏：转写与录音 */}
        <div className="audit-layout-side">
          <section style={{ ...panelStyle, padding: 16, flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Text strong style={{ color: palette.ink, fontSize: 16 }}><AudioOutlined style={{ color: palette.blue, marginRight: 8, fontSize: 16 }} />{meetingGeneratedRecords?.whisperEnhanced ? 'Whisper 终审转写' : '转写与录音'}</Text>
              {recordingPlaybackRows.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {recordingPlaybackRows.map(item => (
                    <div key={item.id} style={{ padding: 8, borderRadius: 8, background: palette.panelSoft, border: `1px solid ${palette.line}`, marginBottom: 6 }}>
                      <MeetingAudioPlayer playbackUrl={item.playbackUrl} audioRef={audioPlayerRef} />
                    </div>
                  ))}
                </div>
              )}
              {meetingGeneratedRecords?.whisperEnhanced && (meetingGeneratedRecords?.chronicle || []).length > 0 ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 4, maxHeight: 400, overflow: 'auto' }}>
                  {(meetingGeneratedRecords.chronicle).slice(0, 100).map((item, idx) => (
                    <div
                      key={idx}
                      style={{ display: 'grid', gridTemplateColumns: '50px minmax(0, 1fr)', gap: 6, padding: '6px 8px', borderRadius: 6, background: palette.panelSoft, border: `1px solid ${palette.line}`, fontSize: 12 }}
                    >
                      <span style={{ color: palette.muted }}>{item.time || ''}</span>
                      <div><strong style={{ color: '#52c41a' }}>{item.speaker || 'Whisper'}</strong> <span style={{ color: palette.text }}>{item.content || ''}</span></div>
                    </div>
                  ))}
                </div>
              ) : liveTranscriptRows.length > 0 ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 4, maxHeight: 400, overflow: 'auto' }}>
                  {liveTranscriptRows.slice(0, 20).map(line => (
                    <div
                      key={line.id}
                      onClick={() => {
                        if (line.rawTime && recordingStartedAtRef.current && audioPlayerRef.current?.seekTo) {
                          try {
                            const offset = (new Date(line.rawTime.replace(' ', 'T')).getTime() - recordingStartedAtRef.current) / 1000;
                            if (offset > 0) audioPlayerRef.current.seekTo(offset);
                          } catch {}
                        }
                      }}
                      style={{ display: 'grid', gridTemplateColumns: '50px minmax(0, 1fr)', gap: 6, padding: '6px 8px', borderRadius: 6, background: palette.panelSoft, border: `1px solid ${palette.line}`, fontSize: 12, cursor: line.rawTime ? 'pointer' : 'default' }}
                    >
                      <span style={{ color: palette.muted }}>{line.time}</span>
                      <div><strong style={{ color: palette.ink }}>{line.speaker || '—'}</strong> <span style={{ color: palette.text }}>{line.text}</span></div>
                    </div>
                  ))}
                </div>
              ) : (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, textAlign: 'center' }}>
                暂无转写记录
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

  const generateArchiveRecords = async () => {
    if (!currentMeetingId) { message.warning('请先创建或选择一个会议'); return; }
    setArchiveGenerating(true);
    try {
      const result = await loadGeneratedMeetingRecords(true);
      if (!result || !result.generated) {
        message.warning('转写数据不足，AI 无法生成。请确认已有机录音转写后再试。');
      } else {
        message.success('AI 会议纪要生成完成！');
      }
    } catch (err) {
      message.error(`生成失败：${err.message}`);
    } finally {
      setArchiveGenerating(false);
    }
  };

  const renderArchiveWorkspace = () => (
    <div className="meeting-workspace archive-workspace">
      {/* 归档文档 */}
      <section style={{ ...panelStyle, padding: 16, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <Text strong style={{ color: palette.ink }}><FileDoneOutlined style={{ color: palette.blue, marginRight: 8 }} />04 公文归档</Text>
          {meetingGeneratedRecords?.generated ? (
            <Button type="primary" icon={<DownloadOutlined />} onClick={downloadArchiveDocx} style={{ fontWeight: 600 }}>
              下载红头纪要
            </Button>
          ) : (
            <Tag color="orange">请先在会后整理阶段生成会议记录</Tag>
          )}
        </div>
        {meetingGeneratedRecords?.generated && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: isDarkMode ? '#1b2433' : '#fff', border: `1px solid ${palette.line}` }}>
            <div style={{ textAlign: 'center', color: '#b42318', fontWeight: 600, fontSize: 16 }}>{meetingOrg || '会议'}会议纪要</div>
            <div style={{ marginTop: 6, height: 2, background: '#b42318' }} />
            <div style={{ marginTop: 10, fontSize: 13, color: palette.text, lineHeight: 1.7 }}>
              {(meetingGeneratedRecords.summary || []).slice(0, 2).map((s, i) => (
                <div key={i} style={{ marginBottom: 4 }}>• {s}</div>
              ))}
              {(meetingGeneratedRecords.todos || []).length > 0 && (
                <div style={{ marginTop: 8, color: palette.muted }}>
                  待办事项 {(meetingGeneratedRecords.todos || []).length} 项，决议 {(meetingGeneratedRecords.decisions || []).length} 项
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      <section style={{ ...panelStyle, padding: 16, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <Text strong style={{ color: palette.ink }}><SignatureOutlined style={{ color: palette.blue, marginRight: 8 }} />手机手写签名认定</Text>
          <StatusPill color={signedTranscriptRows.length ? 'green' : 'default'}>{signedTranscriptRows.length ? `${signedTranscriptRows.length} 条真实签字` : '暂无签字'}</StatusPill>
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '148px 1fr', gap: 12, alignItems: 'stretch' }}>
          <div className="mobile-sign-phone" style={{ background: isDarkMode ? '#0d1422' : '#f8fafc', border: `1px solid ${palette.line}` }}>
            <div style={{ width: 44, height: 4, borderRadius: 999, background: palette.line, margin: '0 auto 12px' }} />
            <div style={{ color: palette.muted, fontSize: 11 }}>手写签名</div>
            <div style={{ marginTop: 10, height: 74, borderRadius: 10, background: palette.panelBg, border: `1px dashed ${palette.line}`, position: 'relative', overflow: 'hidden' }}>
              {latestSignatureData ? (
                <img src={latestSignatureData} alt="最近一次真实签名" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.muted, fontSize: 12 }}>暂无真实签名</div>
              )}
            </div>
            <div style={{ marginTop: 10, color: signedTranscriptRows.length ? palette.green : palette.muted, fontWeight: 600, fontSize: 12 }}>
              {signedTranscriptRows.length ? '已读取手机端签字' : '等待参会人签字'}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 9 }}>
            {signedTranscriptRows.map(item => (
              <div key={item.id} style={{ padding: 10, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}`, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{item.signer} · {item.role}</div>
                  <div style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{item.signedAt} · 手机端本人修正签字</div>
                  <div style={{ color: palette.muted, fontSize: 12, marginTop: 5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.text}</div>
                </div>
                <Tag color="green" style={{ margin: 0 }}>已签字</Tag>
              </div>
            ))}
            {!signedTranscriptRows.length && (
              <div style={{ minHeight: 132, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 10, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
                暂无参会人员签字记录。参会人需要在手机端对本人转写进行"修正签字"，这里才会出现真实姓名、签字时间和签名图片。
              </div>
            )}
          </div>
        </div>
      </section>
      <section style={{ ...panelStyle, padding: 16, minHeight: 0, overflow: 'auto' }}>
          <Text strong style={{ color: palette.ink }}><FolderOpenOutlined style={{ color: palette.blue, marginRight: 8 }} />防伪归档包</Text>
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {(isMajorMeeting
            ? [
                { title: '聊天碎片与图片 OCR 原件', ready: chatMessages.length > 0 },
                { title: '议题聚类、拆分和变更明细', ready: activeIssueCards.length > 0 },
                { title: '录音原件、声纹分轨和校对日志', ready: remoteTranscripts.length > 0 && recordingPlaybackRows.length > 0 },
                { title: '三重一大合规报告与催办闭环', ready: effectiveMissingMaterialCount === 0 && reviewDone },
                { title: '红头纪要、电子签、显性水印与盲水印', ready: signedTranscriptRows.length > 0 && archiveDone },
              ]
            : [
                { title: '聊天碎片与图片 OCR 原件', ready: chatMessages.length > 0 },
                { title: '议题聚类、拆分和变更明细', ready: activeIssueCards.length > 0 },
                { title: '录音原件、转写底稿和校对日志', ready: remoteTranscripts.length > 0 && recordingPlaybackRows.length > 0 },
                { title: '会议纪实、会议纪要和会议决议', ready: Boolean(meetingGeneratedRecords?.generated) },
                { title: '电子签、显性水印与归档包', ready: signedTranscriptRows.length > 0 && archiveDone },
              ]
          ).map((item, index) => (
            <div key={item.title} style={{ display: 'grid', gridTemplateColumns: '26px 1fr auto', gap: 9, alignItems: 'center', padding: 11, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: item.ready ? '#dcfce7' : '#f1f5f9', color: item.ready ? palette.green : palette.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>{index + 1}</span>
              <span style={{ color: palette.text }}>{item.title}</span>
              <Tag color={item.ready ? 'green' : 'default'} style={{ margin: 0 }}>{item.ready ? '已具备' : '待补齐'}</Tag>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderCurrentWorkspace = () => {
    if (activeStage === 'collect') return renderCollectWorkspace();
    if (activeStage === 'meeting') return renderMeetingWorkspace();
    if (activeStage === 'audit') return renderAuditWorkspace();
    return renderArchiveWorkspace();
  };

  const closeMeetingActionModal = () => setMeetingActionType('');

  const meetingActionConfig = (() => {
    const remoteOnly = remoteSpeakerRows.filter(item => item.fromRemote).filter(item => item.name !== currentUserName);
    const baseParticipants = [
      { name: `${currentUserName}（我）`, role: currentUserMeetingRole, status: '主持中', confidence: 100 },
      ...remoteOnly,
    ];
    const participantRows = [
      ...baseParticipants,
      ...(baseParticipants.length === 0
        ? [{ name: '暂无参会人', role: '请通过扫码或链接接入', status: '等待接入', confidence: 0, empty: true }]
        : []),
    ];

    const markerLabel = meetingActionType.startsWith('marker:') ? meetingActionType.replace('marker:', '') : '';
    if (markerLabel) {
      const markerAgenda = activeIssueCards.find(item => item.id === activeMeetingAgendaId) || { title: agendaTitle };
      const candidateTranscripts = liveTranscriptRows.slice(0, 8);
      const selectedIndex = Math.min(pendingMarkerTranscriptIndex, Math.max(0, candidateTranscripts.length - 1));
      const selectedTranscript = candidateTranscripts[selectedIndex] || null;
      const hasRealTranscript = Boolean(selectedTranscript?.text);
      const markerTime = selectedTranscript?.time || '--:--';
      const markerSpeaker = selectedTranscript?.speaker || '未识别发言人';
      const markerText = selectedTranscript?.text || '';
      const agendaMarkers = meetingMarkers.filter(m => m.agendaId === (markerAgenda.id || ''));
      const markerCopy = {
        标决议: ['标记决议', '把选中发言保存为"拟形成决议"，会后纪要会优先引用这一段。'],
        记待办: ['记录待办', '把选中发言保存为会后待办线索，后续补责任人和截止时间。'],
        有争议: ['标记争议', '把选中发言标为争议段，防止会后纪要直接写成已通过。'],
        缺材料: ['标记缺材料', '把选中发言保存为材料缺口线索，终审时核验附件。'],
      }[markerLabel] || ['标记事件', '把选中发言写入关键事件流。'];

      return {
        title: markerCopy[0],
        content: (
          <div style={{ display: 'grid', gap: 14, maxHeight: '62vh', overflow: 'auto' }}>
            <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 4 }}>绑定议题</div>
              <div style={{ color: palette.text, fontSize: 14 }}>{markerAgenda.title || agendaTitle}</div>
            </div>

            {candidateTranscripts.length > 0 ? (
              <div>
                <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 8 }}>选择锚定发言（点击选中）</div>
                <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                  {candidateTranscripts.map((line, index) => (
                    <button
                      key={line.id || `${line.time}-${line.speaker}-${line.text.slice(0, 8)}`}
                      type="button"
                      onClick={() => setPendingMarkerTranscriptIndex(index)}
                      style={{
                        display: 'grid', gridTemplateColumns: '48px 64px minmax(0,1fr)', gap: 8, alignItems: 'start',
                        padding: 9, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        border: selectedIndex === index ? `2px solid ${palette.blue}` : `1px solid ${palette.line}`,
                        background: selectedIndex === index ? (isDarkMode ? '#1a2740' : '#eff6ff') : palette.panelSoft,
                        font: 'inherit', width: '100%',
                      }}
                    >
                      <span style={{ color: palette.muted, fontSize: 11, fontWeight: 500 }}>{line.time}</span>
                      <strong style={{ color: palette.ink, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.speaker}</strong>
                      <span style={{ color: palette.text, fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>{line.text.slice(0, 120)}{line.text.length > 120 ? '…' : ''}</span>
                    </button>
                  ))}
                </div>
                {selectedTranscript && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: isDarkMode ? '#1a2740' : '#eff6ff', border: `1px solid ${palette.blue}33` }}>
                    <div style={{ color: palette.muted, fontSize: 11, marginBottom: 4 }}>
                      已选择：{markerTime} · {markerSpeaker}
                    </div>
                    <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.6 }}>
                      "{markerText.slice(0, 200)}{markerText.length > 200 ? '…' : ''}"
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 14, borderRadius: 10, background: palette.panelSoft, border: `1px dashed ${palette.line}`, color: palette.muted, fontSize: 13, textAlign: 'center', lineHeight: 1.7 }}>
                暂无转写行。请先让参会人通过"手机接入"登录并开始录音；有真实转写后，标记才会绑定到具体时间、角色和发言内容。
              </div>
            )}

            {agendaMarkers.length > 0 && (
              <div>
                <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 6 }}>
                  该议题已有标记（{agendaMarkers.length} 条）
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {agendaMarkers.map(marker => {
                    const typeLabel = { decision: '决议', todo: '待办', dispute: '争议', material: '缺材料', event: '事件' }[marker.markerType] || '事件';
                    const typeColor = { decision: palette.green, todo: palette.blue, dispute: palette.red, material: palette.amber, event: palette.blue }[marker.markerType] || palette.blue;
                    return (
                      <div key={marker.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: 8, borderRadius: 8, border: `1px solid ${palette.line}`, background: palette.panelSoft }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Tag color={typeColor} style={{ margin: 0, fontSize: 11 }}>{typeLabel}</Tag>
                            {marker.transcriptTime && <span style={{ color: palette.muted, fontSize: 11 }}>{marker.transcriptTime}</span>}
                            {marker.transcriptSpeaker && <span style={{ color: palette.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{marker.transcriptSpeaker}</span>}
                          </div>
                          {marker.transcriptText && (
                            <div style={{ marginTop: 4, color: palette.text, fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>
                              {marker.transcriptText.slice(0, 100)}{marker.transcriptText.length > 100 ? '…' : ''}
                            </div>
                          )}
                        </div>
                        <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => deleteMeetingMarker(marker.id)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ),
        footer: [
          <Button key="close" onClick={closeMeetingActionModal}>知道了</Button>,
          <Button key="save" type="primary" onClick={() => { saveMeetingMarker(markerLabel, markerAgenda, selectedTranscript); closeMeetingActionModal(); }}>{hasRealTranscript ? '保存标记到会议记录' : '创建待补录标记'}</Button>,
        ],
      };
    }

    switch (meetingActionType) {
      case 'participants':
        return {
          title: '参会人接入情况',
          content: (
            <div style={{ display: 'grid', gap: 10 }}>
              {participantRows.map((item, index) => (
                <div key={`${item.name}-${index}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, background: item.empty ? '#f8fafc' : palette.panelSoft, border: `1px solid ${item.empty ? '#e2e8f0' : palette.line}` }}>
                  <span style={{ width: 32, height: 32, borderRadius: 999, background: item.empty ? '#f1f5f9' : '#dbeafe', color: item.empty ? '#94a3b8' : palette.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>{item.empty ? '+' : item.name.slice(0, 1)}</span>
                  <div>
                    <div style={{ color: palette.ink, fontWeight: 600 }}>{item.name}</div>
                    <div style={{ color: palette.muted, fontSize: 12 }}>{item.role}</div>
                  </div>
                  <Tag color={item.empty ? 'default' : item.status === '录音中' ? 'processing' : 'green'} style={{ margin: 0 }}>{item.status}</Tag>
                </div>
              ))}
              <Button icon={<MobileOutlined />} onClick={() => { closeMeetingActionModal(); setRecorderInviteOpen(true); }}>打开扫码邀请</Button>
            </div>
          ),
        };
      case 'permission':
        return {
          title: '共享与录音权限',
          content: (
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                ['共享材料', '仅主持人可停止共享，参会人只读查看。'],
                ['手机录音', '参会人必须登录或登记账号，转写绑定本人角色。'],
                ['证据底稿', '秘书可查看全文底稿，普通参会人只看本人录音状态。'],
                ['会后归档', isMajorMeeting ? '录音、转写、关键事件和材料缺口统一进入当前会议案卷。' : '录音、转写、关键事件、纪要和决议统一进入当前会议案卷。'],
              ].map(([title, desc]) => (
                <div key={title} style={{ padding: 11, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ color: palette.ink, fontWeight: 600 }}>{title}</div>
                  <div style={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>{desc}</div>
                </div>
              ))}
            </div>
          ),
        };
      case 'stopShare':
        return {
          title: '停止共享确认',
          content: (
            <div style={{ color: palette.text, lineHeight: 1.7 }}>
              停止共享后，参会人仍可继续通过手机录音上传发言，但中央材料区会停止展示当前审议稿。
            </div>
          ),
          footer: [
            <Button key="cancel" onClick={closeMeetingActionModal}>继续共享</Button>,
            <Button key="stop" danger type="primary" onClick={async () => { await stopAndUploadDesktopAudio(); setRecording(false); closeMeetingActionModal(); message.success('已停止共享，录音已保存'); }}>停止共享</Button>,
          ],
        };
      case 'mic':
        return {
          title: '麦克风状态',
          content: (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ color: palette.ink, fontWeight: 600 }}>当前麦克风：{recording ? '正在采集主持人声音' : '已暂停'}</div>
              <div style={{ color: palette.muted }}>手机端参会人录音不依赖主持人麦克风，扫码登录后会单独绑定角色。</div>
            </div>
          ),
          footer: [
            <Button key="close" onClick={closeMeetingActionModal}>知道了</Button>,
            <Button key="toggle" type="primary" onClick={async () => { if (recording) { await stopAndUploadDesktopAudio(); } setRecording(prev => !prev); closeMeetingActionModal(); }}>{recording ? '暂停麦克风' : '开启麦克风'}</Button>,
          ],
        };
      case 'chat':
        return {
          title: '会中备注',
          content: (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}`, color: palette.muted, fontSize: 13 }}>
                会中备注由记录员手动输入，写给会后整理阶段自己和同事查阅，不是参会人的真实发言。内容在关闭弹窗后保留，切换会议后清空。
              </div>
              <Input.TextArea
                placeholder="输入备注，内容自动保留…"
                rows={5}
                value={meetingNotes}
                onChange={e => setMeetingNotes(e.target.value)}
              />
            </div>
          ),
          footer: [
            <Button key="close" type="primary" onClick={closeMeetingActionModal}>完成</Button>,
          ],
        };
      case 'share': {
        const shareUrl = `${window.location.origin}/mobile-recorder?meetingId=${currentMeetingId}`;
        return {
          title: '共享材料与参会邀请',
          content: (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 6 }}>正在共享：{agendaTitle || '未指定议题'}</div>
                <div style={{ color: palette.muted, fontSize: 13 }}>参会人看到的是当前审议材料；AI 会把材料标题、议题和会中发言一起绑定到当前会议。</div>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ flex: '0 0 auto', padding: 8, borderRadius: 12, background: '#fff', border: `1px solid ${palette.line}` }}>
                  <QRCode value={shareUrl} size={120} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 6 }}>手机端接入链接</div>
                  <Input.TextArea
                    value={shareUrl}
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 3 }}
                    style={{ fontSize: 12 }}
                    onClick={e => {
                      e.target.select();
                      navigator.clipboard.writeText(shareUrl).then(() => message.success('已复制链接')).catch((err) => { console.warn("Clipboard:", err); });
                    }}
                  />
                  <div style={{ marginTop: 6, color: palette.muted, fontSize: 12 }}>
                    参会人扫码或点击链接进入手机端，登录后开始录音和转写。
                  </div>
                </div>
              </div>
              <Button icon={<CheckCircleOutlined />} onClick={() => setMeetingActionType('permission')}>查看权限设置</Button>
            </div>
          ),
        };
      }
      case 'record':
        return {
          title: '录制与转写状态',
          content: (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
              {[
                ['会议 ID', currentMeetingId],
                ['录音状态', recording ? '录音中' : '已暂停'],
                ['手机接入', `${remoteSpeakerRows.filter(item => item.fromRemote).length} 人`],
                ['底稿回传', `${remoteTranscripts.length} 条`],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: 11, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ color: palette.muted, fontSize: 12 }}>{label}</div>
                  <div style={{ color: palette.ink, fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>{value}</div>
                </div>
              ))}
            </div>
          ),
        };
      case 'evidence':
        return {
          title: `证据底稿（${meetingMarkers.length} 条标记）`,
          content: (
            <div style={{ display: 'grid', gap: 10 }}>
              {meetingMarkers.length > 0 && (
                <div style={{ display: 'grid', gap: 6, marginBottom: 4 }}>
                  {meetingMarkers.slice(0, 8).map(marker => {
                    const markerColor = { decision: palette.green, todo: palette.blue, dispute: palette.red, material: palette.amber }[marker.markerType] || palette.blue;
                    const markerTypeLabel = { decision: '决议', todo: '待办', dispute: '争议', material: '缺材料', event: '事件' }[marker.markerType] || '事件';
                    return (
                      <div key={marker.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 8, alignItems: 'start', padding: 8, borderRadius: 8, border: `1px solid ${palette.line}`, background: palette.panelSoft }}>
                        <Tag color={markerColor} style={{ margin: 0, fontSize: 11, width: 44, textAlign: 'center' }}>{markerTypeLabel}</Tag>
                        <div>
                          <div style={{ color: palette.ink, fontWeight: 600, fontSize: 12 }}>{marker.agendaTitle?.slice(0, 28) || agendaTitle}</div>
                          {marker.transcriptText ? <div style={{ color: palette.text, fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>{marker.transcriptText.slice(0, 80)}{marker.transcriptText.length > 80 ? '…' : ''}</div> : <div style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>无转写锚点</div>}
                        </div>
                        <span style={{ color: palette.muted, fontSize: 10 }}>{marker.transcriptTime || marker.createdBy || ''}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!meetingMarkers.length && <div style={{ color: palette.muted, fontSize: 12, marginBottom: 8 }}>暂无会中标记，使用快捷标记按钮保存。标记会绑定到当前讨论议题。</div>}
              <div style={{ color: palette.muted, fontSize: 11 }}>最近转写底稿</div>
              {liveTranscriptRows.slice(0, 5).map(line => {
                const transcriptId = line.id || line.transcriptId;
                const isEditing = speakerEditingId === transcriptId;
                return (
                  <div key={transcriptId || `${line.source || 'live'}-${line.time}-${line.speaker}-${line.text.slice(0, 12)}`} style={{ display: 'grid', gridTemplateColumns: '50px auto minmax(0,1fr)', gap: 6, padding: 9, borderRadius: 9, background: palette.panelSoft, border: `1px solid ${palette.line}`, fontSize: 12 }}>
                    <span style={{ color: palette.muted }}>{line.time}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isEditing ? (
                        <Input
                          size="small"
                          value={speakerEditName}
                          onChange={e => setSpeakerEditName(e.target.value)}
                          onPressEnter={() => {
                            updateTranscriptSpeaker(transcriptId, speakerEditName, speakerEditRole, currentUserDept);
                            setSpeakerEditingId(null);
                          }}
                          style={{ width: 80, height: 24, fontSize: 12 }}
                          autoFocus
                        />
                      ) : (
                        <strong style={{ color: palette.ink, cursor: 'pointer' }} title="点击编辑发言人"
                          onClick={() => {
                            setSpeakerEditingId(transcriptId);
                            setSpeakerEditName(line.speaker || '');
                            setSpeakerEditRole(line.role || '');
                          }}>
                          {line.speaker || '未识别'}
                        </strong>
                      )}
                      {isEditing && (
                        <Select
                          size="small"
                          value={speakerEditRole || '参会代表'}
                          onChange={val => setSpeakerEditRole(val)}
                          style={{ width: 90, fontSize: 11 }}
                          options={[
                            { label: '主要负责人', value: '主要负责人' },
                            { label: '分管领导', value: '分管领导' },
                            { label: '议题负责人', value: '议题负责人' },
                            { label: '会议秘书', value: '会议秘书' },
                            { label: '审计监察', value: '审计监察' },
                            { label: '法务合规', value: '法务合规' },
                            { label: '财务部', value: '财务部' },
                            { label: '参会代表', value: '参会代表' },
                          ]}
                        />
                      )}
                      {isEditing && (
                        <Button
                          size="small"
                          type="primary"
                          style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                          onClick={() => {
                            updateTranscriptSpeaker(transcriptId, speakerEditName, speakerEditRole, currentUserDept);
                            setSpeakerEditingId(null);
                          }}>
                          确认
                        </Button>
                      )}
                      {!isEditing && line.speaker && (
                        <EditOutlined
                          style={{ fontSize: 10, color: palette.muted, cursor: 'pointer', opacity: 0.5 }}
                          onClick={() => {
                            setSpeakerEditingId(transcriptId);
                            setSpeakerEditName(line.speaker || '');
                            setSpeakerEditRole(line.role || '');
                          }}
                        />
                      )}
                    </div>
                    <span style={{ color: palette.text }}>{line.text}</span>
                  </div>
                );
              })}
            </div>
          ),
        };
      case 'endMeeting':
        return {
          title: isMajorMeeting ? '结束会议并进入终审' : '结束会议并整理纪要',
          content: (
            <div style={{ display: 'grid', gap: 10, color: palette.text, lineHeight: 1.65 }}>
              <div>{isMajorMeeting ? '结束会议后，系统会停止会中共享，进入 `03 会后终审`。' : '结束会议后，系统会停止会中共享，进入 `03 会后整理`。'}</div>
              {isMajorMeeting ? (
                <div style={{ padding: 10, borderRadius: 10, background: isDarkMode ? '#2d2112' : '#fffbeb', border: `1px solid ${isDarkMode ? '#854d0e' : '#fde68a'}`, color: isDarkMode ? '#fde68a' : '#92400e' }}>
                  终审阶段会核验项目名称、资金测算表、可研修订说明和法务意见。
                </div>
              ) : (
                <div style={{ padding: 10, borderRadius: 10, background: isDarkMode ? '#122239' : '#eff6ff', border: `1px solid ${isDarkMode ? '#1d4ed8' : '#bfdbfe'}`, color: isDarkMode ? '#bfdbfe' : '#1d4ed8' }}>
                  普通会议不会触发三重一大材料拦截，只生成纪实、纪要、决议和督办清单。
                </div>
              )}
            </div>
          ),
          footer: [
            <Button key="cancel" onClick={closeMeetingActionModal}>继续会议</Button>,
            <Button key="end" danger={isMajorMeeting} type="primary" onClick={() => { closeMeetingActionModal(); runStageAction(); }}>{isMajorMeeting ? '结束会议，进入终审' : '结束会议，整理纪要'}</Button>,
          ],
        };
      default:
        return null;
    }
  })();

  const meetingIdMeta = currentMeetingId.replace('meeting-', '').slice(0, 12);

  // 新创建会议 → 显示精简创建页，不是完整工作区
  return (
    <div className={`meeting-compliance-page is-stage-${activeStage}`} style={{ height: '100%', padding: 12, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <section className="meeting-compact-header" style={{ ...panelStyle, padding: 10, flex: '0 0 auto' }}>
          <div className={activeStage === 'meeting' ? 'meeting-compact-header-grid is-meeting' : 'meeting-compact-header-grid'}>
            <div className="meeting-compact-identity">
              {activeStage === 'meeting' && (
                <button type="button" className="meeting-compact-back" aria-label="返回会议列表" onClick={backToMeetingList}>
                  <LeftOutlined />
                </button>
              )}
              <div className="meeting-compact-title">
                <span>{meetingTitle || 'AI 会议工作台'}</span>
                {activeStage === 'meeting' ? (
                  <div className="meeting-compact-meta">
                    <StatusPill color="blue">AI 会议</StatusPill>
                    <StatusPill color="default">{meetingDate}</StatusPill>
                    <StatusPill color="default">ID：{meetingIdMeta}</StatusPill>
                    <StatusPill color="green">议题已锁定</StatusPill>
                  </div>
                ) : (
                  <em>{isMajorMeeting ? '三重一大终审会' : '普通会议'} · 当前议题：{agendaDisplayTitle}</em>
                )}
              </div>
              {activeStage !== 'meeting' && (
                <Space size={7} wrap className="meeting-compact-stage-tags">
                  <StatusPill color="blue">AI 会议</StatusPill>
                  <StatusPill color={isMajorMeeting ? 'red' : 'green'}>{isMajorMeeting ? '三重一大会议' : '普通会议'}</StatusPill>
                  <StatusPill color="default">{meetingDate}</StatusPill>
                  <Button size="small" onClick={backToMeetingList}>返回会议列表</Button>
                </Space>
              )}
            </div>
            {activeStage === 'meeting' ? (
              renderHeaderParticipantStrip()
            ) : (
              <div className="meeting-compact-progress" style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <MeetingAiPulse active={recording || activeStage === 'collect' || activeStage === 'audit'} />
                <div>
                  <div style={{ color: palette.ink, fontWeight: 600 }}>{isMajorMeeting ? '全链路闭环度' : '会议记录完整度'}</div>
                  <Progress percent={completion} size="small" strokeColor={completion >= 80 ? palette.green : palette.blue} />
                </div>
              </div>
            )}
          </div>
        </section>

        {activeStage !== 'meeting' && (
          <section style={{ ...panelStyle, padding: 12, flex: '0 0 auto' }}>
            {renderStageTimeline()}
          </section>
        )}

        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {renderCurrentWorkspace()}
        </main>

        {activeStage !== 'meeting' && (
          <section style={{ ...panelStyle, padding: 12, flex: '0 0 auto', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {activeStage !== 'collect' && (
                <Button
                  icon={<LeftOutlined />}
                  onClick={async () => {
                    const prevStage = { audit: 'meeting', archive: 'audit' }[activeStage];
                    if (prevStage) {
                      setActiveStage(prevStage);
                      const phaseMap = { collect: '会前确认', meeting: '会中记录', audit: '会后终审', archive: '已归档' };
                      await persistStage(prevStage, phaseMap[prevStage] || '');
                      message.info(`已返回${STAGES.find(s => s.key === prevStage)?.title || prevStage}`);
                    }
                  }}
                >
                  返回
                </Button>
              )}
              <Text style={{ color: palette.muted, fontSize: 12 }}>
                {activeStage === 'archive' && archiveDone ? '已完成归档' : ''}
              </Text>
            </div>
            <Button type="primary" icon={<SyncOutlined />} onClick={runStageAction} disabled={activeStage === 'archive' && archiveDone} style={{ fontWeight: 600 }}>
              {getActionText()}
            </Button>
          </section>
        )}
      </div>

      <Modal
        title="邀请参会人手机录音"
        open={recorderInviteOpen}
        onCancel={() => setRecorderInviteOpen(false)}
        footer={null}
        width={520}
        centered
      >
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
          <div style={{ padding: 12, borderRadius: 12, background: '#fff', border: `1px solid ${palette.line}`, display: 'flex', justifyContent: 'center' }}>
            <QRCode
              key={recorderQrUrl}
              value={recorderQrUrl}
              type="svg"
              size={220}
              color="#000000"
              bgColor="#FFFFFF"
              errorLevel="H"
              bordered={false}
              style={{ display: 'block', width: 196, height: 196 }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Text strong style={{ color: palette.ink, fontSize: 15 }}>{meetingTitle || '当前会议'}</Text>
            <div style={{ marginTop: 8, color: palette.muted, fontSize: 13, lineHeight: 1.65 }}>
              参会人扫码后需要登录或登记账号，录音和转写会绑定到此会议。
            </div>
            <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
              <div style={{ color: palette.muted, fontSize: 12 }}>会议 ID · 扫码确认</div>
              <div style={{ marginTop: 4, color: palette.ink, fontWeight: 600, wordBreak: 'break-all' }}>{currentMeetingId}</div>
            </div>
            <Button type="primary" icon={<LinkOutlined />} onClick={copyRecorderUrl} style={{ marginTop: 12, fontWeight: 600 }}>
              复制邀请链接
            </Button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <Text strong style={{ color: palette.ink }}>外部访问地址</Text>
          <Input
            value={externalShareOrigin}
            onChange={event => setExternalShareOrigin(event.target.value)}
            placeholder="例如：https://6b9ebde2.r40.cpolar.top 或 https://192.168.1.8:3001"
            style={{ marginTop: 8 }}
          />
          <div style={{ marginTop: 8, color: recorderQrUsesLocalhost ? palette.amber : palette.muted, fontSize: 12, lineHeight: 1.55 }}>
            {recorderQrUsesLocalhost
              ? '当前二维码使用 localhost，手机扫码会打不开。填入 cpolar / ngrok / 局域网 HTTPS 地址后，二维码会立即变成可扫码进场链接。'
              : '二维码内容已使用外部访问地址，手机扫码会打开当前会议的录音登录页。'}
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}`, color: palette.text, fontSize: 12, lineHeight: 1.55, wordBreak: 'break-all' }}>
          {recorderQrUrl}
        </div>
      </Modal>

      <Modal
        title={issueImagePreview?.name || '原图预览'}
        open={Boolean(issueImagePreview)}
        onCancel={() => setIssueImagePreview(null)}
        footer={null}
        width={820}
        centered
      >
        {issueImagePreview?.imageDataUrl && (
          <img
            src={issueImagePreview.imageDataUrl}
            alt={issueImagePreview.name || '原图预览'}
            style={{ display: 'block', width: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: 12, background: '#fff' }}
          />
        )}
        {issueImagePreview?.text && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: palette.panelSoft, color: palette.text, fontSize: 13, lineHeight: 1.65 }}>
            {issueImagePreview.text}
          </div>
        )}
      </Modal>

      <Modal
        title="素材详情"
        open={Boolean(issueSourceDetailGroup)}
        onCancel={() => setIssueSourceDetailGroup(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIssueSourceDetailGroup(null)}>关闭</Button>,
        ]}
        width={920}
        centered
      >
        {issueSourceDetailGroup && (() => {
          const parsedName = String(issueSourceDetailGroup.name || '未知填报人').trim();
          const nameParts = parsedName.split(/\s+/).filter(Boolean);
          const personName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : parsedName;
          const unitName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '参会单位';
          const imageCount = issueSourceDetailGroup.items.reduce((count, item) => count + parseIssueMeta(item.meta).attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl).length, 0);
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
              <aside style={{ padding: 14, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: '#e8f3ff', color: palette.blue, display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 850 }}>
                  {personName.slice(0, 1) || '人'}
                </div>
                <div style={{ marginTop: 12, color: palette.ink, fontWeight: 750, fontSize: 16 }}>{personName}</div>
                <div style={{ marginTop: 4, color: palette.muted, fontSize: 13 }}>{unitName}</div>
                <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                  {[
                    ['提交条数', `${issueSourceDetailGroup.items.length} 条`],
                    ['图片原件', `${imageCount} 张`],
                    ['最新时间', issueSourceDetailGroup.latestTime || '--'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: palette.text, fontSize: 13 }}>
                      <span style={{ color: palette.muted }}>{label}</span>
                      <strong style={{ color: palette.ink, fontWeight: 650, textAlign: 'right' }}>{value}</strong>
                    </div>
                  ))}
                </div>
              </aside>
              <div style={{ maxHeight: '62vh', overflow: 'auto', display: 'grid', gap: 10, paddingRight: 4 }}>
                {issueSourceDetailGroup.items.map((item, index) => {
                  const metaInfo = parseIssueMeta(item.meta);
                  const images = metaInfo.attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl);
                  const files = metaInfo.attachments.filter(attachment => attachment.type !== 'image');
                  return (
                    <div key={item.id || `${item.time}-${item.content}-${index}`} style={{ padding: 12, borderRadius: 12, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                        <div style={{ color: palette.ink, fontWeight: 700 }}>第 {index + 1} 条原文</div>
                        <div style={{ color: palette.muted, fontSize: 12 }}>{item.time || item.serverTime || '--:--'}</div>
                      </div>
                      {metaInfo.label && <Tag color="blue" style={{ marginTop: 8 }}>{metaInfo.label}</Tag>}
                      <div style={{ marginTop: 9, color: palette.text, fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {item.content}
                      </div>
                      {images.length > 0 && (
                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                          {images.map(attachment => (
                            <button key={attachment.id || attachment.name} type="button" onClick={() => setIssueImagePreview(attachment)} style={{ border: `1px solid ${palette.line}`, borderRadius: 10, padding: 0, background: '#fff', overflow: 'hidden', cursor: 'zoom-in' }}>
                              <img src={attachment.imageDataUrl} alt={attachment.name} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
                            </button>
                          ))}
                        </div>
                      )}
                      {files.map(attachment => (
                        <div key={attachment.id || attachment.name} style={{ marginTop: 10, padding: 10, borderRadius: 10, background: palette.panelSoft, color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>
                          <FileTextOutlined style={{ marginRight: 6, color: palette.blue }} />
                          <strong style={{ color: palette.ink }}>{attachment.name}</strong>
                          {attachment.text && <span>：{attachment.text}</span>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal
        title={meetingActionConfig?.title}
        open={Boolean(meetingActionConfig)}
        onCancel={closeMeetingActionModal}
        footer={meetingActionConfig?.footer || [<Button key="ok" type="primary" onClick={closeMeetingActionModal}>知道了</Button>]}
        width={560}
        centered
      >
        {meetingActionConfig?.content}
      </Modal>

    </div>
  );
}
