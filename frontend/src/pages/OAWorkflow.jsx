import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Button,
  Descriptions,
  Drawer,
  message,
  Modal,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AlertOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Form as ArcoForm, Input as ArcoInput, Select as ArcoSelect } from '@arco-design/web-react';
import '@arco-design/web-react/es/Form/style/css.js';
import '@arco-design/web-react/es/Input/style/css.js';
import '@arco-design/web-react/es/Select/style/css.js';
import { loadDemoAssets } from '../lib/demoApi';
import { authFetch } from '../lib/auth';

const { Title, Text, Paragraph } = Typography;
const ArcoOption = ArcoSelect.Option;

const TONE_TO_TAG = {
  success: 'success',
  info: 'blue',
  processing: 'processing',
  warning: 'warning',
  error: 'error',
};

const COMPANY_DEPARTMENTS = ['董事会办公室', '总经理办公室', '财务管理部', '法务合规部', '人力资源部', '项目管理部', '采购中心', '审计监察部'];

const MATTER_DEMOS = {
  重大事项: {
    title: '新院区规划建设重大事项决策审批',
    department: '总经理办公室',
    proposer: '张敏',
    urgency: '普通',
    meeting: '董事会',
    amount: '不涉及资金支付',
    riskLevel: '中风险',
    archivePrefix: 'ZDJC',
    materials: ['书面建议书', '调查研究报告', '专家论证意见', '征求意见汇总表', '会议纪要草案'],
    aiGaps: ['专家论证意见需与正式上会报告一并归档', '公开征求意见结果需注明采纳情况'],
  },
  重要干部: {
    title: '关于王建国同志拟任综合管理部副主任的审批',
    department: '人力资源部',
    proposer: '赵云',
    urgency: '普通',
    meeting: '总经理办公会',
    amount: '不涉及资金支付',
    riskLevel: '中风险',
    archivePrefix: 'GBRM',
    materials: ['民主推荐汇总表', '干部考察报告', '审计监察意见函', '会议表决记录', '任前公示截图'],
    aiGaps: ['审计监察意见和民主推荐票数必须作为同一案卷归档', '任前公示期满前不得进入正式任命节点'],
  },
  重大项目: {
    title: '新能源科创园三期扩建立项审议',
    department: '项目管理部',
    proposer: '周建平',
    urgency: '加急',
    meeting: '董事会',
    amount: '预算 1.26 亿元',
    riskLevel: '高风险',
    archivePrefix: 'ZDXM',
    materials: ['项目建议书', '可行性研究报告', '专家论证意见', '法务审查意见', '资金测算表', '董事会纪要'],
    aiGaps: ['不得以临时动议替代正式上会材料', '需补充法务审查意见与资金来源说明'],
  },
  大额资金: {
    title: '存量债务置换专项资金审批',
    department: '财务管理部',
    proposer: '刘芳',
    urgency: '加急',
    meeting: '总经理办公会',
    amount: '预算 3500 万元',
    riskLevel: '中风险',
    archivePrefix: 'DEZJ',
    materials: ['资金使用报告', '预算审批单', '专项审计意见', '资金用途穿透说明', '双签审批记录'],
    aiGaps: ['需穿透说明资金最终用途', '支付前需补齐双签审批和审计意见'],
  },
};

const PROCEDURE_MAP = {
  重大事项: ['调查研究', '专家论证', '征求意见', '集体决策', '依法公开', '电子归档'],
  重要干部: ['民主推荐', '组织考察', '审计监察意见', '会议表决', '任前公示', '试用考核'],
  重大项目: ['项目审查', '专家论证', '法务审查', '资金测算', '集体决策', '依法公示'],
  大额资金: ['预算安排', '资金报告', '集体研究', '公开公示', '财务支付', '专项归档'],
};

const AI_MATTER_TYPE_MAP = {
  重大事项: '重大决策',
  重要干部: '重要人事任免',
  重大项目: '重大项目安排',
  大额资金: '大额度资金运作',
};

const HANDLERS = [
  { name: '张敏', dept: '总经理办公室', role: '经办人' },
  { name: '李倩', dept: '法务合规部', role: '合规审查' },
  { name: '王磊', dept: '审计监察部', role: '监督复核' },
  { name: '陈伟', dept: '经营管理层', role: '分管审批' },
  { name: '刘强', dept: '总经理办公会', role: '集体决策' },
  { name: '系统', dept: '电子档案中心', role: '自动归档' },
];

const ACTIONS = ['提交材料', '审核通过', '补充意见', '会签确认', '形成决议', '归档入库'];

const REPORT_SECTION_ORDER = [
  '审核基本信息',
  '风险等级评定',
  '违规事项与证据清单',
  '程序完整性核查',
  '责任主体认定',
  '整改建议',
  '决策溯源档案',
  '整改闭环管理',
  '统计分析',
];

const OA_RECORDS = [
  {
    id: 'oa-2026-0608-001',
    title: MATTER_DEMOS.重要干部.title,
    matterType: '重要干部',
    department: MATTER_DEMOS.重要干部.department,
    proposer: MATTER_DEMOS.重要干部.proposer,
    createdAt: '2026-06-08 09:12',
    phase: '会议表决前',
    status: '流转中',
    riskLevel: MATTER_DEMOS.重要干部.riskLevel,
    currentStep: 2,
    started: true,
    archiveCount: 5,
  },
  {
    id: 'oa-2026-0608-002',
    title: MATTER_DEMOS.重大项目.title,
    matterType: '重大项目',
    department: MATTER_DEMOS.重大项目.department,
    proposer: MATTER_DEMOS.重大项目.proposer,
    createdAt: '2026-06-08 10:26',
    phase: '法务审查补件',
    status: 'AI拦截',
    riskLevel: MATTER_DEMOS.重大项目.riskLevel,
    currentStep: 2,
    started: true,
    archiveCount: 6,
  },
  {
    id: 'oa-2026-0608-003',
    title: MATTER_DEMOS.大额资金.title,
    matterType: '大额资金',
    department: MATTER_DEMOS.大额资金.department,
    proposer: MATTER_DEMOS.大额资金.proposer,
    createdAt: '2026-06-08 14:05',
    phase: '预算安排',
    status: '待发起',
    riskLevel: MATTER_DEMOS.大额资金.riskLevel,
    currentStep: 0,
    started: false,
    archiveCount: 4,
  },
  {
    id: 'oa-2026-0607-004',
    title: MATTER_DEMOS.重大事项.title,
    matterType: '重大事项',
    department: MATTER_DEMOS.重大事项.department,
    proposer: MATTER_DEMOS.重大事项.proposer,
    createdAt: '2026-06-07 16:40',
    phase: '电子归档复核',
    status: '待归档',
    riskLevel: MATTER_DEMOS.重大事项.riskLevel,
    currentStep: 5,
    started: true,
    archiveCount: 7,
  },
];

function renderValue(value, tone) {
  if (!tone) return value;
  return <Tag color={TONE_TO_TAG[tone] || 'default'}>{value}</Tag>;
}

function getMatterDemo(matterType) {
  return MATTER_DEMOS[matterType] || MATTER_DEMOS.重要干部;
}

function getMatterIndex(matterType) {
  const keys = Object.keys(MATTER_DEMOS);
  const index = keys.indexOf(matterType);
  return index >= 0 ? index + 1 : 1;
}

function buildOaNo(matterType) {
  return `OA-2026-0608-${String(getMatterIndex(matterType)).padStart(3, '0')}`;
}

function buildArchiveNo(matterType) {
  const demo = getMatterDemo(matterType);
  return `${demo.archivePrefix}-2026-0608-${String(getMatterIndex(matterType) * 7).padStart(3, '0')}`;
}

function formatTime(offsetMinutes) {
  const hour = 9 + Math.floor(offsetMinutes / 60);
  const minute = offsetMinutes % 60;
  return `2026-06-08 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getStatusLabel(item, index, activeIndex, isStarted) {
  if (!isStarted) return index === 0 ? '待发起' : '待办';
  if (item.hasRisk && index <= activeIndex) return index === activeIndex ? 'AI拦截' : '已留痕';
  if (index < activeIndex) return '已办';
  if (index === activeIndex) return '当前';
  return '待办';
}

function getStatusColor(label) {
  if (label === 'AI拦截') return 'red';
  if (label === '已留痕') return 'orange';
  if (label === '已办') return 'green';
  if (label === '当前') return 'blue';
  if (label === '待发起') return 'gold';
  return 'default';
}

function buildAuditMaterial({ matterType, formData, currentPath, oaNo }) {
  const demo = getMatterDemo(matterType);
  const riskNode = currentPath.find(item => item.riskPoint);
  return [
    `OA编号：${oaNo}`,
    `事项名称：${formData.title || demo.title}`,
    `事项类型：${matterType}`,
    `发起部门：${formData.department || demo.department}`,
    `预算/资金：${demo.amount}`,
    `拟提交会议：${demo.meeting}`,
    `材料清单：${demo.materials.join('、')}`,
    `流程节点：${currentPath.map(item => item.title).join(' -> ')}`,
    riskNode ? `关键风险点：${riskNode.title}，${riskNode.riskPoint}` : '关键风险点：未配置高风险节点',
    riskNode ? `防范要求：${riskNode.precaution}` : '',
    '请按国企/企业三重一大合规口径，判断材料完整性、程序完整性、责任主体和归档留痕要求。',
  ].filter(Boolean).join('\n');
}

function getDemoCue({ isStarted, isFlowDone, currentStep, currentPath }) {
  const nextNode = currentPath[currentStep + 1];
  if (!isStarted) {
    return {
      step: '第 1 步',
      title: '生成审批案卷',
      desc: '先把事项、部门、材料清单固化成一个 OA 案卷，后续每一步都会自动留痕。',
      action: '点击左侧“生成审批案卷”',
    };
  }
  if (isFlowDone) {
    return {
      step: '第 4 步',
      title: '查看归档结果',
      desc: '流程已经走到末端，右侧能看到流程日志、表单快照、AI 审查记录和风控拦截记录。',
      action: '查看右侧“电子归档包”',
    };
  }
  if (nextNode?.riskPoint) {
    return {
      step: '第 3 步',
      title: '触发 AI 风控拦截',
      desc: `下一节点是“${nextNode.title}”，系统会弹出风险提示，并把整改承诺写入案卷。`,
      action: '点击左侧“推进下一节点”',
    };
  }
  return {
    step: '第 2 步',
    title: '推进审批流转',
    desc: '每推进一次，中间时间线会新增经办人、处理动作、处理时间和证据数量。',
    action: '点击左侧“推进下一节点”',
  };
}

function parseAiReportSections(text) {
  if (!text?.trim()) return [];
  const cleaned = text
    .replace(/<risk_radar>[\s\S]*?<\/risk_radar>/g, '')
    .replace(/^>\s*📋.*$/gm, '')
    .trim();
  if (!cleaned) return [];

  const matches = [...cleaned.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) {
    return [{ title: 'AI审查意见', content: cleaned, originalIndex: 0 }];
  }

  const sections = matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? cleaned.length;
    return {
      title: match[1].replace(/^[一二三四五六七八九十]+、/, '').trim(),
      content: cleaned.slice(start, end).trim(),
      originalIndex: index,
    };
  }).filter(section => section.content);

  return sections.sort((a, b) => {
    const aOrder = REPORT_SECTION_ORDER.findIndex(item => a.title.includes(item));
    const bOrder = REPORT_SECTION_ORDER.findIndex(item => b.title.includes(item));
    const safeA = aOrder >= 0 ? aOrder : 99;
    const safeB = bOrder >= 0 ? bOrder : 99;
    return safeA === safeB ? a.originalIndex - b.originalIndex : safeA - safeB;
  });
}

function AiPulse({ active = false, isDarkMode = false }) {
  return (
    <div className={`oa-ai-core ${active ? 'is-active' : ''}`} aria-hidden="true">
      <span className="oa-ai-core-ring oa-ai-core-ring-one" />
      <span className="oa-ai-core-ring oa-ai-core-ring-two" />
      <span className="oa-ai-core-disc">
        <RobotOutlined />
      </span>
      <span className="oa-ai-core-wave">
        {[0, 1, 2, 3, 4].map(item => <i key={item} style={{ animationDelay: `${item * 90}ms`, background: isDarkMode ? '#bfdbfe' : 'var(--ui-primary)' }} />)}
      </span>
    </div>
  );
}

export default function OAWorkflow({ isDarkMode = false, currentUser = null }) {
  const [config, setConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [matterType, setMatterType] = useState('重要干部');
  const [currentStep, setCurrentStep] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const [formData, setFormData] = useState(() => {
    const demo = getMatterDemo('重要干部');
    return { title: demo.title, department: demo.department };
  });
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentDetail, setCurrentDetail] = useState(null);
  const [subDetailVisible, setSubDetailVisible] = useState(false);
  const [currentSubDetail, setCurrentSubDetail] = useState(null);
  const [aiReviewText, setAiReviewText] = useState('');
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [aiReviewError, setAiReviewError] = useState('');
  const aiAbortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        const payload = await loadDemoAssets();
        if (!alive) return;
        const workflow = payload.workflow || {};
        const defaultType = workflow.defaultMatterType || '重要干部';
        const demo = getMatterDemo(defaultType);
        setConfig(workflow);
        setMatterType(defaultType);
        setFormData({
          title: demo.title,
          department: COMPANY_DEPARTMENTS.includes(demo.department) ? demo.department : COMPANY_DEPARTMENTS[0],
        });
      } catch (error) {
        if (alive) message.error(`审批演示配置加载失败：${error.message}`);
      } finally {
        if (alive) setLoadingConfig(false);
      }
    };
    boot();
    return () => {
      alive = false;
      aiAbortRef.current?.abort();
    };
  }, []);

  const palette = useMemo(() => ({
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
  }), []);

  const workflows = config?.workflows || {};
  const currentWorkflow = workflows[matterType] || { steps: [], details: {} };
  const currentPath = currentWorkflow.steps || [];
  const departments = COMPANY_DEPARTMENTS;
  const matterTypes = config?.matterTypes || [];
  const demo = getMatterDemo(matterType);
  const oaNo = buildOaNo(matterType);
  const archiveNo = buildArchiveNo(matterType);
  const riskNodeIndex = currentPath.findIndex(item => item.riskPoint);
  const riskNode = riskNodeIndex >= 0 ? currentPath[riskNodeIndex] : null;
  const isFlowDone = isStarted && currentPath.length > 0 && currentStep >= currentPath.length - 1;
  const progressPercent = isStarted && currentPath.length > 0
    ? Math.round(((currentStep + 1) / (currentPath.length + 1)) * 100)
    : 8;
  const demoCue = getDemoCue({ isStarted, isFlowDone, currentStep, currentPath });
  const demoScript = [
    { step: '1', label: '生成案卷', active: !isStarted },
    { step: '2', label: '推进流转', active: isStarted && !isFlowDone && !currentPath[currentStep + 1]?.riskPoint },
    { step: '3', label: 'AI拦截', active: isStarted && !isFlowDone && Boolean(currentPath[currentStep + 1]?.riskPoint) },
    { step: '4', label: '归档审查', active: isFlowDone },
  ];

  const activeTraceIndex = useMemo(() => {
    if (!isStarted) return 0;
    if (!currentPath.length) return 0;
    if (currentStep >= currentPath.length - 1) return currentPath.length + 3;
    return currentStep + 3;
  }, [currentPath.length, currentStep, isStarted]);

  const traceItems = useMemo(() => {
    const baseItems = [
      {
        key: 'draft',
        title: '拟稿提交',
        desc: '经办人填写 OA 审批发起单并上传材料清单',
        action: '提交',
        handler: { name: demo.proposer, dept: demo.department, role: '经办人' },
        evidence: 3,
        type: 'system',
      },
      {
        key: 'dept_review',
        title: '部门初审',
        desc: '部门负责人核验事项必要性、预算口径和材料完整性',
        action: '审核通过',
        handler: HANDLERS[0],
        evidence: 4,
        type: 'system',
      },
      {
        key: 'ai_identify',
        title: 'AI 三重一大识别',
        desc: `系统识别为“${matterType}”，建议进入${demo.meeting}集体决策流程`,
        action: 'AI识别',
        handler: HANDLERS[1],
        evidence: 5,
        type: 'ai',
      },
    ];

    const workflowItems = currentPath.map((item, index) => ({
      key: `workflow_${index}`,
      title: item.title,
      desc: item.desc,
      action: item.riskPoint ? '风控拦截' : ACTIONS[index % ACTIONS.length],
      handler: HANDLERS[(index + 1) % (HANDLERS.length - 1)],
      evidence: 2 + ((index + getMatterIndex(matterType)) % 4),
      hasRisk: Boolean(item.riskPoint),
      riskPoint: item.riskPoint,
      precaution: item.precaution,
      type: 'business',
      originalIndex: index,
    }));

    return [
      ...baseItems,
      ...workflowItems,
      {
        key: 'archive',
        title: '电子归档',
        desc: '生成流程日志、表单快照、附件清单、AI 审查记录和风控拦截记录',
        action: '归档',
        handler: HANDLERS[5],
        evidence: demo.materials.length + currentPath.length,
        type: 'archive',
      },
    ];
  }, [currentPath, demo, matterType]);

  const archiveItems = useMemo(() => ([
    { label: '流程日志', value: `${traceItems.length} 条`, status: isStarted ? '已生成' : '待生成' },
    { label: '表单快照', value: '1 份', status: isStarted ? '已锁定' : '待锁定' },
    { label: '附件清单', value: `${demo.materials.length} 份`, status: isStarted ? '已关联' : '待关联' },
    { label: 'AI审查记录', value: aiReviewText ? '1 份' : '模板摘要', status: aiReviewText ? '真实生成' : '待调用' },
    { label: '风控拦截记录', value: riskNode ? '1 条' : '0 条', status: riskNode ? '已配置' : '无' },
  ]), [aiReviewText, demo.materials.length, isStarted, riskNode, traceItems.length]);
  const aiReportSections = useMemo(() => parseAiReportSections(aiReviewText), [aiReviewText]);

  const handleMatterTypeChange = value => {
    const nextDemo = getMatterDemo(value);
    setMatterType(value);
    setCurrentStep(0);
    setIsStarted(false);
    setAiReviewText('');
    setAiReviewError('');
    setFormData({
      title: nextDemo.title,
      department: departments.includes(nextDemo.department) ? nextDemo.department : (departments[0] || nextDemo.department),
    });
  };

  const handleStart = () => {
    if (!formData.title?.trim()) {
      message.warning('请输入审批事项名称');
      return;
    }
    setIsStarted(true);
    setCurrentStep(0);
    message.success('已生成 OA 审批案卷，流程日志开始留痕');
  };

  const handleNext = () => {
    const nextStep = currentStep + 1;
    const nextNode = currentPath[nextStep];
    if (!nextNode) return;

    if (nextNode.riskPoint) {
      Modal.confirm({
        title: <span style={{ color: '#c24135', fontSize: 18 }}><AlertOutlined /> 智能风控合规拦截</span>,
        icon: null,
        content: (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12, padding: 12, background: isDarkMode ? '#3b1515' : '#fff1f0', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#ffa39e'}`, borderRadius: 8 }}>
              <Text strong style={{ color: isDarkMode ? '#fecaca' : '#b42318' }}>触发风险预警节点：{nextNode.title}</Text>
              <div style={{ marginTop: 8, fontSize: 13, color: isDarkMode ? '#fecaca' : '#b42318' }}>{nextNode.riskPoint}</div>
            </div>
            <div style={{ padding: 12, background: isDarkMode ? '#12331f' : '#f0fdf4', border: `1px solid ${isDarkMode ? '#166534' : '#bbf7d0'}`, borderRadius: 8 }}>
              <Text strong style={{ color: isDarkMode ? '#bbf7d0' : '#166534' }}>系统强制防范要求：</Text>
              <div style={{ marginTop: 8, fontSize: 13, color: isDarkMode ? '#bbf7d0' : '#166534' }}>{nextNode.precaution}</div>
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: '#888' }}>
              系统已将本次拦截、整改承诺、审批意见写入电子档案。确认材料已补齐后可继续流转。
            </div>
          </div>
        ),
        okText: '已整改，继续流转',
        okButtonProps: { danger: true },
        cancelText: '暂缓审批',
        onOk: () => {
          message.success('已记录整改承诺，流程继续');
          setCurrentStep(nextStep);
        },
      });
      return;
    }

    setCurrentStep(nextStep);
  };

  const handleReset = () => {
    aiAbortRef.current?.abort();
    setIsStarted(false);
    setCurrentStep(0);
    setAiReviewText('');
    setAiReviewError('');
    setFormData({ title: demo.title, department: departments.includes(demo.department) ? demo.department : (departments[0] || demo.department) });
  };

  const openDetail = (item, index) => {
    const detailData = currentWorkflow.details?.[String(index)];
    if (!detailData) {
      message.info('该节点正在收集中，暂无电子档案数据');
      return;
    }
    setCurrentDetail({ title: item.title, data: detailData });
    setDetailVisible(true);
  };

  const runAiReview = async () => {
    if (aiReviewLoading) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiReviewLoading(true);
    setAiReviewError('');
    setAiReviewText('');

    try {
      const resp = await authFetch('/api/audit_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matter_type: AI_MATTER_TYPE_MAP[matterType] || matterType,
          material_text: buildAuditMaterial({ matterType, formData, currentPath, oaNo }),
          custom_rule_ids: [],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (!resp.body) throw new Error('浏览器未返回流式响应');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let reportText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            const data = JSON.parse(raw);
            if (data.type === 'llm_chunk') {
              reportText += data.content || '';
              setAiReviewText(reportText);
            }
            if (data.type === 'report') {
              reportText = data.content || reportText;
              setAiReviewText(reportText);
            }
            if (data.type === 'queue_warning') {
              message.warning(data.content);
            }
          }
        }
      }

      message.success('真实 AI 审查意见已生成并写入演示归档清单');
    } catch (error) {
      if (error.name === 'AbortError') return;
      setAiReviewError(error.message);
      message.error(`AI 审查调用失败：${error.message}`);
    } finally {
      setAiReviewLoading(false);
    }
  };

  const detailTableColumns = useMemo(() => {
    if (!currentDetail?.data || currentDetail.data.type !== 'table') return [];
    const columns = (currentDetail.data.columns || []).map(column => ({ ...column }));
    if ((currentDetail.data.rows || []).some(row => row.detail)) {
      columns.push({
        title: '操作',
        key: 'action',
        render: (_, record) => (
          <Button type="link" size="small" danger onClick={() => {
            setCurrentSubDetail(record);
            setSubDetailVisible(true);
          }}>
            查看详情
          </Button>
        ),
      });
    }
    return columns;
  }, [currentDetail]);

  const renderDetailContent = () => {
    if (!currentDetail?.data) return null;
    const { data } = currentDetail;

    if (data.type === 'descriptions') {
      return (
        <Descriptions bordered column={1} size="small" labelStyle={{ width: 130, background: isDarkMode ? '#1f2937' : '#fafafa', color: palette.text }} contentStyle={{ color: palette.text }}>
          {(data.items || []).map((item, index) => (
            <Descriptions.Item key={index} label={item.label}>
              {renderValue(item.value, item.tone)}
            </Descriptions.Item>
          ))}
        </Descriptions>
      );
    }

    if (data.type === 'table') {
      return (
        <div>
          <Table
            dataSource={data.rows || []}
            columns={detailTableColumns}
            pagination={false}
            size="small"
            bordered
          />
          {data.summary && (
            <div style={{ marginTop: 16, padding: 12, background: isDarkMode ? '#111b26' : '#f0f5ff', borderRadius: 8 }}>
              <Text strong style={{ color: palette.blue }}>考察结论：</Text>
              <div style={{ marginTop: 4, color: palette.text }}>{data.summary}</div>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const renderAiReviewContent = () => {
    if (!aiReviewText) {
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            ['审查结论', `系统初步判断该事项应纳入“三重一大”集体决策。`],
            ['重点核查', demo.aiGaps.join('；')],
            ['下一步', '点击上方按钮后，系统会调用真实 AI 生成正式审查报告，并写入归档清单。'],
          ].map(([title, content]) => (
            <div key={title} style={{ padding: '9px 10px', borderRadius: 9, background: isDarkMode ? '#101827' : '#ffffff', border: `1px solid ${palette.line}` }}>
              <div style={{ color: palette.blue, fontWeight: 600, fontSize: 12 }}>{title}</div>
              <div style={{ marginTop: 4, color: palette.text, fontSize: 13, lineHeight: 1.65 }}>{content}</div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="oa-ai-report" style={{ display: 'grid', gap: 10 }}>
        {aiReportSections.map((section, index) => (
          <section key={`${section.title}-${index}`} style={{ padding: 11, borderRadius: 10, background: isDarkMode ? '#101827' : '#ffffff', border: `1px solid ${palette.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: index < 2 ? '#dbeafe' : '#edf2f7', color: index < 2 ? palette.blue : palette.muted, fontWeight: 600, fontSize: 12 }}>
                {index + 1}
              </span>
              <span style={{ color: palette.ink, fontWeight: 600, fontSize: 13 }}>{section.title}</span>
            </div>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {section.content}
            </ReactMarkdown>
          </section>
        ))}
      </div>
    );
  };

  const panelStyle = {
    background: palette.panelBg,
    border: `1px solid ${palette.line}`,
    borderRadius: 12,
    boxShadow: 'var(--ui-shadow-panel)',
  };

  const sectionTitleStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '12px 14px',
    borderBottom: `1px solid ${palette.line}`,
    color: palette.ink,
    fontWeight: 600,
  };

  const openWorkflowRecord = record => {
    const nextDemo = getMatterDemo(record.matterType);
    const nextWorkflow = workflows[record.matterType] || { steps: [] };
    setSelectedRecordId(record.id);
    setMatterType(record.matterType);
    setFormData({
      title: record.title || nextDemo.title,
      department: record.department || nextDemo.department,
    });
    setIsStarted(Boolean(record.started));
    setCurrentStep(Math.min(record.currentStep || 0, Math.max((nextWorkflow.steps || []).length - 1, 0)));
    setAiReviewText('');
    setAiReviewError('');
    setWorkflowOpen(true);
  };

  const handleCreateWorkflow = () => {
    const defaultType = '重要干部';
    setSelectedRecordId(null);
    setMatterType(defaultType);
    setCurrentStep(0);
    setIsStarted(false);
    setAiReviewText('');
    setAiReviewError('');
    setFormData({
      title: '',
      department: departments[0] || getMatterDemo(defaultType).department,
    });
    setWorkflowOpen(true);
  };

  const showRecordEdit = record => {
    Modal.info({
      title: '编辑审批案卷',
      icon: <EditOutlined style={{ color: palette.blue }} />,
      content: (
        <div style={{ lineHeight: 1.8, color: palette.text }}>
          <div>当前演示先进入案卷详情页修改事项类型、标题和部门。</div>
          <div style={{ marginTop: 8 }}>案卷：{record.title}</div>
          <div>创建人：{record.proposer}，当前阶段：{record.phase}</div>
        </div>
      ),
      okText: '进入编辑',
      onOk: () => openWorkflowRecord(record),
    });
  };

  const showRecordDelete = record => {
    Modal.confirm({
      title: '删除需要审批权限',
      icon: <DeleteOutlined style={{ color: palette.red }} />,
      content: (
        <div style={{ lineHeight: 1.8, color: palette.text }}>
          <div>正式系统会在这里校验管理员权限、删除原因和留痕编号。</div>
          <div style={{ marginTop: 8 }}>演示环境不会真实删除案卷，避免误删演示数据。</div>
          <div style={{ marginTop: 8, color: palette.muted }}>案卷：{record.title}</div>
        </div>
      ),
      okText: '我知道了',
      cancelText: '取消',
      okButtonProps: { danger: true },
    });
  };

  const getRecordStatusColor = status => {
    if (status === 'AI拦截') return 'red';
    if (status === '流转中') return 'processing';
    if (status === '待归档') return 'green';
    return 'gold';
  };

  const recordStats = useMemo(() => ([
    { label: '全部案卷', value: OA_RECORDS.length, icon: <FolderOpenOutlined />, color: palette.blue },
    { label: '流转中', value: OA_RECORDS.filter(item => item.status === '流转中').length, icon: <HistoryOutlined />, color: palette.blue },
    { label: 'AI拦截', value: OA_RECORDS.filter(item => item.status === 'AI拦截').length, icon: <AlertOutlined />, color: palette.red },
    { label: '待归档', value: OA_RECORDS.filter(item => item.status === '待归档').length, icon: <FileDoneOutlined />, color: palette.green },
  ]), [palette.blue, palette.green, palette.red]);

  const recordColumns = useMemo(() => ([
    {
      title: '审批案卷',
      dataIndex: 'title',
      key: 'title',
      width: 310,
      render: (value, record) => (
        <div style={{ minWidth: 0 }}>
          <Button type="link" style={{ padding: 0, height: 'auto', color: palette.ink, fontWeight: 600, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => openWorkflowRecord(record)}>
            {value}
          </Button>
          <div style={{ marginTop: 4, color: palette.muted, fontSize: 12 }}>{record.id}</div>
        </div>
      ),
    },
    {
      title: '事项类型',
      dataIndex: 'matterType',
      key: 'matterType',
      width: 110,
      render: value => <Tag color="blue" style={{ margin: 0 }}>{value}</Tag>,
    },
    {
      title: '发起信息',
      key: 'owner',
      width: 170,
      render: (_, record) => (
        <div>
          <div style={{ color: palette.ink }}>{record.department}</div>
          <div style={{ color: palette.muted, fontSize: 12 }}>{record.proposer} · {record.createdAt}</div>
        </div>
      ),
    },
    {
      title: '当前阶段',
      dataIndex: 'phase',
      key: 'phase',
      width: 150,
      render: value => <span style={{ color: palette.text }}>{value}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 95,
      render: value => <Tag color={getRecordStatusColor(value)} style={{ margin: 0 }}>{value}</Tag>,
    },
    {
      title: '风险',
      dataIndex: 'riskLevel',
      key: 'riskLevel',
      width: 95,
      render: value => <Tag color={value === '高风险' ? 'red' : 'orange'} style={{ margin: 0 }}>{value}</Tag>,
    },
    {
      title: '归档',
      dataIndex: 'archiveCount',
      key: 'archiveCount',
      width: 80,
      render: value => <span style={{ color: palette.text }}>{value} 类</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_, record) => (
        <Space size={6}>
          <Button size="small" type="primary" onClick={() => openWorkflowRecord(record)}>进入</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => showRecordEdit(record)}>编辑</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => showRecordDelete(record)}>删除</Button>
        </Space>
      ),
    },
  ]), [palette.ink, palette.muted, palette.text]);

  if (loadingConfig) {
    return (
      <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Space><Spin /><span>正在加载审批演示配置…</span></Space>
      </div>
    );
  }

  if (!workflowOpen) {
    return (
      <div className="oa-workflow-page" style={{ height: '100%', padding: 16, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <section style={{ ...panelStyle, padding: 18, flex: '0 0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 18, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <Space size={8} wrap style={{ marginBottom: 10 }}>
                  <Tag color="blue" style={{ margin: 0 }}>企业 OA 审批</Tag>
                  <Tag color="processing" style={{ margin: 0 }}>案卷总台账</Tag>
                  <Tag color="default" style={{ margin: 0 }}>三重一大合规</Tag>
                </Space>
                <Title level={3} style={{ margin: 0, color: palette.ink, fontSize: 22, lineHeight: 1.2 }}>
                  OA 审批案卷列表
                </Title>
                <div style={{ marginTop: 8, color: palette.muted, fontSize: 13 }}>
                  先选择或新建一个审批案卷，再进入填单、流转、AI 审查和电子归档。这样不会一进页面就掉进流程中间。
                </div>
              </div>
              <Space>
                <Button icon={<InfoCircleOutlined />} onClick={() => Modal.info({
                  title: '列表页使用说明',
                  content: '这里对应公司 OA 的案卷入口：先看全部审批事项、状态和风险，再进入单个案卷处理。演示数据保留在前端，不会影响真实数据库。',
                  okText: '知道了',
                })}>
                  使用说明
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateWorkflow} style={{ height: 38, fontWeight: 600 }}>
                  新建审批案卷
                </Button>
              </Space>
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, flex: '0 0 auto' }}>
            {recordStats.map(item => (
              <div key={item.label} style={{ ...panelStyle, padding: 14, display: 'grid', gridTemplateColumns: '42px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.color, background: item.color === palette.red ? '#FFECE8' : item.color === palette.green ? '#E8FFEA' : 'var(--ui-primary-soft)', fontSize: 18 }}>
                  {item.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: palette.ink, fontWeight: 600, fontSize: 22, lineHeight: 1 }}>{item.value}</div>
                  <div style={{ marginTop: 7, color: palette.muted, fontSize: 13 }}>{item.label}</div>
                </div>
              </div>
            ))}
          </section>

          <section style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...sectionTitleStyle, padding: '13px 16px' }}>
              <span><FolderOpenOutlined style={{ color: palette.blue, marginRight: 8 }} />审批案卷总览</span>
              <Space size={8} wrap>
                <Tag color="blue" style={{ margin: 0 }}>点击“进入”处理单个流程</Tag>
                <Tag color="default" style={{ margin: 0 }}>列表只负责找案卷和看状态</Tag>
              </Space>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              <Table
                rowKey="id"
                columns={recordColumns}
                dataSource={OA_RECORDS}
                pagination={false}
                scroll={{ x: 1190 }}
                size="middle"
                onRow={record => ({
                  onDoubleClick: () => openWorkflowRecord(record),
                })}
              />
            </div>
          </section>
        </div>

        <style>{`
          .oa-workflow-page .ant-table {
            background: transparent;
          }

          .oa-workflow-page .ant-table-wrapper .ant-table-thead > tr > th {
            background: var(--ui-fill-1);
            color: var(--ui-text-2);
            font-size: 12px;
            font-weight: 600;
          }

          .oa-workflow-page .ant-table-wrapper .ant-table-tbody > tr > td {
            color: var(--ui-text-2);
            font-size: 13px;
          }

          .oa-workflow-page .ant-table-wrapper .ant-table-tbody > tr:hover > td {
            background: var(--ui-primary-soft);
          }

          @media (max-width: 1080px) {
            .oa-workflow-page {
              overflow: auto !important;
            }

            .oa-workflow-page section:nth-of-type(2) {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="oa-workflow-page" style={{ height: '100%', padding: 16, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <section style={{ ...panelStyle, padding: 14, flex: '0 0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <Space size={8} wrap style={{ marginBottom: 8 }}>
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setWorkflowOpen(false)}>
                  返回案卷列表
                </Button>
                <Tag color="blue" style={{ margin: 0 }}>企业 OA 审批案卷</Tag>
                {selectedRecordId && <Tag color="default" style={{ margin: 0 }}>{selectedRecordId}</Tag>}
                <Tag color={demo.riskLevel === '高风险' ? 'red' : 'orange'} style={{ margin: 0 }}>{demo.riskLevel}</Tag>
                <Tag color={isFlowDone ? 'green' : isStarted ? 'processing' : 'gold'} style={{ margin: 0 }}>
                  {isFlowDone ? '待归档复核' : isStarted ? '流转中' : '待发起'}
                </Tag>
              </Space>
              <Title level={4} style={{ margin: 0, color: palette.ink, lineHeight: 1.25 }}>
                {formData.title || (selectedRecordId ? demo.title : '新建审批案卷')}
              </Title>
              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', color: palette.muted, fontSize: 13 }}>
                <span><BankOutlined /> {formData.department || demo.department}</span>
                <span>OA编号：{oaNo}</span>
                <span>归档号：{archiveNo}</span>
                <span>拟上会：{demo.meeting}</span>
              </div>
            </div>

            <div className="oa-summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 118px)', gap: 8 }}>
              {[
                { label: '流程留痕', value: `${traceItems.length} 节点`, icon: <HistoryOutlined />, color: palette.blue },
                { label: 'AI审查', value: aiReviewText ? '已生成' : '可调用', icon: <RobotOutlined />, color: palette.green },
                { label: '档案包', value: `${archiveItems.length} 类`, icon: <FolderOpenOutlined />, color: palette.amber },
              ].map(item => (
                <div key={item.label} style={{ border: `1px solid ${palette.line}`, borderRadius: 10, padding: '9px 10px', background: palette.panelSoft }}>
                  <div style={{ color: item.color, fontSize: 16 }}>{item.icon}</div>
                  <div style={{ marginTop: 4, color: palette.ink, fontWeight: 600, fontSize: 14 }}>{item.value}</div>
                  <div style={{ color: palette.muted, fontSize: 12 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) auto', gap: 12, alignItems: 'stretch' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: isDarkMode ? '#10213a' : '#edf5ff', border: `1px solid ${isDarkMode ? '#1d4ed8' : '#bfdbfe'}` }}>
              <div style={{ color: palette.blue, fontWeight: 600, fontSize: 16 }}>{demoCue.step}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: palette.ink, fontWeight: 600 }}>{demoCue.title}</span>
                  <Tag color="blue" style={{ margin: 0 }}>{demoCue.action}</Tag>
                </div>
                <div style={{ marginTop: 4, color: palette.muted, fontSize: 13, lineHeight: 1.5 }}>{demoCue.desc}</div>
              </div>
            </div>

            <div className="oa-script-steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 94px)', gap: 8 }}>
              {demoScript.map(item => (
                <div key={item.step} style={{ padding: '10px 9px', borderRadius: 10, border: `1px solid ${item.active ? '#93c5fd' : palette.line}`, background: item.active ? (isDarkMode ? '#10213a' : '#eff6ff') : palette.panelSoft }}>
                  <div style={{ width: 22, height: 22, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: item.active ? palette.blue : (isDarkMode ? '#263247' : '#e8eef7'), color: item.active ? '#fff' : palette.muted, fontWeight: 600, fontSize: 12 }}>
                    {item.step}
                  </div>
                  <div style={{ marginTop: 6, color: item.active ? palette.blue : palette.ink, fontWeight: 600, fontSize: 13 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="oa-work-grid" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '320px minmax(420px,1fr) 370px', gap: 12 }}>
          <aside className="oa-intake-panel" style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div className="oa-intake-head">
              <span className="oa-intake-icon"><FileDoneOutlined /></span>
              <div style={{ minWidth: 0 }}>
                <div className="oa-intake-kicker">STEP 01</div>
                <div className="oa-intake-title">填单并发起</div>
                <div className="oa-intake-desc">选类型后自动带入标题、发起部门、会议和材料清单</div>
              </div>
              <span className={isStarted ? 'oa-intake-state is-done' : 'oa-intake-state'}>{isStarted ? '已提交' : '草稿'}</span>
            </div>

            <div className="oa-intake-body">
              <div className="oa-intake-summary">
                <div>
                  <span>当前事项</span>
                  <strong>{matterType}</strong>
                </div>
                <em>{demo.riskLevel}</em>
              </div>
              <ArcoForm layout="vertical" className="oa-arco-quick-form">
                <ArcoForm.Item label="事项类型" style={{ marginBottom: 12 }}>
                  <ArcoSelect value={matterType} onChange={handleMatterTypeChange} disabled={isStarted} placeholder="选择三重一大类型">
                    {matterTypes.map(item => <ArcoOption key={item.value} value={item.value}>{item.label}</ArcoOption>)}
                  </ArcoSelect>
                </ArcoForm.Item>
                <ArcoForm.Item label="审批标题" style={{ marginBottom: 12 }}>
                  <ArcoInput value={formData.title} onChange={value => setFormData({ ...formData, title: value })} disabled={isStarted} placeholder="输入审批标题" />
                </ArcoForm.Item>
                <ArcoForm.Item label="发起部门（公司组织架构）" style={{ marginBottom: 12 }}>
                  <ArcoSelect value={formData.department} onChange={value => setFormData({ ...formData, department: value })} disabled={isStarted} placeholder="选择发起部门">
                    {departments.map(dept => <ArcoOption key={dept} value={dept}>{dept}</ArcoOption>)}
                  </ArcoSelect>
                </ArcoForm.Item>
              </ArcoForm>

              <div className="oa-intake-meta-grid">
                {[
                  ['发起人', `${demo.proposer}（${currentUser?.name || '系统管理员'}代办）`],
                  ['紧急程度', demo.urgency],
                  ['预算口径', demo.amount],
                  ['拟上会议', demo.meeting],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>

              <div className="oa-intake-materials">
                <div className="oa-intake-subtitle">
                  <span>材料清单</span>
                  <em>{demo.materials.length} 份</em>
                </div>
                <div className="oa-intake-material-list">
                  {demo.materials.map((item, index) => (
                    <div key={item} className={index < 3 || isStarted ? 'is-ready' : ''}>
                      <CheckCircleOutlined />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={isStarted ? 'oa-intake-actions is-started' : 'oa-intake-actions'}>
                {!isStarted ? (
                  <Button type="primary" onClick={handleStart} icon={<PlayCircleOutlined />} style={{ height: 42, fontWeight: 600 }}>
                    生成审批案卷
                  </Button>
                ) : (
                  <>
                    <Button onClick={handleNext} type="primary" icon={<SendOutlined />} disabled={isFlowDone} style={{ height: 42, fontWeight: 600 }}>
                      {isFlowDone ? '已进入归档' : '推进下一节点'}
                    </Button>
                    <Button onClick={handleReset} icon={<ReloadOutlined />} style={{ height: 42 }}>
                      重新演示
                    </Button>
                  </>
                )}
              </div>
            </div>
          </aside>

          <main style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={sectionTitleStyle}>
              <span><HistoryOutlined style={{ color: palette.blue, marginRight: 8 }} />2 审批流转记录</span>
              <Space size={8}>
                <Text style={{ color: palette.muted, fontSize: 12 }}>进度</Text>
                <Progress percent={progressPercent} size="small" style={{ width: 120 }} strokeColor={isFlowDone ? palette.green : palette.blue} />
              </Space>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              <div style={{ display: 'grid', gap: 10 }}>
                {traceItems.map((item, index) => {
                  const status = getStatusLabel(item, index, activeTraceIndex, isStarted);
                  const isActive = status === '当前' || status === 'AI拦截' || status === '待发起';
                  const canOpenDetail = item.type === 'business' && isStarted && item.originalIndex <= currentStep;
                  return (
                    <div
                      key={item.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '94px 30px minmax(0,1fr)',
                        gap: 10,
                        alignItems: 'start',
                        padding: '11px 12px',
                        borderRadius: 10,
                        border: `1px solid ${isActive ? (item.hasRisk ? '#fca5a5' : '#9ec5ff') : palette.line}`,
                        background: isActive ? (isDarkMode ? '#142033' : '#f7fbff') : palette.panelSoft,
                      }}
                    >
                      <div style={{ color: palette.muted, fontSize: 12, fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>
                        {formatTime(index * 18)}
                      </div>

                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                        <span style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: item.hasRisk && index <= activeTraceIndex ? '#fee2e2' : index <= activeTraceIndex && isStarted ? '#dcfce7' : '#e8eef7',
                          color: item.hasRisk && index <= activeTraceIndex ? palette.red : index <= activeTraceIndex && isStarted ? palette.green : palette.muted,
                          border: `1px solid ${palette.line}`,
                        }}>
                          {item.hasRisk && index <= activeTraceIndex ? <ExclamationCircleOutlined /> : index <= activeTraceIndex && isStarted ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
                        </span>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ color: palette.ink, fontWeight: 600 }}>{item.title}</span>
                              <Tag color={getStatusColor(status)} style={{ margin: 0 }}>{status}</Tag>
                              {item.type === 'ai' && <Tag color="cyan" style={{ margin: 0 }}>自动识别</Tag>}
                            </div>
                            <div style={{ marginTop: 4, color: palette.muted, fontSize: 13, lineHeight: 1.5 }}>{item.desc}</div>
                          </div>
                          {canOpenDetail && (
                            <Tooltip title="查看该节点底层 OA 凭证">
                              <Button size="small" icon={<FileSearchOutlined />} onClick={() => openDetail(currentPath[item.originalIndex], item.originalIndex)}>
                                凭证
                              </Button>
                            </Tooltip>
                          )}
                        </div>

                        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: palette.muted }}>
                          <span>{item.handler.dept} · {item.handler.name}</span>
                          <span>{item.handler.role}</span>
                          <Tag color="default" style={{ margin: 0 }}>动作：{item.action}</Tag>
                          <Tag color="default" style={{ margin: 0 }}>证据 {item.evidence} 份</Tag>
                        </div>

                        {item.hasRisk && index <= activeTraceIndex && (
                          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: isDarkMode ? '#321919' : '#fff7ed', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fed7aa'}` }}>
                            <div style={{ color: isDarkMode ? '#fecaca' : '#9a3412', fontWeight: 600, fontSize: 13 }}>
                              AI 风控意见：{item.riskPoint}
                            </div>
                            <div style={{ marginTop: 4, color: isDarkMode ? '#fed7aa' : '#9a3412', fontSize: 12, lineHeight: 1.55 }}>
                              整改要求：{item.precaution}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </main>

          <aside style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={sectionTitleStyle}>
              <span><AuditOutlined style={{ color: palette.blue, marginRight: 8 }} />3 AI审查与归档</span>
              <Tag color={aiReviewText ? 'green' : 'blue'} style={{ margin: 0 }}>{aiReviewText ? '真实生成' : '演示摘要'}</Tag>
            </div>

            <div style={{ padding: 14, overflow: 'auto', minHeight: 0 }}>
              <div style={{ background: isDarkMode ? '#0d1b31' : 'linear-gradient(135deg,#eff6ff 0%,#ffffff 100%)', border: `1px solid ${isDarkMode ? '#1e3a5f' : '#bfdbfe'}`, borderRadius: 12, padding: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '78px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
                  <AiPulse active={aiReviewLoading} isDarkMode={isDarkMode} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: palette.ink, fontSize: 16, fontWeight: 600 }}>三重一大 AI 审查中枢</span>
                      <Tag color={aiReviewLoading ? 'processing' : aiReviewText ? 'green' : 'blue'} style={{ margin: 0 }}>
                        {aiReviewLoading ? '生成中' : aiReviewText ? '已生成报告' : '待生成'}
                      </Tag>
                    </div>
                    <div style={{ marginTop: 5, color: palette.muted, fontSize: 12, lineHeight: 1.55 }}>
                      实时校验事项类型、材料完整性、程序节点、责任主体和归档留痕。
                    </div>
                    <div style={{ marginTop: 9, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ padding: '7px 8px', borderRadius: 8, background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.78)', border: `1px solid ${palette.line}` }}>
                        <div style={{ color: palette.muted, fontSize: 11 }}>是否属于三重一大</div>
                        <div style={{ color: palette.ink, fontWeight: 600 }}>是</div>
                      </div>
                      <div style={{ padding: '7px 8px', borderRadius: 8, background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.78)', border: `1px solid ${palette.line}` }}>
                        <div style={{ color: palette.muted, fontSize: 11 }}>匹配事项类型</div>
                        <div style={{ color: palette.ink, fontWeight: 600 }}>{matterType}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ color: palette.ink, fontWeight: 600, marginBottom: 8 }}>需履行程序</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {(PROCEDURE_MAP[matterType] || []).map(item => (
                    <Tag key={item} color="blue" style={{ margin: 0, padding: '3px 7px' }}>{item}</Tag>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: isDarkMode ? '#2b2114' : '#fffbeb', border: `1px solid ${isDarkMode ? '#854d0e' : '#fde68a'}` }}>
                <div style={{ color: isDarkMode ? '#fde68a' : '#92400e', fontWeight: 600 }}>当前缺口</div>
                <div style={{ marginTop: 8, display: 'grid', gap: 7 }}>
                  {demo.aiGaps.map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: isDarkMode ? '#fef3c7' : '#92400e', fontSize: 13, lineHeight: 1.55 }}>
                      <AlertOutlined style={{ marginTop: 3 }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {riskNode && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: isDarkMode ? '#2d1618' : '#fff1f2', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fecdd3'}` }}>
                  <div style={{ color: isDarkMode ? '#fecaca' : '#b42318', fontWeight: 600 }}>高敏节点：{riskNode.title}</div>
                  <Paragraph style={{ margin: '6px 0 0', color: isDarkMode ? '#fecaca' : '#b42318', fontSize: 13, lineHeight: 1.6 }}>
                    {riskNode.riskPoint}
                  </Paragraph>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <Button
                  type="primary"
                  block
                  icon={<RobotOutlined />}
                  loading={aiReviewLoading}
                  onClick={runAiReview}
                  style={{ height: 40, fontWeight: 600 }}
                >
                  生成真实 AI 审查报告
                </Button>
                {aiReviewError && (
                  <div style={{ marginTop: 8, color: palette.red, fontSize: 12 }}>调用失败：{aiReviewError}</div>
                )}
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text strong style={{ color: palette.ink }}>AI 审查意见</Text>
                  {aiReviewLoading && <Tag color="processing" style={{ margin: 0 }}>生成中</Tag>}
                </div>
                <div style={{
                  marginTop: 8,
                  maxHeight: 280,
                  overflow: 'auto',
                }}>
                  {renderAiReviewContent()}
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text strong style={{ color: palette.ink }}>电子归档包</Text>
                  <Tag color={isFlowDone ? 'green' : 'default'} style={{ margin: 0 }}>{archiveNo}</Tag>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {archiveItems.map(item => (
                    <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: palette.ink, fontWeight: 700 }}>{item.label}</div>
                        <div style={{ color: palette.muted, fontSize: 12 }}>{item.value}</div>
                      </div>
                      <Tag color={item.status.includes('已') || item.status === '真实生成' ? 'green' : 'default'} style={{ margin: 0 }}>{item.status}</Tag>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Drawer
        title={
          <Space>
            <FileSearchOutlined style={{ color: palette.blue }} />
            <span>合规节点凭证审查：{currentDetail?.title}</span>
          </Space>
        }
        placement="right"
        size="large"
        onClose={() => setDetailVisible(false)}
        open={detailVisible}
        styles={{
          body: { background: isDarkMode ? '#141414' : '#fff' },
          header: { background: isDarkMode ? '#1f1f1f' : '#fff', borderBottom: `1px solid ${palette.line}` },
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <Text type="secondary">智能审计插件已从 OA 底层表单中提取出以下审批数据要素，供法务审核员二次确认：</Text>
        </div>
        {renderDetailContent()}
      </Drawer>

      <Modal
        title={<Space><ProfileOutlined style={{ color: palette.blue }} />{currentSubDetail?.detail?.title || '详细台账底稿'}</Space>}
        open={subDetailVisible}
        onCancel={() => setSubDetailVisible(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setSubDetailVisible(false)}>
            已阅
          </Button>,
        ]}
        styles={{
          content: { background: isDarkMode ? '#1f1f1f' : '#fff' },
          header: { background: isDarkMode ? '#1f1f1f' : '#fff', borderBottom: `1px solid ${palette.line}` },
        }}
      >
        <div style={{ padding: '16px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <Tag color="blue">考察人：{currentSubDetail?.member} ({currentSubDetail?.dept})</Tag>
          </div>
          <div style={{ padding: 16, background: isDarkMode ? '#141414' : '#fafafa', border: `1px solid ${palette.line}`, borderRadius: 8, color: palette.text, lineHeight: 1.6 }}>
            {currentSubDetail?.detail?.content}
          </div>
        </div>
      </Modal>

      <style>{`
        .oa-workflow-page * {
          letter-spacing: 0;
        }

        .oa-workflow-page .ant-form-item-label > label {
          color: ${palette.muted};
          font-size: 12px;
          font-weight: 700;
        }

        .oa-workflow-page .oa-intake-panel {
          border: 1px solid var(--color-border-2) !important;
          border-radius: 16px !important;
          background: var(--color-bg-2) !important;
          box-shadow: 0 16px 40px rgba(29, 33, 41, 0.08) !important;
        }

        .oa-workflow-page .oa-intake-head {
          position: relative;
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
          padding: 18px 16px 16px;
          border-bottom: 1px solid var(--color-border-1);
          background:
            linear-gradient(135deg, var(--color-primary-light-1), transparent 46%),
            var(--color-bg-2);
        }

        .oa-workflow-page .oa-intake-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgb(var(--primary-6));
          background: var(--color-primary-light-1);
          font-size: 18px;
        }

        .oa-workflow-page .oa-intake-kicker {
          color: rgb(var(--primary-6));
          font-size: 11px;
          font-weight: var(--font-weight-600);
          line-height: 1;
        }

        .oa-workflow-page .oa-intake-title {
          margin-top: 6px;
          color: var(--color-text-1);
          font-size: 19px;
          line-height: 1.2;
          font-weight: var(--font-weight-600);
        }

        .oa-workflow-page .oa-intake-desc {
          margin-top: 7px;
          color: var(--color-text-3);
          font-size: 12px;
          line-height: 1.55;
          font-weight: var(--font-weight-400);
        }

        .oa-workflow-page .oa-intake-state {
          padding: 4px 9px;
          border-radius: 999px;
          color: rgb(var(--orange-6));
          background: rgb(var(--orange-1));
          font-size: 12px;
          line-height: 1;
          font-weight: var(--font-weight-500);
          white-space: nowrap;
        }

        .oa-workflow-page .oa-intake-state.is-done {
          color: rgb(var(--green-6));
          background: rgb(var(--green-1));
        }

        .oa-workflow-page .oa-intake-body {
          padding: 14px;
          overflow: auto;
          min-height: 0;
        }

        .oa-workflow-page .oa-intake-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px;
          margin-bottom: 13px;
          border-radius: 12px;
          background: var(--color-fill-1);
          border: 1px solid var(--color-border-1);
        }

        .oa-workflow-page .oa-intake-summary span,
        .oa-workflow-page .oa-intake-meta-grid span {
          display: block;
          color: var(--color-text-3);
          font-size: 11px;
          line-height: 1;
          font-weight: var(--font-weight-400);
        }

        .oa-workflow-page .oa-intake-summary strong {
          display: block;
          margin-top: 7px;
          color: var(--color-text-1);
          font-size: 15px;
          line-height: 1.25;
          font-weight: var(--font-weight-600);
        }

        .oa-workflow-page .oa-intake-summary em {
          padding: 5px 9px;
          border-radius: 999px;
          color: rgb(var(--red-6));
          background: rgb(var(--red-1));
          font-size: 12px;
          font-style: normal;
          font-weight: var(--font-weight-500);
          white-space: nowrap;
        }

        .oa-workflow-page .oa-arco-quick-form .arco-form-label-item {
          color: var(--color-text-2);
          font-size: 12px;
          font-weight: var(--font-weight-500);
          line-height: 1.2;
        }

        .oa-workflow-page .oa-arco-quick-form .arco-form-item {
          margin-bottom: 12px;
        }

        .oa-workflow-page .oa-arco-quick-form .arco-input,
        .oa-workflow-page .oa-arco-quick-form .arco-select-view {
          min-height: 36px;
          border-radius: var(--border-radius-large);
          border-color: var(--color-border-2);
          background: var(--color-bg-2);
          color: var(--color-text-1);
          font-size: 13px;
          font-weight: var(--font-weight-400);
        }

        .oa-workflow-page .oa-arco-quick-form .arco-input:hover,
        .oa-workflow-page .oa-arco-quick-form .arco-select-view:hover {
          border-color: rgb(var(--primary-6));
        }

        .oa-workflow-page .oa-arco-quick-form .arco-input:focus,
        .oa-workflow-page .oa-arco-quick-form .arco-input.arco-input-focus,
        .oa-workflow-page .oa-arco-quick-form .arco-select-view-focus {
          border-color: rgb(var(--primary-6));
          box-shadow: 0 0 0 2px var(--color-primary-light-1);
        }

        .oa-workflow-page .oa-arco-quick-form .arco-input[disabled],
        .oa-workflow-page .oa-arco-quick-form .arco-select-disabled .arco-select-view {
          background: var(--color-fill-2);
          color: var(--color-text-4);
        }

        .oa-workflow-page .oa-arco-quick-form .arco-input::placeholder,
        .oa-workflow-page .oa-arco-quick-form .arco-select-view-placeholder {
          color: var(--color-text-3);
          font-weight: var(--font-weight-400);
        }

        .oa-workflow-page .oa-intake-meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 2px;
          padding-top: 12px;
          border-top: 1px solid var(--color-border-1);
        }

        .oa-workflow-page .oa-intake-meta-grid div {
          min-width: 0;
        }

        .oa-workflow-page .oa-intake-meta-grid strong {
          display: block;
          margin-top: 6px;
          color: var(--color-text-1);
          font-size: 13px;
          line-height: 1.35;
          font-weight: var(--font-weight-500);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .oa-workflow-page .oa-intake-materials {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid var(--color-border-1);
        }

        .oa-workflow-page .oa-intake-subtitle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .oa-workflow-page .oa-intake-subtitle span {
          color: var(--color-text-1);
          font-size: 13px;
          font-weight: var(--font-weight-600);
        }

        .oa-workflow-page .oa-intake-subtitle em {
          color: rgb(var(--primary-6));
          font-size: 12px;
          font-style: normal;
          font-weight: var(--font-weight-500);
        }

        .oa-workflow-page .oa-intake-material-list {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }

        .oa-workflow-page .oa-intake-material-list div {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr);
          gap: 8px;
          align-items: center;
          min-height: 24px;
          color: var(--color-text-2);
          font-size: 13px;
          font-weight: var(--font-weight-400);
        }

        .oa-workflow-page .oa-intake-material-list svg {
          color: var(--color-text-4);
        }

        .oa-workflow-page .oa-intake-material-list .is-ready svg {
          color: rgb(var(--green-6));
        }

        .oa-workflow-page .oa-intake-material-list span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .oa-workflow-page .oa-intake-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
          margin-top: 16px;
        }

        .oa-workflow-page .oa-intake-actions.is-started {
          grid-template-columns: 1fr 1fr;
        }

        .oa-workflow-page .ant-progress-text {
          font-size: 12px;
        }

        .oa-ai-core {
          width: 72px;
          height: 72px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          isolation: isolate;
        }

        .oa-ai-core-ring {
          position: absolute;
          inset: 5px;
          border-radius: 50%;
          border: 1px solid rgba(29, 95, 215, 0.28);
          animation: oa-ai-pulse 2.8s ease-in-out infinite;
        }

        .oa-ai-core-ring-two {
          inset: 0;
          animation-delay: 520ms;
          opacity: 0.54;
        }

        .oa-ai-core-disc {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 20px;
          background:
            radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.14) 24%, transparent 35%),
            conic-gradient(from 120deg, var(--ui-primary), #12b3a8, #7c3aed, var(--ui-primary));
          box-shadow: 0 14px 28px rgba(29,95,215,0.22);
          animation: oa-ai-spin 4.8s linear infinite;
          z-index: 2;
        }

        .oa-ai-core-wave {
          position: absolute;
          left: 50%;
          bottom: 2px;
          transform: translateX(-50%);
          display: flex;
          gap: 3px;
          z-index: 3;
        }

        .oa-ai-core-wave i {
          width: 3px;
          height: 8px;
          border-radius: 999px;
          opacity: 0.72;
          animation: oa-ai-wave 960ms ease-in-out infinite;
        }

        .oa-ai-core:not(.is-active) .oa-ai-core-wave i {
          animation-duration: 1.8s;
          opacity: 0.42;
        }

        .oa-ai-report p {
          margin: 0 0 7px;
          color: ${palette.text};
          font-size: 12px;
          line-height: 1.7;
        }

        .oa-ai-report ul,
        .oa-ai-report ol {
          margin: 0 0 8px;
          padding-left: 18px;
          color: ${palette.text};
          font-size: 12px;
          line-height: 1.7;
        }

        .oa-ai-report table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 6px;
          font-size: 12px;
        }

        .oa-ai-report th,
        .oa-ai-report td {
          border: 1px solid ${palette.line};
          padding: 6px 7px;
          vertical-align: top;
        }

        .oa-ai-report th {
          background: ${isDarkMode ? '#172033' : '#f1f5f9'};
          color: ${palette.ink};
        }

        .oa-ai-report strong {
          color: ${palette.ink};
        }

        @keyframes oa-ai-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes oa-ai-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.36; }
          50% { transform: scale(1.12); opacity: 0.9; }
        }

        @keyframes oa-ai-wave {
          0%, 100% { transform: scaleY(0.55); }
          50% { transform: scaleY(1.45); }
        }

        @media (max-width: 1440px) {
          .oa-workflow-page .oa-work-grid {
            grid-template-columns: 300px minmax(380px, 1fr) 340px !important;
          }

          .oa-workflow-page .oa-summary-strip {
            grid-template-columns: repeat(3, 104px) !important;
          }

          .oa-workflow-page .oa-script-steps {
            grid-template-columns: repeat(4, 82px) !important;
          }
        }

        @media (max-width: 1180px) {
          .oa-workflow-page {
            overflow: auto !important;
          }

          .oa-workflow-page .oa-work-grid {
            grid-template-columns: 1fr !important;
            overflow: visible !important;
          }

          .oa-workflow-page .oa-summary-strip {
            grid-template-columns: repeat(3, minmax(96px, 1fr)) !important;
          }

          .oa-workflow-page .oa-script-steps {
            grid-template-columns: repeat(4, minmax(76px, 1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}
