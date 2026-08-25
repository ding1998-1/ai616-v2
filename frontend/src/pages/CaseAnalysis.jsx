import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Layout,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antMessage,
} from 'antd';
import {
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  RightOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import DocxPreviewModal from '../components/DocxPreviewModal';
import { fetchJson } from '../lib/demoApi';
import { authFetch, authHeaders } from '../lib/auth';

const { Text, Title } = Typography;
const { TextArea } = Input;
const { Content } = Layout;

const SEV = {
  high: { color: '#d94841', soft: '#fff1f0', border: '#ffccc7', badge: '高风险' },
  medium: { color: '#d48806', soft: '#fff7e6', border: '#ffe7ba', badge: '中风险' },
  low: { color: '#389e0d', soft: '#f6ffed', border: '#d9f7be', badge: '低风险' },
};

const STATUS_TONES = {
  blue: { soft: '#e8f1ff', border: 'rgba(22,119,255,0.24)', text: '#1456cc', solid: '#1677ff' },
  green: { soft: '#edf9f0', border: 'rgba(22,163,74,0.22)', text: '#166534', solid: '#16a34a' },
  orange: { soft: '#fff2e8', border: 'rgba(234,88,12,0.2)', text: '#c2410c', solid: '#ea580c' },
  purple: { soft: '#f3e8ff', border: 'rgba(124,58,237,0.22)', text: '#6d28d9', solid: '#7c3aed' },
  gray: { soft: '#f8fafc', border: 'rgba(152,162,179,0.2)', text: '#667085', solid: '#98a2b3' },
};

function StrokeIcon({ children, size = 18, color = '#111827', strokeWidth = 1.8, style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', ...style }}
    >
      {children}
    </svg>
  );
}

const ICONS = {
  building: props => (
    <StrokeIcon {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" />
    </StrokeIcon>
  ),
  scale: props => (
    <StrokeIcon {...props}>
      <path d="M12 4v15" />
      <path d="M6 7h12" />
      <path d="M8 7 5 12h6L8 7Z" />
      <path d="M16 7 13 12h6l-3-5Z" />
      <path d="M9 19h6" />
    </StrokeIcon>
  ),
  alert: props => (
    <StrokeIcon {...props}>
      <path d="M12 4 21 19H3L12 4Z" />
      <path d="M12 9v4.5" />
      <path d="M12 17h.01" />
    </StrokeIcon>
  ),
  coins: props => (
    <StrokeIcon {...props}>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
      <path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
      <path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
    </StrokeIcon>
  ),
  door: props => (
    <StrokeIcon {...props}>
      <path d="M6 20V5.5A2.5 2.5 0 0 1 8.5 3H18v18H6Z" />
      <path d="M10.5 11.5h.01" />
      <path d="M3 20h18" />
    </StrokeIcon>
  ),
  bulb: props => (
    <StrokeIcon {...props}>
      <path d="M9 17h6" />
      <path d="M10 20h4" />
      <path d="M8.7 14.8C7.6 13.9 7 12.6 7 11a5 5 0 1 1 10 0c0 1.6-.6 2.9-1.7 3.8-.7.6-1.3 1.4-1.6 2.2h-3.4c-.3-.8-.9-1.6-1.6-2.2Z" />
    </StrokeIcon>
  ),
  swords: props => (
    <StrokeIcon {...props}>
      <path d="m7 4 5 5" />
      <path d="m12 9-6.5 6.5" />
      <path d="m9.5 18 2 2" />
      <path d="M17 4 12 9" />
      <path d="m12 9 6.5 6.5" />
      <path d="m14.5 18-2 2" />
    </StrokeIcon>
  ),
  clipboard: props => (
    <StrokeIcon {...props}>
      <rect x="6" y="5" width="12" height="15" rx="2.5" />
      <path d="M9 5.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 5.5Z" />
      <path d="M9 11h6M9 15h4" />
    </StrokeIcon>
  ),
  help: props => (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.5a2.6 2.6 0 1 1 4.5 1.8c-.8.8-1.7 1.3-1.7 2.7" />
      <path d="M12 17h.01" />
    </StrokeIcon>
  ),
  target: props => (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5" />
    </StrokeIcon>
  ),
  pencil: props => (
    <StrokeIcon {...props}>
      <path d="m4 20 4.2-1 9.1-9.1a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
      <path d="m13.5 7.5 3 3" />
    </StrokeIcon>
  ),
  message: props => (
    <StrokeIcon {...props}>
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5v-6Z" />
    </StrokeIcon>
  ),
  check: props => (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.3 2.3 4.8-5.1" />
    </StrokeIcon>
  ),
};

const CATEGORY_META = {
  '合同主体': { icon: ICONS.building, short: '主体' },
  '权利义务': { icon: ICONS.scale, short: '义务' },
  '违约责任': { icon: ICONS.alert, short: '违约' },
  '付款条款': { icon: ICONS.coins, short: '付款' },
  '解除条款': { icon: ICONS.door, short: '解除' },
  '知识产权': { icon: ICONS.bulb, short: '知产' },
  '争议解决': { icon: ICONS.swords, short: '争议' },
  '其他重要条款': { icon: ICONS.clipboard, short: '其他' },
  '用户关注': { icon: ICONS.help, short: '关注' },
};

const ANALYSIS_STAGE_FLOW = [
  {
    key: 'parse',
    title: '正在解析条款',
    detail: '识别正文结构、条款边界与段落定位锚点。',
    eta: '预计还需 12 - 18 秒',
    start: 0,
    end: 4,
    progressStart: 12,
    progressEnd: 32,
    tone: STATUS_TONES.blue,
    icon: ICONS.clipboard,
  },
  {
    key: 'match',
    title: '正在匹配法规',
    detail: '结合规则库检索适用依据，建立风险对应关系。',
    eta: '预计还需 8 - 12 秒',
    start: 4,
    end: 10,
    progressStart: 32,
    progressEnd: 58,
    tone: STATUS_TONES.purple,
    icon: ICONS.scale,
  },
  {
    key: 'suggest',
    title: '正在生成建议',
    detail: '整理风险说明、修改理由与建议替换文本。',
    eta: '预计还需 4 - 8 秒',
    start: 10,
    end: 16,
    progressStart: 58,
    progressEnd: 84,
    tone: STATUS_TONES.orange,
    icon: ICONS.pencil,
  },
  {
    key: 'finalize',
    title: '正在整理结果',
    detail: '汇总问题清单并准备最终对比审阅视图。',
    eta: '预计还需 1 - 3 秒',
    start: 16,
    end: 22,
    progressStart: 84,
    progressEnd: 96,
    tone: STATUS_TONES.green,
    icon: ICONS.check,
  },
];

function HintIcon({ title, color = '#98a2b3' }) {
  return (
    <Tooltip title={title}>
      <InfoCircleOutlined style={{ color, fontSize: 14, cursor: 'help' }} />
    </Tooltip>
  );
}

function issueTitle(issue, idx) {
  if (!issue) return '';
  return issue.issueDesc || issue.category || `问题 ${idx + 1}`;
}

function escapeReportHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br />');
}

export default function CaseAnalysis({ isDarkMode = false, currentUser }) {
  const [contractFile, setContractFile] = useState(null);
  const [docStructure, setDocStructure] = useState([]);
  const [reviewPoints, setReviewPoints] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [extraQuestions, setExtraQuestions] = useState('');
  const [targetParaIndex, setTargetParaIndex] = useState(null);
  const [activeIssueId, setActiveIssueId] = useState(null);
  const [customEditOpen, setCustomEditOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [exportEdits, setExportEdits] = useState({});
  const [libraryContracts, setLibraryContracts] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState(null);

  // ── 合同起草 state ──
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [draftType, setDraftType] = useState('采购合同');
  const [draftRequirements, setDraftRequirements] = useState('');
  const [draftGenerating, setDraftGenerating] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftExporting, setDraftExporting] = useState(false);

  const bg = isDarkMode
    ? 'linear-gradient(180deg, #08111f 0%, #0f172a 100%)'
    : 'linear-gradient(180deg, #f8fbff 0%, #eef3f9 100%)';
  const panelBg = isDarkMode
    ? 'linear-gradient(180deg, rgba(17,24,39,0.98) 0%, rgba(11,18,32,0.96) 100%)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,250,252,0.98) 100%)';
  const mutedBg = isDarkMode
    ? 'linear-gradient(180deg, rgba(11,18,32,0.96) 0%, rgba(15,23,42,0.98) 100%)'
    : 'linear-gradient(180deg, rgba(248,250,252,0.92) 0%, rgba(241,245,249,0.94) 100%)';
  const border = isDarkMode ? '1px solid #233044' : '1px solid rgba(15,23,42,0.07)';
  const textPrimary = isDarkMode ? '#f8fafc' : '#0f172a';
  const textSecondary = isDarkMode ? '#8fa0b7' : '#98a2b3';
  const textMuted = isDarkMode ? '#7b8ba1' : '#b0bac7';
  const shellShadow = isDarkMode ? '0 26px 70px rgba(2,6,23,0.44)' : '0 28px 72px rgba(15,23,42,0.08)';
  const cardShadow = isDarkMode ? '0 18px 40px rgba(2,6,23,0.34)' : '0 18px 40px rgba(15,23,42,0.06)';
  const strongCardShadow = isDarkMode ? '0 24px 56px rgba(2,6,23,0.38)' : '0 24px 56px rgba(15,23,42,0.08)';
  const topHighlight = isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : 'inset 0 1px 0 rgba(255,255,255,0.92)';

  useEffect(() => {
    let alive = true;
    const loadLibraryContracts = async () => {
      setLibraryLoading(true);
      try {
        const data = await fetchJson('/api/knowledge_files');
        if (!alive) return;
        const docs = (data?.files || [])
          .filter(item => item.type === 'docx' && item.savedName)
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        setLibraryContracts(docs);
      } catch (_) {
        if (alive) setLibraryContracts([]);
      } finally {
        if (alive) setLibraryLoading(false);
      }
    };
    loadLibraryContracts();
    return () => {
      alive = false;
    };
  }, []);

  const openIssues = useMemo(
    () => reviewPoints.filter(item => item.status !== 'resolved'),
    [reviewPoints],
  );
  const resolvedIssues = useMemo(
    () => reviewPoints.filter(item => item.status === 'resolved'),
    [reviewPoints],
  );
  const progressPercent = reviewPoints.length ? Math.round((resolvedIssues.length / reviewPoints.length) * 100) : 0;

  const issuesByCategory = useMemo(() => {
    const groups = {};
    openIssues.forEach(item => {
      const key = item.category || '其他重要条款';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [openIssues]);

  const categoryRailItems = useMemo(() => (
    Object.entries(issuesByCategory).map(([category, items]) => ({
      category,
      count: items.length,
      icon: CATEGORY_META[category]?.icon || ICONS.clipboard,
      short: CATEGORY_META[category]?.short || category.slice(0, 2),
      firstId: items[0]?.id,
    }))
  ), [issuesByCategory]);

  const activeIssue = useMemo(
    () => openIssues.find(item => item.id === activeIssueId) || openIssues[0] || null,
    [openIssues, activeIssueId],
  );
  const activeIndex = activeIssue ? openIssues.findIndex(item => item.id === activeIssue.id) : -1;
  const activeSeverity = activeIssue ? (SEV[activeIssue.severity] || SEV.medium) : SEV.medium;
  const highRiskCount = openIssues.filter(item => item.severity === 'high').length;
  const normalRiskCount = openIssues.filter(item => item.severity !== 'high').length;
  const canExportReviewedDoc = Boolean(contractFile?.saved_name && Object.keys(exportEdits).length > 0);
  const canExportDocument = Boolean(contractFile?.saved_name);
  const analysisStage = useMemo(() => {
    if (!analyzing) return null;
    const currentIndex = ANALYSIS_STAGE_FLOW.findIndex((stage, index) => (
      analysisElapsed >= stage.start && (
        index === ANALYSIS_STAGE_FLOW.length - 1 || analysisElapsed < stage.end
      )
    ));
    const safeIndex = currentIndex === -1 ? ANALYSIS_STAGE_FLOW.length - 1 : currentIndex;
    const stage = ANALYSIS_STAGE_FLOW[safeIndex];
    const stageSpan = Math.max(stage.end - stage.start, 1);
    const stageRatio = Math.min(Math.max((analysisElapsed - stage.start) / stageSpan, 0), 1);
    const progress = Math.round(stage.progressStart + ((stage.progressEnd - stage.progressStart) * stageRatio));
    return {
      ...stage,
      index: safeIndex,
      progress,
      dots: '.'.repeat((analysisElapsed % 3) + 1),
      elapsedLabel: `${analysisElapsed} 秒`,
    };
  }, [analysisElapsed, analyzing]);
  const analysisStageItems = useMemo(() => {
    if (!analysisStage) {
      return ANALYSIS_STAGE_FLOW.map(stage => ({ ...stage, status: 'pending' }));
    }
    return ANALYSIS_STAGE_FLOW.map((stage, index) => ({
      ...stage,
      status: index < analysisStage.index ? 'complete' : index === analysisStage.index ? 'current' : 'pending',
    }));
  }, [analysisStage]);
  const workflowSteps = useMemo(() => {
    const reviewDone = analysisDone && reviewPoints.length === 0;
    return [
      {
        key: 'loaded',
        title: '1. 合同已载入',
        detail: `${docStructure.length || 0} 段正文`,
        status: 'done',
        tone: STATUS_TONES.green,
      },
      {
        key: 'analyze',
        title: '2. AI 审查',
        detail: analyzing ? (analysisStage?.title || '正在分析') : analysisDone ? '结果已生成' : '等待开始',
        status: analyzing ? 'active' : analysisDone ? 'done' : 'pending',
        tone: analyzing ? (analysisStage?.tone || STATUS_TONES.blue) : analysisDone ? STATUS_TONES.green : STATUS_TONES.gray,
      },
      {
        key: 'review',
        title: '3. 处理建议',
        detail: openIssues.length ? `${openIssues.length} 条待处理` : reviewDone ? '未发现问题' : `${resolvedIssues.length} 条已处理`,
        status: openIssues.length ? 'active' : analysisDone ? 'done' : 'pending',
        tone: openIssues.length ? STATUS_TONES.orange : analysisDone ? STATUS_TONES.green : STATUS_TONES.gray,
      },
      {
        key: 'export',
        title: '4. 导出审查版',
        detail: resolvedIssues.length ? '可导出修改稿' : '采纳建议后可导出',
        status: resolvedIssues.length ? 'active' : progressPercent === 100 && reviewPoints.length ? 'done' : 'pending',
        tone: resolvedIssues.length ? STATUS_TONES.blue : progressPercent === 100 && reviewPoints.length ? STATUS_TONES.green : STATUS_TONES.gray,
      },
    ];
  }, [analysisDone, analysisStage, analyzing, docStructure.length, openIssues.length, progressPercent, resolvedIssues.length, reviewPoints.length]);
  const currentGuidance = useMemo(() => {
    if (analyzing) {
      return {
        title: analysisStage ? `${analysisStage.title}${analysisStage.dots}` : 'AI 正在审查合同',
        detail: '先等待右侧结果生成；左侧预览会自动加载，审查完成后可逐条定位条款。',
        tone: analysisStage?.tone || STATUS_TONES.blue,
      };
    }
    if (openIssues.length) {
      return {
        title: `处理第 ${Math.max(activeIndex + 1, 1)} / ${openIssues.length} 条建议`,
        detail: '先点“定位条款”看左侧原文，再选择“一键采纳建议”或“自定义修改”。',
        tone: STATUS_TONES.orange,
      };
    }
    if (resolvedIssues.length) {
      return {
        title: '建议已处理，可以导出审查版',
        detail: '左侧底部点击“导出审查版”，生成带修改结果的 Word 文件。',
        tone: STATUS_TONES.green,
      };
    }
    return {
      title: '等待审查结果',
      detail: '系统会先解析合同，再匹配法规并生成建议。',
      tone: STATUS_TONES.gray,
    };
  }, [activeIndex, analysisStage, analyzing, openIssues.length, resolvedIssues.length]);

  useEffect(() => {
    if (!openIssues.length) {
      setActiveIssueId(null);
      return;
    }
    if (!activeIssueId || !openIssues.some(item => item.id === activeIssueId)) {
      setActiveIssueId(openIssues[0].id);
    }
  }, [openIssues, activeIssueId]);

  useEffect(() => {
    if (!analyzing) {
      setAnalysisElapsed(0);
      return undefined;
    }
    setAnalysisElapsed(0);
    const timer = window.setInterval(() => {
      setAnalysisElapsed(value => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const persistSuggestion = async (issue, suggestedText) => {
    if (!contractFile?.saved_name || !issue?.bookmark_name) return;
    try {
      await authFetch('/api/doc/submit_suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saved_name: contractFile.saved_name,
          bookmark_name: issue.bookmark_name,
          original_text: issue.originalText || '',
          suggested_text: suggestedText || '',
          reason: issue.reason || '',
        }),
      });
    } catch (_) {
      // Suggestions are auxiliary; UI actions should not fail on this write.
    }
  };

  const applyResolution = async (issue, nextText, mode = 'adopted') => {
    if (!issue) return;
    if (issue.para_index == null) {
      antMessage.warning('当前条款缺少段落定位，无法直接写入左侧文档。');
      return;
    }
    setTargetParaIndex({
      action: 'replace',
      paraIndex: issue.para_index,
      text: issue.originalText,
      replaceText: nextText,
      ts: Date.now(),
    });
    setExportEdits(prev => ({
      ...prev,
      [issue.para_index]: nextText || '',
    }));
    await persistSuggestion(issue, nextText);
    setReviewPoints(prev => prev.map(item => (
      item.id === issue.id
        ? { ...item, status: 'resolved', resolvedMode: mode, resolvedText: nextText }
        : item
    )));
    antMessage.success(mode === 'custom' ? '已按自定义文本写入左侧文档' : '已采纳建议并写入左侧文档');
  };

  const handleLocate = (issue) => {
    if (!issue) return;
    setActiveIssueId(issue.id);
    setTargetParaIndex({
      action: 'locate',
      paraIndex: issue.para_index,
      text: issue.originalText,
      ts: Date.now(),
    });
  };

  const openCustomEdit = (issue) => {
    if (!issue) return;
    setActiveIssueId(issue.id);
    setCustomDraft(issue.suggestedText || issue.originalText || '');
    setCustomEditOpen(true);
  };

  const submitCustomEdit = async () => {
    if (!activeIssue) return;
    const text = customDraft.trim();
    if (!text) {
      antMessage.warning('请输入修改后的条款内容');
      return;
    }
    await applyResolution(activeIssue, text, 'custom');
    setCustomEditOpen(false);
  };

  const jumpIssue = (direction) => {
    if (!openIssues.length || activeIndex < 0) return;
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= openIssues.length) return;
    const nextIssue = openIssues[nextIndex];
    setActiveIssueId(nextIssue.id);
    handleLocate(nextIssue);
  };

  const handleUpload = async (file) => {
    if (!file.name.endsWith('.docx')) {
      antMessage.error('仅支持 .docx 格式文件');
      return false;
    }
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const uploadResp = await authFetch('/api/doc/upload', { method: 'POST', body: fd });
      const uploadData = await uploadResp.json();
      if (!uploadData.success) throw new Error(uploadData.message || '上传失败');

      // Persist a record in knowledge_files so the contract appears in history
      const userId = `cu_${Date.now()}`;
      authFetch('/api/knowledge_files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userId,
          name: file.name,
          type: 'docx',
          size: `${Math.round(file.size / 1024)} KB`,
          date: new Date().toISOString().slice(0, 10),
          tags: ['合同审查'],
          linked: false,
          vectorized: false,
          uploader: currentUser?.name || '未知用户',
          uploaderRole: currentUser?.role || 'staff',
          dept: currentUser?.dept || '合规法务部',
          libraryCategory: 'cases',
          savedName: uploadData.saved_as,
        }),
      }).catch(err => console.warn('[ContractUpload] 知识库记录创建失败:', err));

      const mapResp = await authFetch('/api/contract/map_doc_structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved_name: uploadData.saved_as }),
      });
      const mapData = await mapResp.json();
      if (!mapData.success) throw new Error(mapData.detail || '文档解析失败');

      setContractFile({ saved_name: uploadData.saved_as, file_name: file.name });
      setDocStructure(mapData.paragraphs || []);
      setReviewPoints([]);
      setExportEdits({});
      setAnalysisDone(false);
      setActiveIssueId(null);
      setTargetParaIndex(null);
      window.setTimeout(() => {
        void runAnalysis(uploadData.saved_as, mapData.paragraphs, []);
      }, 800);
    } catch (err) {
      antMessage.error(`上传失败：${err.message}`);
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleUseLibraryContract = async (record) => {
    if (!record?.savedName) {
      antMessage.warning('该知识库文件没有可审查的 Word 实体，请重新上传');
      return;
    }
    setUploading(true);
    try {
      const mapResp = await authFetch('/api/contract/map_doc_structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved_name: record.savedName }),
      });
      const mapData = await mapResp.json();
      if (!mapData.success) throw new Error(mapData.detail || '文档解析失败');

      setContractFile({ saved_name: record.savedName, file_name: record.name });
      setDocStructure(mapData.paragraphs || []);
      setReviewPoints([]);
      setExportEdits({});
      setAnalysisDone(false);
      setActiveIssueId(null);
      setTargetParaIndex(null);
      window.setTimeout(() => {
        void runAnalysis(record.savedName, mapData.paragraphs, []);
      }, 800);
    } catch (err) {
      antMessage.error(`载入失败：${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const runAnalysis = async (savedName, structure, prev) => {
    setAnalyzing(true);
    try {
      const body = { saved_name: savedName, doc_structure: structure, extra_questions: [] };
      if (prev.length > 0) body.previous_issues = prev;
      const resp = await authFetch('/api/contract/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 检查 Content-Type 避免解析 HTML 错误页
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        throw new Error('后端服务暂时不可用，请稍后重试');
      }
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const errJson = await resp.json();
          detail = errJson.detail || errJson.message || detail;
        } catch (_) {}
        throw new Error(detail);
      }
      const data = await resp.json();
      if (!data.success) throw new Error(data.detail || '审查失败');
      setReviewPoints(data.review_points || []);
      setAnalysisDone(true);
      antMessage.success(`AI 审查完成，发现 ${data.review_points?.length || 0} 条建议`);
    } catch (err) {
      antMessage.error(`审查失败：${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReAnalyze = async () => {
    const questions = extraQuestions.split('\n').filter(item => item.trim());
    if (!questions.length || !contractFile) return;
    setAnalyzing(true);
    try {
      const resp = await authFetch('/api/contract/re_analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saved_name: contractFile.saved_name,
          doc_structure: docStructure,
          extra_questions: questions,
          previous_issues: reviewPoints,
        }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.detail || '追加审查失败');
      setReviewPoints(data.review_points || []);
      setExtraQuestions('');
      antMessage.success('追加审查完成');
    } catch (err) {
      antMessage.error(`追加审查失败：${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExportReviewedDoc = async (editedParagraphs = exportEdits) => {
    if (!contractFile?.saved_name) {
      antMessage.warning('当前没有可导出的合同文件');
      return;
    }

    const changedCount = Object.keys(editedParagraphs || {}).length;
    if (!changedCount) {
      antMessage.info('当前没有可导出的修改内容');
      return;
    }

    const resp = await authFetch('/api/doc/export_reviewed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saved_name: contractFile.saved_name,
        edits: editedParagraphs,
      }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.detail || data.message || `导出失败：HTTP ${resp.status}`);
    }

    const downloadUrl = data.download_url?.startsWith('/api/')
      ? data.download_url
      : `/api${data.download_url}`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = data.filename || `${contractFile.file_name || '合同'}_审查版.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    antMessage.success(data.message || `已生成审查版文件，共导出 ${changedCount} 处修改`);
  };

  const handleExportReviewResult = () => {
    if (!contractFile?.saved_name) {
      antMessage.warning('当前没有可导出的合同文件');
      return;
    }
    if (!analysisDone) {
      antMessage.info('审查完成后可导出结果');
      return;
    }

    const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    const rows = reviewPoints.length
      ? reviewPoints.map((issue, index) => {
          const severity = SEV[issue.severity] || SEV.medium;
          return `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeReportHtml(severity.badge)}</td>
              <td>${escapeReportHtml(issue.category || '未分类')}</td>
              <td>第 ${Number(issue.para_index ?? 0) + 1} 段</td>
              <td>${escapeReportHtml(issue.issueDesc || issue.reason || '风险条款')}</td>
              <td>${escapeReportHtml(issue.originalText || '未提取到原文')}</td>
              <td>${escapeReportHtml(issue.suggestedText || '建议人工复核完善')}</td>
              <td>${escapeReportHtml(issue.rule || issue.reason || '未检索到法规依据')}</td>
            </tr>
          `;
        }).join('')
      : `
          <tr>
            <td colspan="8" style="text-align:center;">本次审查未发现明确风险条款。</td>
          </tr>
        `;

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>合同审查结果</title>
          <style>
            body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; line-height: 1.7; }
            h1 { font-size: 24px; margin: 0 0 18px; }
            h2 { font-size: 18px; margin: 24px 0 12px; }
            .meta { color: #475467; font-size: 13px; margin-bottom: 18px; }
            .summary { display: table; width: 100%; margin: 16px 0 22px; border-collapse: collapse; }
            .summary div { display: table-cell; border: 1px solid #d8dee8; padding: 12px; }
            .summary strong { display: block; font-size: 20px; color: #2457f5; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #f3f6fb; color: #111827; }
            th, td { border: 1px solid #d8dee8; padding: 8px; vertical-align: top; }
          </style>
        </head>
        <body>
          <h1>合同审查结果报告</h1>
          <div class="meta">
            合同名称：${escapeReportHtml(contractFile.file_name || contractFile.saved_name)}<br />
            生成时间：${escapeReportHtml(generatedAt)}<br />
            正文段落：${docStructure.length || 0} 段
          </div>
          <div class="summary">
            <div><strong>${reviewPoints.length}</strong>审查问题</div>
            <div><strong>${highRiskCount}</strong>重大风险</div>
            <div><strong>${normalRiskCount}</strong>一般风险</div>
            <div><strong>${resolvedIssues.length}</strong>已处理</div>
          </div>
          <h2>风险明细</h2>
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>风险等级</th>
                <th>分类</th>
                <th>位置</th>
                <th>风险说明</th>
                <th>原文</th>
                <th>建议修改</th>
                <th>依据/理由</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const link = document.createElement('a');
    const baseName = (contractFile.file_name || '合同').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${baseName}_审查结果报告.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    antMessage.success('已导出合同审查结果报告');
  };

  const handleExportContractDocument = async () => {
    if (!contractFile?.saved_name) {
      antMessage.warning('当前没有可导出的合同文件');
      return;
    }

    if (Object.keys(exportEdits).length > 0) {
      await handleExportReviewedDoc(exportEdits);
      return;
    }

    const link = document.createElement('a');
    link.href = `/api/doc/download/${encodeURIComponent(contractFile.saved_name)}`;
    link.download = contractFile.file_name || contractFile.saved_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    antMessage.success('已导出原合同文档');
  };

  const handleReset = () => {
    setContractFile(null);
    setDocStructure([]);
    setReviewPoints([]);
    setExportEdits({});
    setUploading(false);
    setAnalyzing(false);
    setAnalysisDone(false);
    setExtraQuestions('');
    setTargetParaIndex(null);
    setActiveIssueId(null);
    setCustomDraft('');
    setCustomEditOpen(false);
    setAnalysisElapsed(0);
  };

  // ── 合同起草 handlers ──
  const handleDraftGenerate = async () => {
    if (!draftRequirements.trim()) {
      antMessage.warning('请输入合同需求描述');
      return;
    }
    setDraftGenerating(true);
    setDraftMarkdown('');
    try {
      const resp = await authFetch('/api/contract/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_type: draftType,
          requirements: draftRequirements.trim(),
        }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.detail || '生成失败');
      setDraftMarkdown(data.markdown);
      setDraftTitle(data.title);
      antMessage.success('合同草案已生成');
    } catch (err) {
      antMessage.error(`生成失败：${err.message}`);
    } finally {
      setDraftGenerating(false);
    }
  };

  const handleDraftExport = async () => {
    if (!draftMarkdown) {
      antMessage.warning('请先生成合同草案');
      return;
    }
    setDraftExporting(true);
    try {
      const resp = await authFetch('/api/contract/draft/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: draftMarkdown,
          title: draftTitle || draftType,
        }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.detail || '导出失败');

      // Download the file
      const link = document.createElement('a');
      link.href = `/api${data.download_url}`;
      link.download = data.filename || `${draftTitle}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      antMessage.success('合同 Word 文档已下载');

      // Also save to knowledge_files so it appears in history
      authFetch('/api/knowledge_files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `draft_${Date.now()}`,
          name: data.filename || `${draftTitle}.docx`,
          type: 'docx',
          size: 'AI 生成',
          date: new Date().toISOString().slice(0, 10),
          tags: ['AI起草', draftType],
          linked: false,
          vectorized: false,
          uploader: currentUser?.name || 'AI助手',
          uploaderRole: currentUser?.role || 'staff',
          dept: currentUser?.dept || '合规法务部',
          libraryCategory: 'cases',
          savedName: data.saved_as,
        }),
      }).catch(err => console.warn('[Draft] 知识库记录创建失败:', err));
    } catch (err) {
      antMessage.error(`导出失败：${err.message}`);
    } finally {
      setDraftExporting(false);
    }
  };

  const handleDraftReview = async () => {
    // Close modal and start reviewing the generated contract
    if (!draftMarkdown || !draftTitle) {
      antMessage.warning('请先生成并导出合同草案');
      return;
    }
    // Trigger the same flow as uploading a document
    setDraftModalOpen(false);
    // The document is already saved via handleDraftExport
    antMessage.info('请从历史合同任务中选择刚导出的合同进行审查');
  };

  if (!contractFile) {
    return (
      <>
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDarkMode ? '#08111f' : '#fff',
            padding: '28px 36px',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ maxWidth: 1360, width: '100%', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 34 }}>
              <Title
                level={1}
                style={{
                  margin: 0,
                  color: textPrimary,
                  fontSize: 44,
                  lineHeight: 1.15,
                  fontWeight: 850,
                  fontStyle: 'italic',
                  letterSpacing: 0,
                }}
              >
                AI 合同审查 - 专属法律顾问
              </Title>
              <div style={{ marginTop: 14, color: textSecondary, fontSize: 15 }}>
                上传合同，系统自动解析条款、定位风险、生成修改建议并导出审查版
              </div>
              <div style={{ display: 'inline-flex', gap: 12, marginTop: 28 }}>
                <Button
                  size="large"
                  icon={<ICONS.pencil size={17} color="#111827" />}
                  onClick={() => setDraftModalOpen(true)}
                  style={{
                    height: 46,
                    borderRadius: 999,
                    padding: '0 22px',
                    border: isDarkMode ? '1px solid #233044' : '1px solid #d8dee8',
                    background: isDarkMode ? '#0b1220' : '#fff',
                    color: textPrimary,
                    fontWeight: 700,
                  }}
                >
                  合同起草
                </Button>
                <Button
                  size="large"
                  type="primary"
                  icon={<FileProtectOutlined />}
                  style={{
                    height: 46,
                    borderRadius: 999,
                    padding: '0 22px',
                    background: '#5b3ff2',
                    borderColor: '#5b3ff2',
                    boxShadow: '0 14px 28px rgba(91,63,242,0.2)',
                    fontWeight: 700,
                  }}
                >
                  合同审查
                </Button>
              </div>
            </div>

            <div
              style={{
                borderRadius: 26,
                background: panelBg,
                border: isDarkMode ? '1px solid #233044' : '1px solid #dfe4ee',
                boxShadow: isDarkMode ? shellShadow : '0 20px 60px rgba(15,23,42,0.06)',
                overflow: 'hidden',
              }}
            >
              <Upload.Dragger
                accept=".docx"
                beforeUpload={handleUpload}
                showUploadList={false}
                disabled={uploading}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  borderBottom: isDarkMode ? '1px solid #233044' : '1px solid #edf0f6',
                  background: isDarkMode
                    ? 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(11,18,32,0.98) 100%)'
                    : 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
                  padding: '64px 28px',
                }}
              >
                {uploading ? (
                  <div style={{ padding: 16 }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 16, color: '#5b3ff2', fontWeight: 700 }}>正在上传并建立审查任务...</div>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        margin: '0 auto 18px',
                        borderRadius: 24,
                        background: isDarkMode ? 'rgba(91,63,242,0.16)' : 'linear-gradient(180deg, #eef2ff 0%, #dfe6ff 100%)',
                        color: '#5b3ff2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 32,
                      }}
                    >
                      <FileProtectOutlined />
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: textPrimary, marginBottom: 8 }}>
                      将合同拖拽到此处或点击上传
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: textSecondary }}>
                      <span>支持 DOCX 文件，上传后自动进入三栏审查界面</span>
                      <HintIcon title="上传后会自动进入对比审阅界面。" color={textSecondary} />
                    </div>
                  </>
                )}
              </Upload.Dragger>

              <div style={{ padding: '22px 24px 26px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>历史合同任务</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: textSecondary }}>
                      可直接从知识库选择已上传合同继续审查。
                    </div>
                  </div>
                  <Tag color="default" style={{ margin: 0 }}>{libraryContracts.length} 份可用</Tag>
                </div>

                {libraryLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
                    <Spin />
                  </div>
                ) : libraryContracts.length === 0 ? (
                  <Card
                    bordered={false}
                    style={{ borderRadius: 20, background: mutedBg, border, boxShadow: cardShadow }}
                    styles={{ body: { padding: 18 } }}
                  >
                    <Empty description="知识库里还没有可直接审查的 Word 合同" />
                  </Card>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                    {libraryContracts.slice(0, 6).map((item) => (
                      <Card
                        key={item.id}
                        bordered={false}
                        style={{
                          borderRadius: 16,
                          background: isDarkMode ? '#0b1220' : '#fff',
                          border,
                          boxShadow: 'none',
                        }}
                        styles={{ body: { padding: 14 } }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: textPrimary, lineHeight: 1.4 }}>
                              {item.name}
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              <Tag color="blue" style={{ margin: 0 }}>DOCX</Tag>
                              {item.libraryCategory && (
                                <Tag color="default" style={{ margin: 0 }}>{item.libraryCategory}</Tag>
                              )}
                            </div>
                          </div>
                          <FileTextOutlined style={{ color: '#5b6cff', fontSize: 18, flexShrink: 0 }} />
                        </div>

                        <div style={{ marginTop: 12, fontSize: 12, color: textSecondary, lineHeight: 1.7 }}>
                          上传人：{item.uploader || '未知'} · 日期：{item.date || '--'}
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                          <Button
                            icon={<EyeOutlined />}
                            onClick={() => setPreviewFile({ savedName: item.savedName, name: item.name })}
                            style={{ flex: 1, borderRadius: 14 }}
                          >
                            预览
                          </Button>
                          <Button
                            type="primary"
                            loading={uploading}
                            onClick={() => handleUseLibraryContract(item)}
                            style={{
                              flex: 1,
                              borderRadius: 12,
                              background: '#5b3ff2',
                              borderColor: '#5b3ff2',
                            }}
                          >
                            继续审查
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <DocxPreviewModal
          open={Boolean(previewFile)}
          savedName={previewFile?.savedName}
          title={previewFile?.name || 'DOCX 预览'}
          onClose={() => setPreviewFile(null)}
        />

        {/* ── AI 合同起草 Modal ── */}
        <Modal
          open={draftModalOpen}
          title="AI 合同起草"
          onCancel={() => { setDraftModalOpen(false); setDraftMarkdown(''); }}
          width={900}
          footer={null}
          destroyOnClose
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Step 1: Input */}
            <Card
              size="small"
              bordered={false}
              style={{ borderRadius: 14, background: isDarkMode ? '#0b1220' : '#f8fafc', border }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <Text strong style={{ color: textPrimary }}>合同类型</Text>
                <select
                  value={draftType}
                  onChange={e => setDraftType(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: isDarkMode ? '1px solid #374151' : '1px solid #d4d9e2',
                    background: isDarkMode ? '#111827' : '#fff',
                    color: textPrimary,
                    fontSize: 14,
                  }}
                >
                  {['采购合同', '服务合同', '劳动合同', '租赁合同', '技术开发合同', '保密协议', '战略合作协议', '股权转让协议', '委托合同', '其他合同'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ color: textPrimary, marginBottom: 8, display: 'block' }}>需求描述</Text>
                <TextArea
                  value={draftRequirements}
                  onChange={e => setDraftRequirements(e.target.value)}
                  placeholder={`请描述您的合同需求，例如：\n• 合同标的/服务内容\n• 金额与支付方式\n• 交付期限\n• 特殊条款要求\n• 其他关注点\n\n描述越详细，AI 生成的合同越贴合实际需求。`}
                  autoSize={{ minRows: 5, maxRows: 10 }}
                  style={{ borderRadius: 12 }}
                />
              </div>
              <Button
                type="primary"
                loading={draftGenerating}
                onClick={handleDraftGenerate}
                icon={<ICONS.bulb size={16} color="#fff" />}
                style={{
                  height: 42,
                  borderRadius: 12,
                  background: '#5b3ff2',
                  borderColor: '#5b3ff2',
                  fontWeight: 700,
                }}
                block
              >
                {draftGenerating ? 'AI 正在起草合同…' : 'AI 生成合同草案'}
              </Button>
            </Card>

            {/* Step 2: Preview & Export */}
            {draftMarkdown && (
              <Card
                size="small"
                bordered={false}
                style={{ borderRadius: 14, background: isDarkMode ? '#0b1220' : '#f8fafc', border }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: textPrimary }}>📝 {draftTitle}</span>
                    <Space>
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => Modal.info({
                          title: draftTitle,
                          width: 800,
                          content: (
                            <div style={{ maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, padding: 8 }}>
                              {draftMarkdown}
                            </div>
                          ),
                        })}
                      >
                        纯文本预览
                      </Button>
                      <Button
                        type="primary"
                        size="small"
                        loading={draftExporting}
                        onClick={handleDraftExport}
                        icon={<FileTextOutlined />}
                        style={{ borderRadius: 10, fontWeight: 600 }}
                      >
                        导出 Word 文档
                      </Button>
                    </Space>
                  </div>
                }
              >
                <div
                  style={{
                    maxHeight: 380,
                    overflow: 'auto',
                    background: isDarkMode ? '#111827' : '#fff',
                    borderRadius: 12,
                    border,
                    padding: 16,
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: textPrimary,
                  }}
                >
                  {draftMarkdown}
                </div>
              </Card>
            )}
          </div>
        </Modal>
      </>
    );
  }

  return (
    <Layout
      style={{
        height: '100%',
        background: isDarkMode ? '#08111f' : '#eef5ff',
        borderRadius: 18,
        overflow: 'hidden',
        padding: 10,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          minHeight: 58,
          flexShrink: 0,
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          background: isDarkMode ? '#0b1220' : '#fff',
          border,
          borderRadius: 16,
          boxShadow: 'none',
          marginBottom: 10,
        }}
      >
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Button
              icon={<LeftOutlined />}
              onClick={handleReset}
              style={{
                borderRadius: 14,
                border,
                background: isDarkMode ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.84)',
                boxShadow: topHighlight,
              }}
            />
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: '#5b3ff2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FileTextOutlined style={{ color: '#fff', fontSize: 18 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Title level={5} style={{ margin: 0, color: textPrimary, maxWidth: 480 }} ellipsis={{ tooltip: contractFile.file_name }}>
                  {contractFile.file_name}
                </Title>
                <Tag color="default" style={{ margin: 0 }}>{docStructure.length} 段正文</Tag>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <Tag color={openIssues.length ? 'warning' : 'success'} style={{ margin: 0 }}>
              待处理 {openIssues.length}
            </Tag>
            <Tag color="success" style={{ margin: 0 }}>
              已处理 {resolvedIssues.length}
            </Tag>
            {analyzing && analysisStage && (
              <Tag icon={<SyncOutlined spin />} color="processing" style={{ margin: 0 }}>
                {analysisStage.title}
              </Tag>
            )}
            <Tooltip title="打开 DOCX 原文预览">
              <Button
                icon={<EyeOutlined />}
                onClick={() => setPreviewFile({ savedName: contractFile.saved_name, name: contractFile.file_name })}
                style={{
                  borderRadius: 14,
                  border,
                  background: isDarkMode ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.84)',
                  boxShadow: topHighlight,
                }}
              />
            </Tooltip>
          </div>
        </div>

        <div style={{ width: '100%', display: 'none', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 380px)', gap: 14, alignItems: 'stretch' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {workflowSteps.map(step => {
              const isActive = step.status === 'active';
              const isDone = step.status === 'done';
              return (
                <div
                  key={step.key}
                  style={{
                    minHeight: 54,
                    padding: '10px 12px',
                    borderRadius: 16,
                    background: isDarkMode
                      ? 'linear-gradient(180deg, rgba(17,24,39,0.92) 0%, rgba(11,18,32,0.96) 100%)'
                      : `linear-gradient(180deg, rgba(255,255,255,0.96) 0%, ${step.tone.soft} 100%)`,
                    border: `1px solid ${isActive ? step.tone.solid : step.tone.border}`,
                    boxShadow: isActive ? strongCardShadow : cardShadow,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: isActive ? step.tone.text : textPrimary }}>
                      {step.title}
                    </span>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: isDone ? '#fff' : step.tone.text,
                        background: isDone ? step.tone.solid : '#fff',
                        border: `1px solid ${step.tone.border}`,
                        flexShrink: 0,
                      }}
                    >
                      {isDone ? '✓' : isActive ? '•' : ''}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {step.detail}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 16,
              background: isDarkMode ? '#0b1220' : currentGuidance.tone.soft,
              border: `1px solid ${currentGuidance.tone.border}`,
              boxShadow: cardShadow,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: currentGuidance.tone.text }}>当前要做什么</div>
            <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: textPrimary }}>{currentGuidance.title}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: textSecondary, lineHeight: 1.5 }}>{currentGuidance.detail}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px minmax(0, 1fr) 460px',
          gap: 10,
          minHeight: 0,
          flex: 1,
          background: 'transparent',
          overflow: 'hidden',
          boxShadow: 'none',
        }}
      >
        <div
          style={{
            minHeight: 0,
            borderRadius: 18,
            background: isDarkMode ? '#0b1220' : '#fff',
            border,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Button
            type="primary"
            block
            onClick={handleReset}
            style={{
              height: 44,
              borderRadius: 12,
              background: '#5b3ff2',
              borderColor: '#5b3ff2',
              fontWeight: 800,
            }}
          >
            新建任务
          </Button>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text strong style={{ color: textPrimary }}>全部任务</Text>
            <Text style={{ color: textMuted, fontSize: 12 }}>{libraryContracts.length + 1}</Text>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0, paddingRight: 2 }}>
            {[{
              id: 'current',
              name: contractFile.file_name,
              date: '当前审查',
              status: analyzing ? '运行中' : analysisDone ? '已完成' : '已载入',
              active: true,
            }, ...libraryContracts.slice(0, 8).map(item => ({
              id: item.id,
              name: item.name,
              date: item.date || '--',
              status: '知识库',
              active: false,
              item,
            }))].map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => task.item ? handleUseLibraryContract(task.item) : undefined}
                style={{
                  width: '100%',
                  border: task.active ? '1px solid rgba(91,63,242,0.22)' : border,
                  background: task.active ? 'rgba(91,63,242,0.08)' : (isDarkMode ? '#111827' : '#fff'),
                  borderRadius: 12,
                  padding: 10,
                  textAlign: 'left',
                  cursor: task.item ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <FileTextOutlined style={{ color: task.active ? '#5b3ff2' : '#3370ff', marginTop: 2, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: task.active ? '#2457f5' : textPrimary, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.name}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: textMuted, fontSize: 12 }}>{task.date}</span>
                      <span style={{ color: task.status === '运行中' ? '#5b3ff2' : '#52c41a', fontSize: 12 }}>{task.status}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <Content style={{ minWidth: 0, border, borderRadius: 18, overflow: 'hidden', background: isDarkMode ? '#0d1727' : '#f6f9fd' }}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '14px 16px', borderBottom: border, background: isDarkMode ? '#0b1220' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: textPrimary }}>原文与审查定位</div>
                <div style={{ marginTop: 3, fontSize: 12, color: textSecondary }}>点击问题右侧的定位，快速跳到对应段落；采纳后的文本会在这里显示。</div>
              </div>
              <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewFile({ savedName: contractFile.saved_name, name: contractFile.file_name })}>
                DOCX 预览
              </Button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              {docStructure.length ? docStructure.map((paragraph, index) => {
                const originalText = paragraph?.text || paragraph?.content || paragraph?.text_preview || '';
                const displayText = Object.prototype.hasOwnProperty.call(exportEdits, index)
                  ? exportEdits[index]
                  : originalText;
                const issue = reviewPoints.find(item => Number(item.para_index) === index);
                const highlighted = targetParaIndex?.paraIndex === index;
                return (
                  <div
                    key={`paragraph-${index}`}
                    onClick={() => setTargetParaIndex({ action: 'locate', paraIndex: index, ts: Date.now() })}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: '11px 12px',
                      marginBottom: 8,
                      borderRadius: 12,
                      border: `1px solid ${highlighted ? '#2457f5' : issue ? 'rgba(234,88,12,0.24)' : (isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)')}`,
                      background: highlighted ? (isDarkMode ? 'rgba(36,87,245,0.16)' : '#eef4ff') : (issue ? (isDarkMode ? 'rgba(124,58,237,0.08)' : '#fffaf5') : (isDarkMode ? 'rgba(15,23,42,0.56)' : '#fff')),
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ minWidth: 28, color: textMuted, fontSize: 11, fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>{index + 1}</span>
                    <div style={{ minWidth: 0, flex: 1, color: textPrimary, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{displayText || '（空段落）'}</div>
                    {issue && <Tag color={issue.status === 'resolved' ? 'success' : 'warning'} style={{ margin: 0, flexShrink: 0 }}>{issue.status === 'resolved' ? '已处理' : '风险'}</Tag>}
                  </div>
                );
              }) : <Empty description="暂无可预览的正文段落" />}
            </div>
          </div>
        </Content>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minHeight: 0, background: panelBg, border, borderRadius: 18, overflow: 'hidden' }}>
          <div
            style={{
              display: 'none',
              borderRight: border,
              background: isDarkMode ? '#0b1220' : 'linear-gradient(180deg, rgba(251,252,254,0.98) 0%, rgba(244,247,251,0.98) 100%)',
              padding: '18px 10px',
              boxShadow: topHighlight,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Tooltip title="当前问题总览">
                <div
                  style={{
                    height: 52,
                    borderRadius: 16,
                    border: `1px solid ${openIssues.length ? STATUS_TONES.orange.border : STATUS_TONES.green.border}`,
                    background: openIssues.length ? STATUS_TONES.orange.soft : STATUS_TONES.green.soft,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: openIssues.length ? STATUS_TONES.orange.text : STATUS_TONES.green.text,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{openIssues.length}</div>
                  <div>待处理</div>
                </div>
              </Tooltip>
              {categoryRailItems.map(item => (
                <Tooltip key={item.category} title={`${item.category} · ${item.count} 条`}>
                  {(() => {
                    const CategoryIcon = item.icon;
                    const isActive = activeIssue?.category === item.category;
                    return (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveIssueId(item.firstId);
                      const firstIssue = openIssues.find(issue => issue.id === item.firstId);
                      if (firstIssue) handleLocate(firstIssue);
                    }}
                    style={{
                      border: activeIssue?.category === item.category ? '1px solid rgba(109,94,252,0.42)' : border,
                      background: activeIssue?.category === item.category
                        ? 'linear-gradient(180deg, rgba(109,94,252,0.12) 0%, rgba(255,255,255,0.98) 100%)'
                        : panelBg,
                      borderRadius: 18,
                      height: 62,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      cursor: 'pointer',
                      boxShadow: isActive ? strongCardShadow : cardShadow,
                    }}
                  >
                    <CategoryIcon size={18} color={isActive ? '#111827' : '#111827'} />
                    <span style={{ fontSize: 11, color: '#475467' }}>{item.short}</span>
                    <span style={{ fontSize: 10, color: '#7c4dff', fontWeight: 700 }}>{item.count}</span>
                  </button>
                    );
                  })()}
                </Tooltip>
              ))}
            </div>
          </div>

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '14px 16px 12px', borderBottom: border, boxShadow: topHighlight }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Title level={4} style={{ margin: 0, color: textPrimary }}>审查结果</Title>
                    <HintIcon title="按风险条目逐条处理：先定位左侧原文，再对比建议，最后采纳或自定义修改。" color={textSecondary} />
                  </div>
                </div>
                <Tag color={analyzing ? 'processing' : openIssues.length ? 'warning' : analysisDone ? 'success' : 'default'} style={{ margin: 0 }}>
                  {analyzing ? '正在审查' : openIssues.length ? '待处理' : analysisDone ? '已完成' : '待开始'}
                </Tag>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8, marginTop: 12 }}>
                {[
                  { label: `全部 (${openIssues.length || reviewPoints.length || 0})`, active: true, dot: '#2457f5' },
                  { label: `重大风险 (${highRiskCount})`, active: false, dot: '#ef4444' },
                  { label: `一般风险 (${normalRiskCount})`, active: false, dot: '#facc15' },
                ].map(item => (
                  <button
                    key={item.label}
                    type="button"
                    style={{
                      height: 32,
                      borderRadius: 7,
                      border: item.active ? '1px solid #2457f5' : '1px solid transparent',
                      background: item.active ? '#2457f5' : (isDarkMode ? '#111827' : '#f5f7fb'),
                      color: item.active ? '#fff' : textPrimary,
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'default',
                    }}
                  >
                    {!item.active && <span style={{ width: 6, height: 6, borderRadius: 999, background: item.dot }} />}
                    {item.label}
                  </button>
                ))}
              </div>
              {!(analyzing && reviewPoints.length === 0) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: isDarkMode ? '#0b1220' : currentGuidance.tone.soft,
                    border: `1px solid ${currentGuidance.tone.border}`,
                    boxShadow: cardShadow,
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 14,
                      background: '#fff',
                      border: `1px solid ${currentGuidance.tone.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: currentGuidance.tone.text,
                      fontWeight: 900,
                    }}
                  >
                    {analyzing ? <SyncOutlined spin /> : openIssues.length ? activeIndex + 1 : '✓'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary }}>{currentGuidance.title}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: textSecondary, lineHeight: 1.5 }}>{currentGuidance.detail}</div>
                  </div>
                </div>
              )}
              {analyzing && analysisStage && reviewPoints.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '14px 16px',
                    borderRadius: 18,
                    background: isDarkMode
                      ? 'linear-gradient(180deg, rgba(17,24,39,0.92) 0%, rgba(11,18,32,0.96) 100%)'
                      : `linear-gradient(180deg, rgba(255,255,255,0.96) 0%, ${analysisStage.tone.soft} 100%)`,
                    border: `1px solid ${analysisStage.tone.border}`,
                    boxShadow: cardShadow,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: analysisStage.tone.text }}>
                        追加审查进行中 · 第 {analysisStage.index + 1} 步 / {ANALYSIS_STAGE_FLOW.length}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: textPrimary }}>
                        {analysisStage.title}{analysisStage.dots}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: textSecondary }}>
                      {analysisStage.eta}
                    </div>
                  </div>
                  <Progress
                    percent={analysisStage.progress}
                    showInfo={false}
                    status="active"
                    strokeColor={analysisStage.tone.solid}
                    trailColor={isDarkMode ? '#243041' : '#edf2f7'}
                  />
                </div>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', padding: 14 }}>
              {analyzing && reviewPoints.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 16,
                      background: isDarkMode ? '#0b1220' : '#f8fbff',
                      border,
                      boxShadow: cardShadow,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 12,
                          background: analysisStage?.tone.soft || STATUS_TONES.blue.soft,
                          border: `1px solid ${analysisStage?.tone.border || STATUS_TONES.blue.border}`,
                          color: analysisStage?.tone.solid || STATUS_TONES.blue.solid,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <SyncOutlined spin />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>
                          {analysisStage ? `${analysisStage.title}${analysisStage.dots}` : '正在审查合同'}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: textSecondary, lineHeight: 1.6 }}>
                          左侧合同已可先阅读，右侧结果生成后会自动列出问题。
                        </div>
                      </div>
                    </div>
                    <Progress
                      percent={analysisStage?.progress || 18}
                      showInfo={false}
                      status="active"
                      strokeColor={analysisStage?.tone.solid || STATUS_TONES.blue.solid}
                      trailColor={isDarkMode ? '#243041' : '#edf2f7'}
                      style={{ marginTop: 12 }}
                    />
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: textSecondary }}>
                      <span>{analysisStage?.eta || '预计还需数秒'}</span>
                      <span>已等待 {analysisStage?.elapsedLabel || '0 秒'}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analysisStageItems.map((stage, index) => {
                      const isCurrent = stage.status === 'current';
                      const isComplete = stage.status === 'complete';
                      const tone = isCurrent ? stage.tone : isComplete ? STATUS_TONES.green : STATUS_TONES.gray;
                      return (
                        <div
                          key={stage.key}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '28px minmax(0, 1fr) auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: '10px 12px',
                            borderRadius: 14,
                            background: isCurrent || isComplete ? tone.soft : (isDarkMode ? '#0b1220' : '#fff'),
                            border: `1px solid ${isCurrent || isComplete ? tone.border : 'rgba(15,23,42,0.06)'}`,
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 10,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: isComplete ? tone.solid : '#fff',
                              color: isComplete ? '#fff' : tone.text,
                              border: `1px solid ${tone.border}`,
                              fontWeight: 800,
                            }}
                          >
                            {isComplete ? '✓' : index + 1}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {stage.title}
                            </div>
                            <div style={{ marginTop: 2, fontSize: 12, color: textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {stage.detail}
                            </div>
                          </div>
                          <Tag style={{ margin: 0, color: tone.text, border: `1px solid ${tone.border}`, background: '#fff' }}>
                            {isComplete ? '完成' : isCurrent ? '进行中' : '等待'}
                          </Tag>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : !activeIssue ? (
                <Card
                  bordered={false}
                  style={{ borderRadius: 24, background: mutedBg, border, boxShadow: cardShadow }}
                >
                  <Empty
                    description={reviewPoints.length ? '当前问题已处理完毕，可继续追加审查问题。' : '当前未发现问题条款'}
                  />
                </Card>
              ) : (
                <>
                  <Card
                    bordered={false}
                    style={{ borderRadius: 16, marginBottom: 10, background: panelBg, border, boxShadow: strongCardShadow }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text strong style={{ color: textPrimary }}>当前问题</Text>
                          <Tag style={{ margin: 0, color: activeSeverity.color, background: activeSeverity.soft, border: `1px solid ${activeSeverity.border}` }}>
                            {activeSeverity.badge}
                          </Tag>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 17, fontWeight: 800, lineHeight: 1.35, color: textPrimary }}>
                          {issueTitle(activeIssue, activeIndex)}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: textSecondary }}>
                          {activeIssue.category || '未分类'} · 第 {activeIssue.para_index + 1} 段 · {activeIndex + 1} / {openIssues.length}
                        </div>
                      </div>
                      <Space.Compact>
                        <Button icon={<LeftOutlined />} disabled={activeIndex <= 0} onClick={() => jumpIssue(-1)} />
                        <Button icon={<RightOutlined />} disabled={activeIndex >= openIssues.length - 1} onClick={() => jumpIssue(1)} />
                      </Space.Compact>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        marginTop: 12,
                      }}
                    >
                      <Button
                        icon={<ICONS.target size={16} color="#fff" />}
                        onClick={() => handleLocate(activeIssue)}
                        style={{
                          height: 40,
                          borderRadius: 12,
                          background: '#2457f5',
                          color: '#fff',
                          border: 'none',
                          fontWeight: 700,
                        }}
                      >
                        定位原文
                      </Button>
                      <Button
                        type="primary"
                        disabled={!activeIssue.suggestedText}
                        onClick={() => applyResolution(activeIssue, activeIssue.suggestedText, 'adopted')}
                        style={{
                          height: 40,
                          borderRadius: 12,
                          background: '#16833a',
                          border: 'none',
                          fontWeight: 700,
                        }}
                      >
                        采纳建议
                      </Button>
                    </div>
                    <Button
                      block
                      icon={<ICONS.pencil size={16} color="#111827" />}
                      onClick={() => openCustomEdit(activeIssue)}
                      style={{ marginTop: 8, height: 38, borderRadius: 12, border, background: panelBg, fontWeight: 700 }}
                    >
                      自定义修改
                    </Button>
                  </Card>

                  <Card
                    bordered={false}
                    style={{ borderRadius: 16, marginBottom: 10, background: panelBg, border, boxShadow: cardShadow }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                      <Text strong style={{ color: textPrimary }}>待处理队列</Text>
                      <Text style={{ color: textSecondary, fontSize: 12 }}>点击条目自动定位原文</Text>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 238, overflow: 'auto', paddingRight: 2 }}>
                      {openIssues.map((item, idx) => {
                        const sev = SEV[item.severity] || SEV.medium;
                        const isActive = item.id === activeIssue.id;
                        const QueueIcon = CATEGORY_META[item.category]?.icon || ICONS.clipboard;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setActiveIssueId(item.id);
                              handleLocate(item);
                            }}
                            style={{
                              textAlign: 'left',
                              border: isActive ? '1px solid rgba(36,87,245,0.38)' : border,
                              background: isActive
                                ? 'linear-gradient(180deg, rgba(36,87,245,0.09) 0%, rgba(255,255,255,0.98) 100%)'
                                : panelBg,
                              borderRadius: 12,
                              padding: '10px 11px',
                              cursor: 'pointer',
                              boxShadow: isActive ? cardShadow : 'none',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 3, alignSelf: 'stretch', minHeight: 42, borderRadius: 999, background: sev.color }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                  <QueueIcon size={16} color="#111827" />
                                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {issueTitle(item, idx)}
                                  </span>
                                  <Tag style={{ margin: 0, color: sev.color, background: sev.soft, border: `1px solid ${sev.border}` }}>
                                    {sev.badge}
                                  </Tag>
                                </div>
                                <div style={{ marginTop: 4, color: textMuted, fontSize: 12, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  第 {item.para_index + 1} 段 · {item.originalText || '无原文内容'}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </Card>

                  <Card
                    bordered={false}
                    style={{ borderRadius: 16, marginBottom: 10, background: panelBg, border, boxShadow: cardShadow }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <div style={{ fontWeight: 800, color: textPrimary, marginBottom: 10 }}>条款对照</div>
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: '#fff7f5',
                        border: '1px solid #ffd7d4',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                        <ICONS.alert size={16} color="#7a271a" />
                        <Text strong style={{ color: '#7a271a', fontSize: 13 }}>原文</Text>
                      </div>
                      <div style={{ color: '#7a271a', fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                        {activeIssue.originalText || '未提取到原文条款'}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: '#f3fbef',
                        border: '1px solid #b7eb8f',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                        <ICONS.check size={16} color="#135200" />
                        <Text strong style={{ color: '#135200', fontSize: 13 }}>建议修改</Text>
                      </div>
                      <div style={{ color: '#135200', fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                        {activeIssue.suggestedText || '当前问题没有自动生成替换文本，建议人工完善。'}
                      </div>
                    </div>
                  </Card>

                  <Card
                    bordered={false}
                    style={{ borderRadius: 16, marginBottom: 12, background: mutedBg, border, boxShadow: cardShadow }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <div style={{ fontWeight: 800, color: textPrimary, marginBottom: 8 }}>理由与依据</div>
                    <div style={{ color: textSecondary, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                      {activeIssue.reason || '当前建议未附带说明。'}
                    </div>
                    <div style={{ height: 1, background: isDarkMode ? '#243041' : '#e6ebf2', margin: '10px 0' }} />
                    <div style={{ color: textSecondary, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 132, overflow: 'auto', fontSize: 13 }}>
                      {activeIssue.rule || '当前问题未检索到对应法规引用。'}
                    </div>
                  </Card>
                </>
              )}

              <Card
                bordered={false}
                    style={{ borderRadius: 16, background: panelBg, border, boxShadow: cardShadow }}
                    styles={{ body: { padding: 14 } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <ICONS.message size={18} color="#111827" />
                  <Text strong style={{ color: textPrimary }}>追加审查</Text>
                  <HintIcon title="每行输入一个补充问题，系统会基于当前合同继续补充审查。" color={textSecondary} />
                </div>
                <TextArea
                  value={extraQuestions}
                  onChange={event => setExtraQuestions(event.target.value)}
                  placeholder="每行输入一个补充问题，例如：\n付款节点是否约定验收前置条件？\n知识产权归属是否覆盖设计文件与技术成果？"
                  autoSize={{ minRows: 4, maxRows: 7 }}
                  style={{ borderRadius: 16 }}
                />
                <Button
                  type="primary"
                  ghost
                  block
                  loading={analyzing}
                  disabled={!extraQuestions.trim()}
                  onClick={handleReAnalyze}
                  style={{ marginTop: 12, borderRadius: 14, height: 42 }}
                >
                  开始追加审查
                </Button>
              </Card>
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: '12px 14px 14px',
                borderTop: border,
                background: isDarkMode ? '#0b1220' : '#fff',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <Button
                type="primary"
                onClick={handleExportContractDocument}
                disabled={!canExportDocument}
                style={{
                  height: 40,
                  minWidth: 116,
                  borderRadius: 10,
                  background: canExportDocument ? '#2457f5' : '#eef2f7',
                  border: canExportDocument ? 'none' : '1px solid #d8dee8',
                  color: canExportDocument ? '#fff' : '#98a2b3',
                  fontWeight: 800,
                  boxShadow: canExportDocument ? '0 10px 24px rgba(36,87,245,0.2)' : 'none',
                }}
              >
                {Object.keys(exportEdits).length > 0 ? '导出留痕审查版' : '导出原文档'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={customEditOpen}
        title="自定义修改条款"
        onCancel={() => setCustomEditOpen(false)}
        onOk={submitCustomEdit}
        okText="写入左侧文档"
        width={760}
      >
        <TextArea
          value={customDraft}
          onChange={event => setCustomDraft(event.target.value)}
          autoSize={{ minRows: 10, maxRows: 18 }}
        />
      </Modal>

      <DocxPreviewModal
        open={Boolean(previewFile)}
        savedName={previewFile?.savedName}
        title={previewFile?.name || 'DOCX 预览'}
        onClose={() => setPreviewFile(null)}
      />
    </Layout>
  );
}
