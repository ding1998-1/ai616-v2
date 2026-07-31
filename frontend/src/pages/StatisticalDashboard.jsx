import React, { useEffect, useMemo, useState } from 'react';
import { Typography, Row, Col, Progress, Table, Tag, Steps, Badge, Popover, Spin, Space, Tooltip, Button } from 'antd';
import {
  AlertOutlined,
  ArrowUpOutlined,
  BankOutlined,
  BulbOutlined,
  ExclamationCircleFilled,
  FallOutlined,
  FileProtectOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  FundOutlined,
  InfoCircleOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { loadDemoAssets } from '../lib/demoApi';

const { Title, Text, Link } = Typography;

const ICON_MAP = {
  bank: <BankOutlined />,
  project: <ProjectOutlined />,
  fund: <FundOutlined />,
  alert: <AlertOutlined />,
};

const TONE_MAP = {
  bank: { accent: '#2563eb', soft: '#eff6ff', iconBg: 'rgba(37,99,235,0.12)' },
  project: { accent: '#0f766e', soft: '#ecfeff', iconBg: 'rgba(15,118,110,0.12)' },
  fund: { accent: '#b45309', soft: '#fff7ed', iconBg: 'rgba(180,83,9,0.12)' },
  alert: { accent: '#c2410c', soft: '#fff7ed', iconBg: 'rgba(194,65,12,0.12)' },
};

const MATTER_TONE_MAP = {
  '重大事项': { accent: '#4f6ef7', soft: '#f5f7ff', border: 'rgba(79,110,247,0.18)' },
  '重要干部': { accent: '#0f766e', soft: '#edf8f6', border: 'rgba(15,118,110,0.16)' },
  '重大项目': { accent: '#9a6b20', soft: '#fbf6ec', border: 'rgba(154,107,32,0.16)' },
  '大额资金': { accent: '#7c3aed', soft: '#f6f0ff', border: 'rgba(124,58,237,0.16)' },
};

const STATUS_VISUAL_MAP = {
  critical: { label: '重点关注', accent: '#b42318', soft: 'rgba(180,35,24,0.10)', border: 'rgba(180,35,24,0.14)' },
  attention: { label: '跟踪中', accent: '#b54708', soft: 'rgba(181,71,8,0.10)', border: 'rgba(181,71,8,0.14)' },
  progress: { label: '推进中', accent: '#175cd3', soft: 'rgba(23,92,211,0.10)', border: 'rgba(23,92,211,0.14)' },
  stable: { label: '平稳', accent: '#027a48', soft: 'rgba(2,122,72,0.10)', border: 'rgba(2,122,72,0.14)' },
};

function StrokeIcon({ children, size = 18, color = '#2563eb', strokeWidth = 1.8, style }) {
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
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

const TITLE_GLYPHS = {
  focus: props => (
    <StrokeIcon {...props}>
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2.5" />
    </StrokeIcon>
  ),
  layers: props => (
    <StrokeIcon {...props}>
      <path d="m12 4 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </StrokeIcon>
  ),
  route: props => (
    <StrokeIcon {...props}>
      <circle cx="6.5" cy="17.5" r="2" />
      <circle cx="17.5" cy="6.5" r="2" />
      <path d="M8.5 17.5h3a4 4 0 0 0 4-4v-5" />
      <path d="M13 6.5h2.5" />
    </StrokeIcon>
  ),
  radar: props => (
    <StrokeIcon {...props}>
      <path d="M12 12 18.5 5.5" />
      <path d="M13.5 5.5h5v5" />
      <path d="M20 14a8 8 0 1 1-4-8" />
      <path d="M12 8a4 4 0 1 0 4 4" />
    </StrokeIcon>
  ),
  pulse: props => (
    <StrokeIcon {...props}>
      <path d="M3.5 12h4l2-4 4.5 8 2.2-4H20.5" />
    </StrokeIcon>
  ),
  archive: props => (
    <StrokeIcon {...props}>
      <rect x="4.5" y="5" width="15" height="4.5" rx="1.5" />
      <path d="M6.5 9.5V18a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9.5" />
      <path d="M10 13h4" />
    </StrokeIcon>
  ),
};

const MATTER_GLYPHS = {
  '重大事项': props => (
    <StrokeIcon {...props}>
      <rect x="5" y="4.5" width="14" height="15" rx="2.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </StrokeIcon>
  ),
  '重要干部': props => (
    <StrokeIcon {...props}>
      <circle cx="12" cy="8.5" r="3" />
      <path d="M6.5 18c.8-2.8 3-4.5 5.5-4.5S16.7 15.2 17.5 18" />
      <path d="M4.5 18h15" />
    </StrokeIcon>
  ),
  '重大项目': props => (
    <StrokeIcon {...props}>
      <path d="M5 18.5h14" />
      <path d="M7 18.5v-6l5-3 5 3v6" />
      <path d="M10 9V6h4v3" />
    </StrokeIcon>
  ),
  '大额资金': props => (
    <StrokeIcon {...props}>
      <ellipse cx="12" cy="7" rx="5.5" ry="2.2" />
      <path d="M6.5 7v5c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V7" />
      <path d="M6.5 12v5c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2v-5" />
    </StrokeIcon>
  ),
};

function getMatterStatus(alerts = []) {
  if (alerts.some(item => item.color === 'error')) return 'critical';
  if (alerts.some(item => item.color === 'warning')) return 'attention';
  if (alerts.length > 0) return 'progress';
  return 'stable';
}

function Panel({ title, extra, children, isDarkMode = false, padded = true, style }) {
  const isFlexPanel = style?.display === 'flex';
  return (
    <div
      style={{
        background: isDarkMode ? '#172033' : 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.9))',
        border: isDarkMode ? '1px solid #273449' : '1px solid rgba(15, 23, 42, 0.06)',
        borderRadius: 24,
        boxShadow: isDarkMode ? 'none' : '0 18px 40px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || extra) && (
        <div
          style={{
            padding: '18px 22px 14px',
            borderBottom: isDarkMode ? '1px solid rgba(148, 163, 184, 0.12)' : '1px solid rgba(15, 23, 42, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
        <div style={{ minWidth: 0 }}>{title}</div>
          {extra}
        </div>
      )}
      <div
        style={{
          ...(padded ? { padding: 22 } : {}),
          ...(isFlexPanel ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

function HintIcon({ title, isDarkMode = false }) {
  return (
    <Tooltip title={title}>
      <InfoCircleOutlined
        style={{
          color: isDarkMode ? '#94a3b8' : '#98a2b3',
          fontSize: 14,
          cursor: 'help',
        }}
      />
    </Tooltip>
  );
}

function DashboardMetricCard({ title, value, prefix, suffix, icon, trend, trendValue, statKey, isDarkMode }) {
  const tone = TONE_MAP[statKey] || TONE_MAP.bank;

  return (
    <div
      style={{
        borderRadius: 22,
        background: isDarkMode ? '#172033' : 'linear-gradient(180deg, #ffffff, #fbfdff)',
        border: isDarkMode ? '1px solid #273449' : '1px solid rgba(15, 23, 42, 0.06)',
        boxShadow: isDarkMode ? 'none' : '0 18px 40px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255,255,255,0.85)',
        padding: 22,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${tone.soft} 0%, rgba(255,255,255,0) 60%)`,
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: isDarkMode ? '#94a3b8' : '#667085',
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 34,
              lineHeight: 1.05,
              fontWeight: 700,
              color: isDarkMode ? '#f8fafc' : '#101828',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {prefix}{value}{suffix}
          </div>
          {trend && (
            <div
              style={{
                marginTop: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 999,
                color: tone.accent,
                background: tone.iconBg,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {trend === 'up' ? <ArrowUpOutlined /> : <FallOutlined />}
              <span>较去年同期 {trendValue}</span>
            </div>
          )}
        </div>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: tone.iconBg,
            color: tone.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function DecisionPathFlow({ data, isDarkMode }) {
  const stepItems = (data?.steps || []).map(item => {
    let subTitleNode = null;
    if (item.riskPoint) {
      const content = (
        <div style={{ maxWidth: 280 }}>
          <div style={{ marginBottom: 8 }}>
            <Text type="danger" strong>风险点：</Text>
            <div style={{ fontSize: 13, color: isDarkMode ? '#ffccc7' : '#cf1322', marginTop: 4 }}>{item.riskPoint}</div>
          </div>
          <div>
            <Text type="success" strong>防范措施：</Text>
            <div style={{ fontSize: 13, color: isDarkMode ? '#b7eb8f' : '#389e0d', marginTop: 4 }}>{item.precaution}</div>
          </div>
        </div>
      );
      subTitleNode = (
        <Popover content={content} title={<span style={{ color: '#ff4d4f' }}><AlertOutlined /> 风险提示</span>} trigger="hover" placement="top">
          <span style={{ cursor: 'pointer', marginLeft: 4 }}>
            <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />
          </span>
        </Popover>
      );
    }

    return {
      title: <span style={{ color: isDarkMode ? '#e5e7eb' : '#111827', fontWeight: 600 }}>{item.title}</span>,
      description: <span style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#667085' }}>{item.desc}</span>,
      status: item.riskPoint ? 'process' : 'finish',
      subTitle: subTitleNode,
    };
  });

  return (
    <div style={{ paddingTop: 6 }}>
      <Steps current={Math.max((stepItems || []).length - 2, 0)} labelPlacement="vertical" size="small" items={stepItems} />
    </div>
  );
}

function PolicyRadar({ alerts, isDarkMode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(alerts || []).map((alert, index) => (
        <div
          key={index}
          style={{
            borderRadius: 18,
            border: isDarkMode ? '1px solid #334155' : '1px solid rgba(15, 23, 42, 0.08)',
            background: isDarkMode ? '#111827' : '#f8fafc',
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Badge color={alert.color === 'error' ? '#ef4444' : '#f59e0b'} text={<Text strong style={{ fontSize: 13, color: isDarkMode ? '#e5e7eb' : '#0f172a' }}>{alert.type}</Text>} />
            <Tag color={alert.color === 'error' ? 'error' : 'warning'} style={{ margin: 0 }}>
              {alert.color === 'error' ? '重点关注' : '跟踪提示'}
            </Tag>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7, color: isDarkMode ? '#94a3b8' : '#475467' }}>
            {alert.content}
          </div>
          <Link style={{ marginTop: 8, display: 'inline-block', fontSize: 12 }}>查看关联制度</Link>
        </div>
      ))}
    </div>
  );
}

export default function StatisticalDashboard({ isDarkMode = true, onNavigate }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [matterType, setMatterType] = useState('重大事项');

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        const payload = await loadDemoAssets();
        if (!alive) return;
        const dashboardData = payload.dashboard || {};
        setDashboard(dashboardData);
        setMatterType(dashboardData.defaultMatterType || '重大事项');
      } catch {
        if (alive) setDashboard(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    boot();
    return () => { alive = false; };
  }, []);

  const currentPath = dashboard?.paths?.[matterType];
  const currentAlerts = dashboard?.alerts?.[matterType] || [];
  const anomalySource = dashboard?.recentAnomalies || [];
  const highRiskCount = anomalySource.filter(item => item.level === '高风险').length;
  const totalStats = dashboard?.stats || [];
  const currentStepCount = currentPath?.steps?.length || 0;
  const matterCards = (dashboard?.pathOptions || []).map((option, index) => {
    const alerts = dashboard?.alerts?.[option.value] || [];
    const statusKey = getMatterStatus(alerts);
    return {
      ...option,
      index,
      tone: MATTER_TONE_MAP[option.value] || MATTER_TONE_MAP['重大事项'],
      statusKey,
      status: STATUS_VISUAL_MAP[statusKey],
      stepCount: dashboard?.paths?.[option.value]?.steps?.length || 0,
      alertCount: alerts.length,
      criticalCount: alerts.filter(item => item.color === 'error').length,
    };
  });
  const currentMatterCard = matterCards.find(item => item.value === matterType) || matterCards[0];
  const currentMatterStatus = currentMatterCard?.status || STATUS_VISUAL_MAP.stable;
  const primaryFocus = currentMatterCard?.statusKey === 'critical'
    ? {
        eyebrow: '当前事项优先级',
        title: `${matterType} 需要优先核查`,
        summary: '该事项存在重点风险提示，建议先核查流程闭环、关键材料和上会时序，再看其他统计数据。',
      }
    : currentMatterCard?.statusKey === 'attention'
      ? {
          eyebrow: '当前事项优先级',
          title: `${matterType} 处于跟踪状态`,
          summary: '当前事项没有最重红项，但存在需要补齐或复核的制度要求，适合先处理后继续流转。',
        }
      : currentMatterCard?.statusKey === 'progress'
        ? {
            eyebrow: '当前事项优先级',
            title: `${matterType} 正在按路径推进`,
            summary: '流程处于正常推进中，建议重点检查节点材料和归档留痕是否同步到位。',
          }
        : {
            eyebrow: '当前事项优先级',
            title: `${matterType} 当前状态平稳`,
            summary: '当前事项无明显异常，可以快速确认节点完整度后切换查看其他事项。',
          };
  const quickActions = [
    {
      key: 'quick-audit',
      label: '开始快速审查',
      desc: '上传材料或粘贴文本',
      page: 'compliance_focus',
      icon: <FileSearchOutlined />,
      primary: true,
    },
    {
      key: 'contract',
      label: '合同审查',
      desc: '预览、高亮、下载审查版',
      page: 'cases',
      icon: <FileProtectOutlined />,
    },
    {
      key: 'archive',
      label: '查看归档',
      desc: '追溯历史审查记录',
      page: 'archive',
      icon: <FolderOpenOutlined />,
    },
  ];

  const anomalyColumns = useMemo(() => ([
    {
      title: '项目名称',
      dataIndex: 'project',
      ellipsis: true,
      render: value => <Text strong style={{ color: isDarkMode ? '#dbe3f0' : '#111827', fontSize: 13 }}>{value}</Text>,
    },
    {
      title: '异常类型',
      dataIndex: 'issue',
      render: value => <Text style={{ color: isDarkMode ? '#fda4af' : '#b42318', fontSize: 13 }}>{value}</Text>,
    },
    {
      title: '风险级别',
      dataIndex: 'level',
      width: 92,
      render: value => <Tag color={value === '高风险' ? 'error' : 'warning'} style={{ margin: 0 }}>{value}</Tag>,
    },
  ]), [isDarkMode]);

  if (loading) {
    return (
      <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: '212px 86px minmax(0, 1fr) 70px',
        gap: 12,
        overflow: 'hidden',
        padding: 16,
        boxSizing: 'border-box',
        background: isDarkMode
          ? 'linear-gradient(180deg, #0f172a 0%, #101828 100%)'
          : 'radial-gradient(circle at 12% 10%, rgba(79,110,247,0.12), transparent 30%), linear-gradient(180deg, #f7f9fc 0%, #edf2f7 100%)',
      }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.3fr) minmax(360px, 0.7fr)',
          gap: 12,
          minHeight: 0,
        }}
      >
        <div
          style={{
            borderRadius: 26,
            padding: '20px 26px',
            background: isDarkMode
              ? 'linear-gradient(135deg, rgba(9,14,25,0.98) 0%, rgba(15,23,42,0.96) 100%)'
              : 'linear-gradient(135deg, #ffffff 0%, #f7faff 58%, #eef4ff 100%)',
            border: isDarkMode ? '1px solid rgba(148,163,184,0.14)' : '1px solid rgba(79,110,247,0.16)',
            boxShadow: isDarkMode ? '0 18px 44px rgba(2,6,23,0.34)' : '0 22px 52px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 300px',
            gap: 22,
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(79,110,247,0.08)', color: isDarkMode ? '#cbd5e1' : '#3448a8', fontSize: 12, fontWeight: 800 }}>
              <TITLE_GLYPHS.focus size={15} color={isDarkMode ? '#cbd5e1' : '#3448a8'} />
              今日处置结论
            </div>
            <Title level={1} style={{ margin: '12px 0 0', color: isDarkMode ? '#f8fafc' : '#0f172a', lineHeight: 1.02, fontSize: 42 }}>
              先处理
              <span style={{ color: currentMatterCard?.tone.accent || '#4f6ef7' }}> {matterType} </span>
              风险
            </Title>
            <div style={{ marginTop: 10, color: isDarkMode ? '#94a3b8' : '#475467', fontSize: 14, lineHeight: 1.6, maxWidth: 720 }}>
              {primaryFocus.summary}
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {quickActions.map(action => (
                <Button
                  key={action.key}
                  type={action.primary ? 'primary' : 'default'}
                  icon={action.icon}
                  onClick={() => onNavigate?.(action.page)}
                  style={{
                    height: 38,
                    borderRadius: 10,
                    fontWeight: 700,
                    boxShadow: action.primary && !isDarkMode ? '0 12px 24px rgba(29,95,215,0.18)' : 'none',
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { label: '状态', value: currentMatterStatus.label, tone: currentMatterStatus.accent },
              { label: '节点', value: `${currentStepCount}`, tone: currentMatterCard?.tone.accent || '#4f6ef7' },
              { label: '提示', value: `${currentAlerts.length}`, tone: highRiskCount > 0 ? '#b42318' : '#175cd3' },
            ].map(item => (
              <div
                key={item.label}
                style={{
                  minHeight: 92,
                  borderRadius: 20,
                  padding: '14px 12px',
                  background: isDarkMode ? 'rgba(255,255,255,0.04)' : '#ffffff',
                  border: isDarkMode ? '1px solid rgba(148,163,184,0.1)' : '1px solid rgba(15,23,42,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#667085' }}>{item.label}</div>
                <div style={{ fontSize: 25, lineHeight: 1, fontWeight: 900, color: item.tone }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            borderRadius: 26,
            padding: 16,
            background: isDarkMode
              ? 'linear-gradient(180deg, rgba(17,24,39,0.94) 0%, rgba(11,18,32,0.98) 100%)'
              : `linear-gradient(180deg, #ffffff 0%, ${currentMatterCard?.tone.soft || '#f5f7ff'} 100%)`,
            border: isDarkMode ? '1px solid rgba(148,163,184,0.12)' : `1px solid ${currentMatterCard?.tone.border || 'rgba(15,23,42,0.08)'}`,
            boxShadow: isDarkMode ? 'none' : '0 18px 44px rgba(15,23,42,0.06)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#667085', fontWeight: 800 }}>当前看板</div>
              <div style={{ marginTop: 6, fontSize: 24, lineHeight: 1.1, fontWeight: 900, color: isDarkMode ? '#f8fafc' : '#101828' }}>{matterType}</div>
            </div>
            <Tag style={{ margin: 0, color: currentMatterStatus.accent, background: currentMatterStatus.soft, border: `1px solid ${currentMatterStatus.border}`, fontWeight: 800 }}>
              {currentMatterStatus.label}
            </Tag>
          </div>
          <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 8, marginTop: 12, minHeight: 0, flex: 1 }}>
            {[
              `核查 ${currentStepCount} 个流程节点是否闭环`,
              currentAlerts.length ? `先看 ${currentAlerts.length} 条制度/风险提示` : '当前未发现新增风险提示',
              highRiskCount ? `全局 ${highRiskCount} 项高风险需压到最前` : '全局高风险红项为空',
            ].map(line => (
              <div
                key={line}
                style={{
                  borderRadius: 15,
                  padding: '9px 12px',
                  background: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.78)',
                  border: isDarkMode ? '1px solid rgba(148,163,184,0.08)' : '1px solid rgba(15,23,42,0.05)',
                  color: isDarkMode ? '#dbe3f0' : '#111827',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, minHeight: 0 }}>
        {matterCards.map(item => {
          const isActive = item.value === matterType;
          const MatterGlyph = MATTER_GLYPHS[item.value] || TITLE_GLYPHS.layers;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setMatterType(item.value)}
              style={{
                textAlign: 'left',
                borderRadius: 20,
                padding: '12px 14px',
                background: isDarkMode
                  ? 'linear-gradient(180deg, rgba(17,24,39,0.92) 0%, rgba(11,18,32,0.98) 100%)'
                  : `linear-gradient(180deg, #ffffff 0%, ${item.tone.soft} 100%)`,
                border: isActive ? `1px solid ${item.tone.accent}` : `1px solid ${item.tone.border}`,
                boxShadow: isActive && !isDarkMode ? `0 14px 28px ${item.status.soft}` : (isDarkMode ? 'none' : '0 10px 24px rgba(15,23,42,0.04)'),
                cursor: 'pointer',
                transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
                  <MatterGlyph size={17} color={item.tone.accent} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: isDarkMode ? '#f8fafc' : '#101828', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: isDarkMode ? '#94a3b8' : '#667085' }}>{item.status.label} · {item.stepCount} 节点</div>
                </div>
                <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 900, color: item.tone.accent }}>{item.alertCount}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 0.65fr)',
          gap: 12,
          minHeight: 0,
        }}
      >
        <Panel
          isDarkMode={isDarkMode}
          padded={false}
          style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}
          title={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TITLE_GLYPHS.route size={18} color={currentMatterCard?.tone.accent || '#2563eb'} />
              <Title level={5} style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#111827' }}>当前事项路径</Title>
              <Tag color="processing" style={{ margin: 0 }}>{matterType}</Tag>
            </div>
          )}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 18px 18px' }}>
            <DecisionPathFlow data={currentPath} isDarkMode={isDarkMode} />
          </div>
        </Panel>

        <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) 148px', gap: 12, minHeight: 0 }}>
          <Panel
            isDarkMode={isDarkMode}
            padded={false}
            style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}
            title={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TITLE_GLYPHS.radar size={18} color={currentMatterCard?.tone.accent || '#2563eb'} />
                <Title level={5} style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#111827' }}>风险雷达</Title>
              </div>
            )}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              <PolicyRadar alerts={currentAlerts} isDarkMode={isDarkMode} />
            </div>
          </Panel>

          <Panel
            isDarkMode={isDarkMode}
            padded={false}
            style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}
            title={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TITLE_GLYPHS.pulse size={18} color={currentMatterCard?.tone.accent || '#2563eb'} />
                <Title level={5} style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#111827' }}>异常快照</Title>
              </div>
            )}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {anomalySource.slice(0, 2).map((item, index) => (
                <div key={`${item.project}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', fontSize: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: isDarkMode ? '#dbe3f0' : '#111827', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.project}</div>
                    <div style={{ marginTop: 2, color: isDarkMode ? '#94a3b8' : '#667085', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.issue}</div>
                  </div>
                  <Tag color={item.level === '高风险' ? 'error' : 'warning'} style={{ margin: 0 }}>{item.level}</Tag>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(totalStats.length, 1)}, minmax(0, 1fr))`,
          gap: 10,
          minHeight: 0,
        }}
      >
        {totalStats.map(stat => (
          <div
            key={stat.key}
            style={{
              borderRadius: 18,
              padding: '10px 14px',
              background: isDarkMode ? 'rgba(17,24,39,0.92)' : 'rgba(255,255,255,0.94)',
              border: isDarkMode ? '1px solid rgba(148,163,184,0.12)' : '1px solid rgba(15,23,42,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              overflow: 'hidden',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#667085', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.title}</div>
              <div style={{ marginTop: 4, fontSize: 24, lineHeight: 1, fontWeight: 900, color: TONE_MAP[stat.icon]?.accent || '#175cd3', whiteSpace: 'nowrap' }}>
                {stat.prefix}{stat.value}{stat.suffix}
              </div>
            </div>
            <div style={{ color: TONE_MAP[stat.icon]?.accent || '#175cd3', fontSize: 20, flexShrink: 0 }}>
              {ICON_MAP[stat.icon]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
