import React, { useState, useRef, useEffect } from 'react';
import {
  Select, Typography, Button, Tag, Space, Avatar,
  Collapse, Spin, Alert, message as antMessage, Popover, Modal, Input,
  Drawer, Empty, Image,
} from 'antd';
import {
  RobotOutlined, UserOutlined, LoadingOutlined,
  FileProtectOutlined, StopOutlined, CheckCircleOutlined,
  ClockCircleOutlined, DeleteOutlined, LinkOutlined, SearchOutlined, FileTextOutlined,
  AimOutlined, UploadOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import { Welcome, Sender, Prompts } from '@ant-design/x';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch, authFetchJson } from '../lib/auth';

const { Text } = Typography;

const MATTER_TYPES = ['重大决策', '重大项目安排', '重要人事任免', '大额度资金运作'];

const QUICK_PROMPTS = [
  { key: '重大决策', label: '重大决策', description: '党委前置研究讨论、集体决策' },
  { key: '重大项目安排', label: '重大项目安排', description: '可行性报告、风险评估、专家论证' },
  { key: '重要人事任免', label: '重要人事任免', description: '党管干部、征求纪检意见、任前公示' },
  { key: '大额度资金运作', label: '大额度资金运作', description: '资金使用计划、双人签字审批' },
];

const PLACEHOLDER_MAP = {
  '重大决策': '例：2025年4月，公司召开院务会议，就XXX重大项目进行集体讨论，经党委前置审查，形成书面会议纪要……',
  '重大项目安排': '例：公司拟承接XXX基础设施建设项目，已完成可行性报告及专家论证，风险评估报告已提交法律合规部审查……',
  '重要人事任免': '例：经民主推荐和组织考察，拟任命张某某为XXX部门负责人，任前已完成公示，征求纪检监察部门意见……',
  '大额度资金运作': '例：本次资金使用计划涉及金额XXX万元，已编制资金使用计划，经双人签字审批，财务部门执行，审计部门监督……',
};

function parseRiskRadar(text) {
  if (!text) return { text, radarItems: [] };
  const match = text.match(/<risk_radar>([\s\S]*?)<\/risk_radar>/);
  if (!match) return { text, radarItems: [] };

  const radarItems = [];
  const itemRegex = /<item\s+status="([^"]+)">([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(match[1])) !== null) {
    radarItems.push({ status: itemMatch[1], label: itemMatch[2] });
  }
  return {
    text: text.replace(match[0], '').trim(),
    radarItems
  };
}

/* 5-skill pipeline definition */
const SKILLS = [
  { tool: 'extract_rules', name: '📋 制度匹配与规则提取', icon: '📋', desc: '从制度库提取强制要求、禁止事项、决策程序与责任主体' },
  { tool: 'validate_material', name: '🔍 材料真实性与完整性校验', icon: '🔍', desc: '将材料与规则进行关键词交叉比对，判断是否符合要求' },
  { tool: 'check_procedure_completeness', name: '⚖️ 决策程序合规性推演', icon: '✅', desc: '逐项核查决策程序是否完整，识别缺失环节' },
  { tool: 'identify_responsibility', name: '👤 责任主体认定与溯源', icon: '👤', desc: '核查是否明确落实责任人、监督部门与签批主体' },
  { tool: 'generate_compliance_report', name: '📄 审核报告与建议生成', icon: '📄', desc: '综合前四步结论，输出结构化合规审核报告' },
];

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

const STATUS_TONES = {
  blue: { solid: '#1677ff', soft: '#e8f1ff', border: 'rgba(22,119,255,0.28)', text: '#1456cc' },
  green: { solid: '#16a34a', soft: '#edf9f0', border: 'rgba(22,163,74,0.26)', text: '#166534' },
  orange: { solid: '#ea580c', soft: '#fff2e8', border: 'rgba(234,88,12,0.24)', text: '#c2410c' },
  purple: { solid: '#7c3aed', soft: '#f3e8ff', border: 'rgba(124,58,237,0.24)', text: '#6d28d9' },
  gray: { solid: '#98a2b3', soft: '#f8fafc', border: 'rgba(152,162,179,0.22)', text: '#667085' },
};

function parseAuditReportSections(text) {
  if (!text?.trim()) return [];
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) return [];

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    return {
      title: match[1].replace(/^[一二三四五六七八九十]+、/, '').trim(),
      content: text.slice(start, end).trim(),
      originalIndex: index,
    };
  }).filter(section => section.content).sort((a, b) => {
    const aOrder = REPORT_SECTION_ORDER.findIndex(item => a.title.includes(item));
    const bOrder = REPORT_SECTION_ORDER.findIndex(item => b.title.includes(item));
    const safeA = aOrder >= 0 ? aOrder : 99;
    const safeB = bOrder >= 0 ? bOrder : 99;
    return safeA === safeB ? a.originalIndex - b.originalIndex : safeA - safeB;
  });
}

function ComplianceAiPulse({ active = false, isDarkMode = false }) {
  return (
    <div className={`compliance-ai-core ${active ? 'is-active' : ''}`} aria-hidden="true">
      <span className="compliance-ai-ring compliance-ai-ring-one" />
      <span className="compliance-ai-ring compliance-ai-ring-two" />
      <span className="compliance-ai-disc"><RobotOutlined /></span>
      <span className="compliance-ai-wave">
        {[0, 1, 2, 3].map(item => <i key={item} style={{ animationDelay: `${item * 90}ms`, background: isDarkMode ? '#bfdbfe' : '#1677ff' }} />)}
      </span>
    </div>
  );
}

function StructuredAuditReport({ text, isDarkMode, customRenderers }) {
  const sections = parseAuditReportSections(text);
  if (!sections.length) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={customRenderers} urlTransform={(value) => value}>
        {text}
      </ReactMarkdown>
    );
  }

  const border = isDarkMode ? '#263247' : '#e6ebf2';
  const cardBg = isDarkMode ? '#0f172a' : '#fff';
  const titleColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const muted = isDarkMode ? '#8fa0b7' : '#667085';

  return (
    <div className={`structured-audit-report ${isDarkMode ? 'is-dark' : ''}`} style={{ display: 'grid', gap: 10 }}>
      {sections.map((section, index) => (
        <section key={`${section.title}-${index}`} style={{ border: `1px solid ${border}`, borderRadius: 12, background: cardBg, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: index < 2 ? '#e8f1ff' : (isDarkMode ? '#1e293b' : '#f1f5f9'), color: index < 2 ? '#1677ff' : muted, fontWeight: 800, fontSize: 12 }}>
              {index + 1}
            </span>
            <span style={{ color: titleColor, fontWeight: 800 }}>{section.title}</span>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={customRenderers} urlTransform={(value) => value}>
            {section.content}
          </ReactMarkdown>
        </section>
      ))}
    </div>
  );
}

function SectionTitle({ step, title, desc, extra, isDarkMode }) {
  const headingColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const metaColor = isDarkMode ? '#8fa0b7' : '#98a2b3';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 10,
            background: isDarkMode ? 'rgba(51,112,255,0.2)' : '#e8f1ff',
            color: '#1677ff',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {step}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: headingColor }}>{title}</div>
          {desc && (
            <div style={{ marginTop: 4, fontSize: 12, color: metaColor, lineHeight: 1.6 }}>
              {desc}
            </div>
          )}
        </div>
      </div>
      {extra}
    </div>
  );
}

function ReadyCard({ label, value, hint, active, tone = 'gray', isDarkMode }) {
  const currentTone = active ? (STATUS_TONES[tone] || STATUS_TONES.blue) : STATUS_TONES.gray;
  const labelColor = active ? currentTone.text : (isDarkMode ? '#8fa0b7' : '#98a2b3');
  const valueColor = active ? (isDarkMode ? '#f8fafc' : '#0f172a') : (isDarkMode ? '#f8fafc' : '#0f172a');
  return (
    <div
      style={{
        padding: '14px 14px 12px',
        borderRadius: 16,
        background: active
          ? (isDarkMode ? 'rgba(15,23,42,0.84)' : currentTone.soft)
          : (isDarkMode ? '#0f172a' : '#f8fafc'),
        border: active
          ? `1px solid ${currentTone.border}`
          : `1px solid ${isDarkMode ? '#334155' : '#e5e7eb'}`,
        boxShadow: active && !isDarkMode ? `inset 0 0 0 1px ${currentTone.border}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, color: labelColor }}>{label}</div>
        <Tag color={active ? (tone === 'orange' ? 'warning' : tone) : 'default'} style={{ margin: 0 }}>{active ? '已就绪' : '待完成'}</Tag>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: valueColor }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: labelColor, lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

/* ── Skill Execution Panel ─────────────────────────────────────────────────── */
function SkillPanel({ steps, isDarkMode }) {
  const bg = isDarkMode ? '#0f172a' : 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))';
  const border = isDarkMode ? '#334155' : 'rgba(15,23,42,0.07)';
  const titleColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const secondaryColor = isDarkMode ? '#8fa0b7' : '#98a2b3';
  const tertiaryColor = isDarkMode ? '#7b8ba1' : '#b0bac7';

  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 12, background: bg }}>
      <div style={{
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${border}`,
        background: isDarkMode ? '#101826' : 'rgba(255,255,255,0.82)',
      }}>
        <div>
          <Text strong style={{ fontSize: 14, color: titleColor }}>审查执行步骤</Text>
          <div style={{ fontSize: 12, color: secondaryColor, marginTop: 2 }}>
            审查链路会按顺序抽取规则、核验材料、检查程序、识别责任并生成报告。
          </div>
        </div>
        <Tag color="processing" style={{ margin: 0 }}>5 步流程</Tag>
      </div>

      <div style={{ background: bg, padding: '12px' }}>
        {SKILLS.map((skill, idx) => {
          const s = steps?.find(s => s.tool === skill.tool);
          const isDone = s?.done;
          const isRunning = s?.running && !s?.done;
          const isWaiting = !s;

          return (
            <div key={skill.tool} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '12px 14px',
              marginBottom: idx === SKILLS.length - 1 ? 0 : 10,
              background: isRunning
                ? (isDarkMode ? 'rgba(59,130,246,0.10)' : '#eef4ff')
                : isDone
                  ? (isDarkMode ? 'rgba(34,197,94,0.08)' : '#f6ffed')
                  : (isDarkMode ? '#111827' : 'rgba(255,255,255,0.86)'),
              border: isRunning
                ? '1px solid rgba(59,130,246,0.35)'
                : isDone
                  ? '1px solid rgba(34,197,94,0.28)'
                  : `1px solid ${border}`,
              borderRadius: 14,
              boxShadow: !isDarkMode && !isRunning && !isDone ? 'inset 0 1px 0 rgba(255,255,255,0.85)' : 'none',
            }}>
              <div style={{ width: 24, textAlign: 'center', marginTop: 2, flexShrink: 0 }}>
                {isRunning ? (
                  <LoadingOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                ) : isDone ? (
                  <CheckCircleOutlined style={{ color: '#3fb950', fontSize: 15 }} />
                ) : (
                  <ClockCircleOutlined style={{ color: isDarkMode ? '#64748b' : '#98a2b3', fontSize: 14 }} />
                )}
              </div>

              <div style={{
                width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isRunning ? '#1677ff' : isDone ? '#16a34a' : (isDarkMode ? '#1f2937' : '#eef2f6'),
                fontSize: 11, fontWeight: 700,
                color: (isRunning || isDone) ? '#fff' : (isDarkMode ? '#94a3b8' : '#98a2b3'),
              }}>
                {idx + 1}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{skill.icon}</span>
                  <Text strong={isRunning} style={{
                    fontSize: 13,
                    color: isRunning ? '#1677ff' : isDone ? '#15803d' : titleColor,
                  }}>
                    {skill.name}
                  </Text>
                  {isRunning && <Tag color="processing" style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px', margin: 0 }}>执行中</Tag>}
                  {isDone && <Tag color="success" style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px', margin: 0 }}>完成</Tag>}
                  {isWaiting && (
                    <Tag style={{
                      fontSize: 10, lineHeight: '16px', padding: '0 6px', margin: 0,
                      background: 'transparent',
                      borderColor: isDarkMode ? '#334155' : '#d0d5dd',
                      color: tertiaryColor,
                    }}>等待</Tag>
                  )}
                  {isDone && s?.durationMs != null && (
                    <Text style={{ fontSize: 10, color: '#16a34a' }}>
                      {(s.durationMs / 1000).toFixed(1)}s
                    </Text>
                  )}
                </div>
                <Text type="secondary" style={{
                  fontSize: 12,
                  color: isRunning ? '#4f8cff' : secondaryColor,
                }}>
                  {skill.desc}
                </Text>

                {isDone && s?.result && (
                  <div style={{ marginTop: 8 }}>
                    <Collapse
                      size="small"
                      ghost
                      items={[{
                        key: '1',
                        label: <span style={{ fontSize: 11, color: tertiaryColor }}>查看执行结果</span>,
                        children: (
                          <div style={{
                            fontSize: 11, color: isDarkMode ? '#cbd5e1' : '#667085',
                            whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto',
                            background: isDarkMode ? '#0b1220' : '#f8fafc',
                            padding: 8, borderRadius: 6,
                            border: `1px solid ${isDarkMode ? '#334155' : '#e4e7ec'}`
                          }}>
                            {typeof s.result === 'string' ? s.result.trim() : JSON.stringify(s.result, null, 2)}
                          </div>
                        ),
                      }]}
                      className="skill-result-collapse"
                      style={{ background: 'transparent' }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Single conversation turn ─────────────────────────────────────────────── */
// Simple text similarity for issue→paragraph matching
function matchIssuesToParagraphs(issues, paragraphs) {
  if (!paragraphs || !paragraphs.length) return issues;
  return issues.map(issue => {
    const issueWords = (issue.desc || '').replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
    let bestIdx = -1, bestScore = 0;
    paragraphs.forEach((p, pi) => {
      const pWords = (p.text_preview || '').replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
      const overlap = issueWords.filter(w => pWords.some(pw => pw.includes(w) || w.includes(pw))).length;
      const score = overlap / Math.max(issueWords.length, 1);
      if (score > bestScore && score > 0.2) { bestScore = score; bestIdx = pi; }
    });
    if (bestIdx >= 0) return { ...issue, para_index: paragraphs[bestIdx].para_index };
    return issue;
  });
}

// Parse issues from audit report markdown text
function parseIssuesFromReport(reportText) {
  if (!reportText) return [];
  const issues = [];
  const lines = reportText.split('\n');
  lines.forEach(line => {
    const numMatch = line.match(/^#{1,3}\s+(?:问题|不合规|风险|违规|缺失)[：:：]?\s*(.+)/);
    const bulletMatch = line.match(/^[-*]\s*\[?不?\s*合规\]?\s*[：:：]?\s*(.+)/);
    const match = numMatch || bulletMatch;
    if (match) {
      const desc = match[1].replace(/\*\*/g, '').trim();
      const severity = /高|严重|重大|红色/.test(desc) ? 'high' : /中|黄色|警告/.test(desc) ? 'medium' : 'low';
      issues.push({ desc: desc.substring(0, 100), severity, issue: desc });
    }
  });
  return issues;
}

function AuditTurn({ msg, isDarkMode, onGenerateTemplate, onLocateIssue, onEvidenceNavigate, auditDoc }) {
  const border = isDarkMode ? '1px solid #333' : '1px solid #eee';
  const isStreaming = msg.isLoading && msg.text && !msg.report;
  const emphasisColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const secondaryColor = isDarkMode ? '#8fa0b7' : '#98a2b3';
  const tertiaryColor = isDarkMode ? '#7b8ba1' : '#b0bac7';

  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div className="user-bubble" style={{
          background: 'linear-gradient(135deg,#1b63f0,#0f57d8)',
          color: '#fff',
          borderRadius: '16px 4px 16px 16px',
          padding: '12px 16px', maxWidth: '80%',
          boxShadow: '0 14px 30px rgba(15,87,216,0.24)',
        }}>
          {msg.matterType && (
            <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4 }}>📋 {msg.matterType}</div>
          )}
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
        </div>
        <Avatar icon={<UserOutlined />} style={{ background: '#0958d9', marginLeft: 8, flexShrink: 0, alignSelf: 'flex-end' }} />
      </div>
    );
  }

  /* Assistant */
  const hasSteps = msg.steps && msg.steps.length > 0;
  const showPanel = hasSteps || msg.isLoading;

  const parsedReport = parseRiskRadar(msg.report);
  const parsedText = parseRiskRadar(msg.text);

  const radarData = msg.report ? parsedReport.radarItems : parsedText.radarItems;
  const displayReport = msg.report ? parsedReport.text : '';
  const displayText = msg.text ? parsedText.text : '';

  const renderRadar = () => {
    if (!radarData || radarData.length === 0) return null;
    return (
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {radarData.map((item, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: isDarkMode ? '#1f1f1f' : '#fff',
            padding: '6px 12px', borderRadius: 20,
            border: isDarkMode ? '1px solid #333' : '1px solid #e8e8e8',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}>
            <div className={item.status === 'yellow' ? 'radar-pulse' : ''} style={{
              width: 12, height: 12, borderRadius: '50%',
              background: item.status === 'green' ? '#52c41a' : item.status === 'yellow' ? '#faad14' : '#ff4d4f',
              boxShadow: `0 0 6px ${item.status === 'green' ? '#52c41a' : item.status === 'yellow' ? '#faad14' : '#ff4d4f'}`
            }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e5e7eb' : '#374151' }}>{item.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const customRenderers = {
    a: ({ node, href, children, ...props }) => {
      if (href?.startsWith('evidence:')) {
        const evidenceText = decodeURIComponent(href.replace('evidence:', '')).replace(/^"|"$/g, '');
        return (
          <Popover
            content={<div style={{ maxWidth: 300, fontSize: 13 }}>{evidenceText}</div>}
            title="📄 循证：原始依据"
            trigger="hover"
          >
            <span
              style={{ color: '#1677ff', cursor: 'pointer', borderBottom: '1px dashed #1677ff' }}
              onClick={() => onEvidenceNavigate?.(evidenceText)}
            >
              {children} <SearchOutlined />
            </span>
          </Popover>
        );
      }
      if (href?.startsWith('remediate:')) {
        const suggestion = decodeURIComponent(href.replace('remediate:', '')).replace(/^"|"$/g, '');
        return (
          <div style={{ marginTop: 8, display: 'inline-block' }}>
            <Button type="primary" size="small" icon={<FileTextOutlined />} onClick={() => onGenerateTemplate?.(suggestion)}>
              {children}
            </Button>
          </div>
        );
      }
      return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
      <div style={{ marginRight: 10, flexShrink: 0, marginTop: 0 }}>
        <ComplianceAiPulse active={msg.isLoading} isDarkMode={isDarkMode} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {showPanel && <SkillPanel steps={msg.steps} isDarkMode={isDarkMode} />}

        {/* Loading state — no steps yet */}
        {msg.isLoading && !hasSteps && (
          <Space style={{ marginBottom: 10 }}>
            <Spin size="small" />
            <Text type="secondary" style={{ fontSize: 13 }}>Agent 启动中，正在准备审核流程…</Text>
          </Space>
        )}

        {/* Thinking process — collapsible */}
        {msg.thinking && (
          <Collapse
            size="small"
            style={{ marginBottom: 10, border }}
            items={[{
              key: '1',
              label: <span style={{ fontSize: 12, color: tertiaryColor }}>推理过程（可展开查看）</span>,
              children: (
                <div style={{
                  fontSize: 12, color: secondaryColor, whiteSpace: 'pre-wrap',
                  maxHeight: 220, overflowY: 'auto', fontFamily: 'monospace',
                }}>
                  {msg.thinking}
                </div>
              ),
            }]}
          />
        )}

        {/* Error */}
        {msg.isError && <Text type="danger">{msg.text}</Text>}

        {/* Final report */}
        {!msg.isError && msg.report && (
          <div style={{
            background: isDarkMode ? '#0d1726' : 'linear-gradient(180deg, #fcfdff, #f9fbff)',
            border: `1px solid ${isDarkMode ? '#314156' : 'rgba(15,23,42,0.08)'}`,
            borderRadius: 12, padding: '16px 18px',
            boxShadow: isDarkMode ? 'none' : '0 10px 24px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.82)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
              <Text strong style={{ color: emphasisColor }}>合规审核报告</Text>
              {auditDoc && (
                <Button
                  size="small"
                  icon={<AimOutlined />}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    const issues = parseIssuesFromReport(msg.report);
                    onLocateIssue?.(issues, auditDoc);
                  }}
                >
                  📍 定位修改
                </Button>
              )}
            </div>
            {renderRadar()}
            <div className={`markdown-content ${isDarkMode ? 'markdown-dark' : ''}`} style={{ fontSize: 14, lineHeight: 1.8 }}>
              <StructuredAuditReport text={displayReport} isDarkMode={isDarkMode} customRenderers={customRenderers} />
            </div>
          </div>
        )}

        {/* Streaming text before report */}
        {!msg.isError && !msg.report && msg.text && (
          <div className={`markdown-content ${isDarkMode ? 'markdown-dark' : ''}`} style={{ fontSize: 14, lineHeight: 1.8, color: emphasisColor }}>
            {renderRadar()}
            <span className={isStreaming ? 'typing-cursor' : ''}>
              <StructuredAuditReport text={displayText} isDarkMode={isDarkMode} customRenderers={customRenderers} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComplianceAudit({ isDarkMode = true, currentUser, onNavigate }) {
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [senderValue, setSenderValue] = useState('');
  const [matterType, setMatterType] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsedFile, setParsedFile] = useState(null);
  const [typeWarning, setTypeWarning] = useState(false);
  const [customRules, setCustomRules] = useState([]);
  const [selectedCustomRuleIds, setSelectedCustomRuleIds] = useState([]);
  const [rulesGallery, setRulesGallery] = useState([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [ruleUploadLoading, setRuleUploadLoading] = useState(false);
  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const customRuleInputRef = useRef(null);

  // Audit document for 定位修改
  const [auditDoc, setAuditDoc] = useState(null); // { savedName, name, paragraphs: [] }
  const auditDocRef = useRef(null);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateContent, setTemplateContent] = useState('');
  const [templateThinking, setTemplateThinking] = useState('');
  const [templateSuggestion, setTemplateSuggestion] = useState('');
  const templateAbortRef = useRef(null);

  const loadConfigAssets = async () => {
    setConfigLoading(true);
    try {
      const [rulesData, galleryData] = await Promise.all([
        authFetchJson('/api/custom_rules'),
        authFetchJson('/api/rules_gallery'),
      ]);
      setCustomRules(rulesData.files || []);
      setRulesGallery(galleryData.items || []);
    } catch (err) {
      antMessage.error(`审查配置加载失败：${err.message}`);
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    loadConfigAssets();
  }, []);

  const availableCustomRules = customRules.filter(item => (
    !matterType || item.matterType === matterType || item.matterType === '通用' || !item.matterType
  ));

  const visibleRulesGallery = rulesGallery.filter(item => (
    !matterType || item.matterType === matterType || item.matterType === '总览'
  ));

  useEffect(() => {
    setSelectedCustomRuleIds(prev => {
      const next = prev.filter(id => (
        customRules.some(item => item.id === id && (
          !matterType || item.matterType === matterType || item.matterType === '通用' || !item.matterType
        ))
      ));
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [matterType, customRules]);

  const handleGenerateTemplate = async (suggestion, contextText) => {
    setTemplateSuggestion(suggestion);
    setTemplateContent('');
    setTemplateThinking('');
    setTemplateModalOpen(true);
    setTemplateLoading(true);

    templateAbortRef.current = new AbortController();

    try {
      const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const prompt = `在此次合规审核中，发现需要整改：【${suggestion}】。\n\n【项目原始材料片段供参考】：\n${contextText ? contextText.substring(0, 3000) : '未提供'}\n\n请严格结合上述原始材料中的真实内容（例如真实的“项目名称”、“融资金额”、“建设内容”、“招标单位”等），为其起草一段专业的国企公文补正说明或整改通知单。\n\n【严格要求】：\n1. 严禁使用“[项目名称]”等占位符，必须根据材料代入真实数据。\n2. 落款日期必须使用今天的真实日期：“${today}”，严禁使用“202X年X月X日”。\n\n直接输出拟办意见或请示文本，不要有任何客套废话。`;
      const resp = await authFetch('/api/generate_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
        signal: templateAbortRef.current.signal,
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';
      let fullThinking = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const data = JSON.parse(raw);
              if (data.type === 'thinking_chunk' && data.content) {
                fullThinking += data.content;
                setTemplateThinking(fullThinking);
              } else if (data.type === 'llm_chunk' && data.content) {
                fullText += data.content;
                setTemplateContent(fullText);
              }
            } catch (_) { }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        antMessage.error(`模板生成失败: ${e.message}`);
      }
    } finally {
      setTemplateLoading(false);
      templateAbortRef.current = null;
    }
  };

  const handleCloseTemplateModal = () => {
    if (templateLoading && templateAbortRef.current) {
      templateAbortRef.current.abort();
    }
    setTemplateModalOpen(false);
  };

  const handleCustomRuleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setRuleUploadLoading(true);
    try {
      const uploadedRules = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const data = await authFetchJson(
          `/api/custom_rules/upload?matter_type=${encodeURIComponent(matterType || '通用')}`,
          { method: 'POST', body: fd },
        );
        uploadedRules.push(data.file);
      }
      setCustomRules(prev => {
        const next = [...prev];
        for (const rule of [...uploadedRules].reverse()) {
          next.unshift(rule);
        }
        return next.filter((item, index, arr) => arr.findIndex(candidate => candidate.id === item.id) === index);
      });
      setSelectedCustomRuleIds(prev => Array.from(new Set([...uploadedRules.map(item => item.id), ...prev])));
      antMessage.success(`已纳入 ${uploadedRules.length} 份三重一大规则 PDF`);
    } catch (err) {
      antMessage.error(`制度上传失败：${err.message}`);
    } finally {
      setRuleUploadLoading(false);
      e.target.value = '';
    }
  };

  const handleDeleteCustomRule = async (ruleId) => {
    try {
      await authFetchJson(`/api/custom_rules/${ruleId}`, { method: 'DELETE' });
      setCustomRules(prev => prev.filter(item => item.id !== ruleId));
      setSelectedCustomRuleIds(prev => prev.filter(id => id !== ruleId));
      antMessage.success('制度文件已移除');
    } catch (err) {
      antMessage.error(`移除失败：${err.message}`);
    }
  };

  const parseFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setParsedFile(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      let res;
      try {
        res = await authFetch('/parse_file', { method: 'POST', body: fd });
      } catch {
        throw new Error('无法连接到后端服务，请确认后端已启动（python backend.py）');
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const e = await res.json(); detail = e.detail || detail; } catch { }
        throw new Error(detail);
      }
      const data = await res.json();
      setSenderValue(data.text);
      setParsedFile({ name: data.filename, chars: data.char_count });
      antMessage.success(`📄 ${data.filename} 解析完成，共 ${data.char_count.toLocaleString()} 字符`);
    } catch (err) {
      antMessage.error(`文件解析失败：${err.message}`);
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  // Upload .docx as audit attachment (for 定位修改) — also saves bookmarks
  const handleAuditDocChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['docx'].includes(ext)) {
      antMessage.warning('定位修改仅支持 .docx 文件');
      e.target.value = '';
      return;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/doc/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        // Fetch the paragraph map
        let paragraphs = [];
        try {
          const metaRes = await authFetch(`/api/doc/extract_bookmarks/${encodeURIComponent(data.saved_as)}`);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            paragraphs = meta.paragraphs || [];
          }
        } catch (_) { /* non-critical */ }
        setAuditDoc({ savedName: data.saved_as, name: data.filename, paragraphs });
        antMessage.success({
          content: `📎 定位文档已上传：${data.filename}（${paragraphs.length} 个段落已建索引）`,
          duration: 4,
        });
      }
    } catch (err) {
      antMessage.error(`上传定位文档失败：${err.message}`);
    }
    e.target.value = '';
  };
  const handleLocateIssue = (issues, auditDoc) => {
    if (!auditDoc) {
      antMessage.warning('请先上传「定位附件」（.docx）再使用定位修改功能');
      return;
    }
    const matched = matchIssuesToParagraphs(issues, auditDoc.paragraphs || []);
    setEditorSavedName(auditDoc.savedName);
    setEditorIssues(matched);
    setEditorOpen(true);
  };

  // Match evidence text to a paragraph and navigate to it
  const findParagraphByText = (evidenceText, paragraphs) => {
    if (!paragraphs || !paragraphs.length || !evidenceText) return null;
    const evidenceWords = evidenceText.replace(/[^\w一-龥]/g, ' ').split(/\s+/).filter(Boolean);
    let bestIdx = -1, bestScore = 0;
    paragraphs.forEach((p, pi) => {
      const pWords = (p.text_preview || '').replace(/[^\w一-龥]/g, ' ').split(/\s+/).filter(Boolean);
      const overlap = evidenceWords.filter(w => pWords.some(pw => pw.includes(w) || w.includes(pw))).length;
      const score = overlap / Math.max(evidenceWords.length, 1);
      if (score > bestScore && score > 0.15) { bestScore = score; bestIdx = pi; }
    });
    return bestIdx >= 0 ? paragraphs[bestIdx] : null;
  };

  const handleEvidenceNavigate = (evidenceText) => {
    if (!auditDoc) {
      antMessage.warning('请先上传「定位附件」（.docx）后再点击证据链接进行导航');
      return;
    }
    const matched = findParagraphByText(evidenceText, auditDoc.paragraphs || []);
    if (!matched) {
      antMessage.warning('未能在文档中找到匹配的证据段落');
      return;
    }
    setEditorSavedName(auditDoc.savedName);
    setEditorTargetPara({
      paraIndex: matched.para_index,
      text: evidenceText,
      action: 'locate',
      ts: Date.now(),
    });
    setEditorIssues([]);
    setEditorOpen(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const doAudit = async (text, type) => {
    if (!type || !text?.trim()) return;

    setTypeWarning(false);
    const uid = `u_${Date.now()}`;
    const aid = `a_${Date.now() + 1}`;
    const stepTimers = {};

    setTurns(prev => [
      ...prev,
      { id: uid, role: 'user', matterType: type, text },
      { id: aid, role: 'assistant', steps: [], thinking: '', text: '', report: '', isError: false, isLoading: true },
    ]);
    setSenderValue('');
    setParsedFile(null);
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const resp = await authFetch('/api/audit_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matter_type: type,
          material_text: text,
          custom_rule_ids: selectedCustomRuleIds,
        }),
        signal: abortRef.current.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const data = JSON.parse(raw);
              setTurns(prev => prev.map(m => {
                if (m.id !== aid) return m;

                if (data.type === 'tool_start') {
                  const steps = [...(m.steps || [])];
                  if (!steps.find(s => s.tool === data.tool)) {
                    steps.push({ tool: data.tool, running: true, done: false, startTs: Date.now() });
                    stepTimers[data.tool] = Date.now();
                  } else {
                    // mark as running if already exists
                    steps.forEach(s => { if (s.tool === data.tool) { s.running = true; s.startTs = Date.now(); } });
                    stepTimers[data.tool] = Date.now();
                  }
                  return { ...m, steps, isLoading: false };
                }

                if (data.type === 'tool_end') {
                  const now = Date.now();
                  const steps = (m.steps || []).map(s => {
                    if (s.tool !== data.tool) return s;
                    const durationMs = stepTimers[data.tool] ? now - stepTimers[data.tool] : null;
                    return { ...s, running: false, done: true, durationMs, result: data.result };
                  });
                  return { ...m, steps };
                }

                if (data.type === 'thinking_chunk') {
                  let chunk = data.content
                    .replace(/Thinking Process:/g, '思考过程：')
                    .replace(/Thought:/g, '思考过程：')
                    .replace(/\*\*Analyze the Request:\*\*/g, '**分析请求：**')
                    .replace(/\*\*Role:\*\*/g, '**角色：**')
                    .replace(/\*\*Language:\*\*/g, '**语言约束：**')
                    .replace(/\*\*Tools:\*\*/g, '**可用工具：**')
                    .replace(/\*\*Process:\*\*/g, '**处理流程：**')
                    .replace(/\*\*Format:\*\*/g, '**输出格式：**')
                    .replace(/\*\*Constraint:\*\*/g, '**约束条件：**')
                    .replace(/\*\*Input Material:\*\*/g, '**输入材料：**')
                    .replace(/\*\*Audit Matter:\*\*/g, '**审核事项：**');
                  return { ...m, thinking: (m.thinking || '') + chunk };
                }
                if (data.type === 'llm_chunk') {
                  let chunk = data.content
                    .replace(/Thought:/g, '【思考】')
                    .replace(/Action:/g, '【调用工具】')
                    .replace(/Action Input:/g, '【工具输入】')
                    .replace(/Observation:/g, '【观察结果】')
                    .replace(/Final Answer:/g, '【最终回答】');
                  return { ...m, text: (m.text || '') + chunk };
                }

                if (data.type === 'report') {
                  const finalSteps = (m.steps || []).map(s => ({ ...s, running: false, done: true }));
                  return { ...m, report: data.content, isLoading: false, steps: finalSteps };
                }

                if (data.type === 'error') return { ...m, text: data.detail, isError: true, isLoading: false };
                if (data.type === 'queue_warning') return { ...m, text: (m.text || '') + `\n\n⏳ ${data.content}\n\n` };
                if (data.type === 'done') return { ...m, isLoading: false };
                return m;
              }));

              if (data.type === 'report') {
                antMessage.success({ content: '✅ 合规审核报告已生成', duration: 3 });
              }
              if (data.type === 'done') break;
            } catch (_) { }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setTurns(prev => prev.map(m =>
          m.id === aid && m.isLoading
            ? { ...m, text: `审核失败：${err.message}`, isError: true, isLoading: false }
            : m
        ));
      } else {
        setTurns(prev => prev.map(m =>
          m.id === aid ? { ...m, isLoading: false } : m
        ));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setTurns(prev => prev.map(m => {
        if (m.id !== aid) return m;
        const cleanSteps = (m.steps || []).map(s =>
          s.running ? { ...s, running: false, done: true } : s
        );
        return { ...m, isLoading: false, steps: cleanSteps };
      }));
    }
  };

  const handleStop = () => abortRef.current?.abort();
  const handleClear = () => { setTurns([]); setSenderValue(''); setParsedFile(null); setTypeWarning(false); };
  const handleSend = (text) => {
    if (!text?.trim()) return;
    if (!matterType) { setTypeWarning(true); return; }
    setTypeWarning(false);
    doAudit(text, matterType);
  };
  const handlePromptClick = ({ data }) => {
    setMatterType(data.key);
    setTypeWarning(false);
    if (!senderValue) {
      setSenderValue(PLACEHOLDER_MAP[data.key] || '');
    }
  };

  const isEmpty = turns.length === 0;
  const charCount = senderValue.length;
  const charOver = charCount > 80000;
  const bg = isDarkMode ? '#111827' : '#fff';
  const cardBg = isDarkMode ? '#1f2937' : 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(250,250,250,0.92))';
  const border = isDarkMode ? '1px solid #374151' : '1px solid rgba(15,23,42,0.06)';
  const textPrimary = isDarkMode ? '#f8fafc' : '#0f172a';
  const textSecondary = isDarkMode ? '#8fa0b7' : '#98a2b3';
  const textMuted = isDarkMode ? '#7b8ba1' : '#b0bac7';
  const selectedRuleCount = selectedCustomRuleIds.length;
  const selectedRuleChars = availableCustomRules
    .filter(item => selectedCustomRuleIds.includes(item.id))
    .reduce((total, item) => total + (item.charCount || 0), 0);
  const ruleOptions = availableCustomRules.map(item => ({
    label: `${item.name} · ${item.matterType || '通用'}`,
    value: item.id,
  }));
  const selectedFlow = visibleRulesGallery.find(item => item.matterType === matterType)
    || visibleRulesGallery.find(item => item.matterType === '总览')
    || null;
  const hasMaterial = Boolean(senderValue?.trim() || parsedFile);
  const hasMatterType = Boolean(matterType);
  const hasRulesReady = selectedRuleCount > 0;
  const auditCanStart = hasMatterType && hasMaterial && !loading;
  const resultReady = turns.length > 0;
  const currentStepLabel = !hasMatterType
    ? '先选择事项类型'
    : !hasMaterial
      ? '继续准备材料'
      : '可以发起审查';
  const panelStyle = {
    background: cardBg,
    border,
    borderRadius: 20,
    boxShadow: isDarkMode ? 'none' : '0 16px 38px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.84)',
  };
  const guideTone = !hasMatterType ? STATUS_TONES.blue : !hasMaterial ? STATUS_TONES.orange : STATUS_TONES.green;

  return (
    <div style={{ height: '100%', background: isDarkMode ? bg : 'linear-gradient(180deg, #f7f9fc 0%, #edf2f7 100%)', padding: 20, boxSizing: 'border-box' }}>
      <input
        ref={customRuleInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleCustomRuleUpload}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        style={{ display: 'none' }}
        onChange={parseFile}
      />
      <input
        ref={auditDocRef}
        type="file"
        accept=".docx"
        style={{ display: 'none' }}
        onChange={handleAuditDocChange}
      />

      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 12 }}>
        <div style={{ display: 'none' }}>
          <div style={{ ...panelStyle, padding: 18, background: isDarkMode ? 'linear-gradient(135deg,#111827,#172554)' : 'linear-gradient(135deg,#ffffff 0%, #f7fbff 46%, #edf5ff 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 46, height: 46, borderRadius: 16, background: 'linear-gradient(135deg,#3370ff,#5b8cff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileProtectOutlined style={{ fontSize: 20, color: '#fff' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: textPrimary }}>三重一大审查台</div>
                  <Tag color="gold" style={{ margin: 0 }}>专家模式</Tag>
                  {onNavigate && (
                    <Button size="small" type="primary" ghost onClick={() => onNavigate('compliance_focus')}>
                      返回快速审查
                    </Button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: textSecondary, marginTop: 4 }}>
                  面向合规、法务和演示人员，集中处理制度装配、定位附件、材料提交和审查结果。
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <Tag color={matterType ? 'blue' : 'default'} style={{ margin: 0 }}>{matterType || '未选择事项'}</Tag>
              <Tag color="green" style={{ margin: 0 }}>5 步审查链路</Tag>
              {currentUser && <Tag color="geekblue" style={{ margin: 0 }}>{currentUser.name} · {currentUser.dept}</Tag>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 14 }}>
              {[
                { idx: '1', label: '选事项', desc: '确定审查口径', done: hasMatterType, current: !hasMatterType, color: 'blue' },
                { idx: '2', label: '备材料', desc: '粘贴或上传正文', done: hasMaterial, current: hasMatterType && !hasMaterial, color: 'orange' },
                { idx: '3', label: '看结果', desc: '生成报告与定位', done: resultReady, current: hasMatterType && hasMaterial && !resultReady, color: 'green' },
              ].map(item => (
                (() => {
                  const tone = item.done
                    ? STATUS_TONES[item.color]
                    : item.current
                      ? STATUS_TONES.blue
                      : STATUS_TONES.gray;
                  return (
                <div
                  key={item.idx}
                  style={{
                    padding: '10px 10px 9px',
                    borderRadius: 14,
                    background: item.done
                      ? (isDarkMode ? 'rgba(15,23,42,0.72)' : tone.soft)
                      : item.current
                        ? (isDarkMode ? 'rgba(20,86,204,0.18)' : '#eef4ff')
                        : (isDarkMode ? 'rgba(15,23,42,0.42)' : 'rgba(255,255,255,0.82)'),
                    border: item.done || item.current
                      ? `1px solid ${tone.border}`
                      : (isDarkMode ? '1px solid rgba(148,163,184,0.12)' : '1px solid rgba(15,23,42,0.06)'),
                    boxShadow: !isDarkMode && !item.done && !item.current ? 'inset 0 1px 0 rgba(255,255,255,0.85)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 11, color: item.done || item.current ? tone.text : textMuted }}>
                    步骤 {item.idx}
                  </div>
                  <div style={{ marginTop: 3, fontWeight: 700, color: item.done || item.current ? (isDarkMode ? '#f8fafc' : '#0f172a') : textPrimary }}>{item.label}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: textSecondary }}>{item.desc}</div>
                </div>
                  );
                })()
              ))}
            </div>
          </div>

          <div style={{ ...panelStyle, padding: 16 }}>
            <SectionTitle
              step="1"
              title="选择事项并装配制度"
              desc="先确定事项类别，再决定是否附加企业自定义制度。没有自定义制度也可以直接用系统规则发起审查。"
              isDarkMode={isDarkMode}
              extra={turns.length > 0 && !loading ? (
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={handleClear}>
                  清空
                </Button>
              ) : null}
            />

            <Text type="secondary" style={{ fontSize: 12 }}>事项类型</Text>
            <Select
              placeholder="选择事项类型"
              value={matterType}
              onChange={value => { setMatterType(value); setTypeWarning(false); }}
              style={{ width: '100%', marginTop: 8 }}
              options={MATTER_TYPES.map(t => ({ label: t, value: t }))}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 14 }}>
              <div style={{ padding: 12, borderRadius: 14, background: isDarkMode ? '#0f172a' : '#f8fafc', border, boxShadow: !isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.84)' : 'none' }}>
                <div style={{ fontSize: 12, color: textSecondary }}>适用制度</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{availableCustomRules.length}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: isDarkMode ? '#0f172a' : '#f8fafc', border, boxShadow: !isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.84)' : 'none' }}>
                <div style={{ fontSize: 12, color: textSecondary }}>已选制度</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{selectedRuleCount}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: isDarkMode ? '#0f172a' : '#f8fafc', border, boxShadow: !isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.84)' : 'none' }}>
                <div style={{ fontSize: 12, color: textSecondary }}>制度字数</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{selectedRuleChars.toLocaleString()}</div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <Text strong style={{ fontSize: 13 }}>本次审查适用制度</Text>
              <Select
                mode="multiple"
                allowClear
                showSearch
                loading={configLoading}
                optionFilterProp="label"
                value={selectedCustomRuleIds}
                onChange={setSelectedCustomRuleIds}
                placeholder={matterType ? `选择 ${matterType} 的制度文件` : '先选择事项类型或上传通用制度'}
                options={ruleOptions}
                style={{ width: '100%', marginTop: 8 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button icon={<FileTextOutlined />} onClick={() => setRulesDrawerOpen(true)} style={{ flex: 1 }}>
                查看流程依据
              </Button>
              <Button
                type="primary"
                ghost
                icon={ruleUploadLoading ? <LoadingOutlined /> : <UploadOutlined />}
                loading={ruleUploadLoading}
                onClick={() => customRuleInputRef.current?.click()}
                style={{ flex: 1 }}
              >
                上传规则 PDF
              </Button>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {availableCustomRules.slice(0, 4).map(rule => {
                const selected = selectedCustomRuleIds.includes(rule.id);
                return (
                  <div key={rule.id} style={{ padding: 12, borderRadius: 14, background: selected ? (isDarkMode ? 'rgba(51,112,255,0.14)' : '#eef4ff') : (isDarkMode ? '#0f172a' : 'rgba(255,255,255,0.82)'), border: selected ? '1px solid rgba(51,112,255,0.38)' : border, boxShadow: !isDarkMode && !selected ? 'inset 0 1px 0 rgba(255,255,255,0.84)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, lineHeight: 1.5 }}>{rule.name}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          <Tag color={rule.matterType === '通用' ? 'default' : 'blue'} style={{ margin: 0 }}>{rule.matterType || '通用'}</Tag>
                          <Tag color="cyan" style={{ margin: 0 }}>{(rule.charCount || 0).toLocaleString()} 字</Tag>
                        </div>
                      </div>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteCustomRule(rule.id)} />
                    </div>
                  </div>
                );
              })}
              {availableCustomRules.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={matterType ? `当前还没有 ${matterType} 对应的规则 PDF` : '当前还没有可用的规则 PDF'} />
              )}
            </div>
          </div>

          <div style={{ ...panelStyle, padding: 16 }}>
            <SectionTitle
              step="2"
              title="准备审查材料"
              desc="正文材料是必需项。你可以直接粘贴到右侧输入区，也可以先在这里上传文件自动解析。定位附件仅用于审查后回到原文修改。"
              isDarkMode={isDarkMode}
            />
            <Space wrap>
              <Button
                icon={parsing ? <LoadingOutlined /> : <UploadOutlined />}
                onClick={() => fileInputRef.current?.click()}
                loading={parsing}
                disabled={loading}
              >
                {parsing ? '解析中…' : '上传材料解析'}
              </Button>
              <Button
                icon={<PaperClipOutlined />}
                onClick={() => auditDocRef.current?.click()}
                disabled={loading}
                type={auditDoc ? 'primary' : 'default'}
              >
                {auditDoc ? `定位文档：${auditDoc.name}` : '附加定位文档'}
              </Button>
            </Space>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {parsedFile && <Tag color="green" style={{ margin: 0, width: 'fit-content' }}>📄 {parsedFile.name} · {parsedFile.chars.toLocaleString()} 字</Tag>}
              {auditDoc && <Tag color="blue" style={{ margin: 0, width: 'fit-content' }}>{auditDoc.paragraphs?.length || 0} 段落已索引</Tag>}
            </div>
          </div>

          {selectedFlow && (
            <div style={{ ...panelStyle, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Text strong style={{ fontSize: 15 }}>{selectedFlow.title}</Text>
                <Tag color={selectedFlow.matterType === '总览' ? 'default' : 'blue'} style={{ margin: 0 }}>{selectedFlow.matterType}</Tag>
              </div>
              <Text type="secondary">{selectedFlow.summary}</Text>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {selectedFlow.steps?.map(step => (
                  <Tag key={step} color="processing" style={{ margin: 0 }}>{step}</Tag>
                ))}
              </div>
            </div>
          )}

          {(matterType === '重大项目安排' || matterType === '大额度资金运作') && (
            <div style={{ ...panelStyle, padding: 16, background: matterType === '重大项目安排' ? (isDarkMode ? '#172554' : '#eff6ff') : (isDarkMode ? '#3b1f14' : '#fff7ed') }}>
              <Text strong style={{ display: 'block', marginBottom: 6, color: matterType === '重大项目安排' ? '#1677ff' : '#ea580c' }}>
                {matterType === '重大项目安排' ? '项目联动提醒' : '资金风险提醒'}
              </Text>
              <Text style={{ fontSize: 12, color: textSecondary }}>
                {matterType === '重大项目安排'
                  ? '优先核对项目编码、前置论证、招采流转和专家意见，避免材料完整但程序链断裂。'
                  : '重点核对预算来源、集体研究、公示与支付闭环，避免触碰资金使用和隐性债务红线。'}
              </Text>
            </div>
          )}

          {isEmpty && (
            <Prompts
              title="快速选择事项类型"
              items={QUICK_PROMPTS}
              onItemClick={handlePromptClick}
              wrap
            />
          )}
        </div>

        <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', gap: 12 }}>
          <div style={{ ...panelStyle, padding: 18 }}>
            <SectionTitle
              step="1"
              title="配置审查任务"
              desc="先选事项类型，按需选择制度文件，再上传或粘贴材料。完成后点击开始审查。"
              isDarkMode={isDarkMode}
              extra={(
                <Button
                  type="primary"
                  size="large"
                  onClick={() => handleSend(senderValue)}
                  disabled={!auditCanStart}
                >
                  开始智能审查
                </Button>
              )}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr) auto auto', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <Select
                placeholder="选择事项类型"
                value={matterType}
                onChange={value => { setMatterType(value); setTypeWarning(false); }}
                options={MATTER_TYPES.map(t => ({ label: t, value: t }))}
              />
              <Select
                mode="multiple"
                allowClear
                showSearch
                loading={configLoading}
                optionFilterProp="label"
                value={selectedCustomRuleIds}
                onChange={setSelectedCustomRuleIds}
                placeholder="选择适用制度，可不选"
                options={ruleOptions}
              />
              <Button
                icon={parsing ? <LoadingOutlined /> : <UploadOutlined />}
                onClick={() => fileInputRef.current?.click()}
                loading={parsing}
                disabled={loading}
              >
                上传材料
              </Button>
              <Button
                type="primary"
                ghost
                icon={ruleUploadLoading ? <LoadingOutlined /> : <UploadOutlined />}
                loading={ruleUploadLoading}
                onClick={() => customRuleInputRef.current?.click()}
              >
                上传制度
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
              <ReadyCard
                label="事项类型"
                value={matterType || '未选择'}
                hint="先在左侧选择本次审查属于哪一类事项。"
                active={hasMatterType}
                tone="blue"
                isDarkMode={isDarkMode}
              />
              <ReadyCard
                label="制度装配"
                value={hasRulesReady ? `${selectedRuleCount} 份` : '可选'}
                hint="可附加自定义制度，不选也能按系统规则审查。"
                active={hasRulesReady}
                tone="purple"
                isDarkMode={isDarkMode}
              />
              <ReadyCard
                label="材料正文"
                value={hasMaterial ? `${charCount.toLocaleString()} 字` : '未准备'}
                hint="正文材料是必需项，可粘贴也可先上传解析。"
                active={hasMaterial}
                tone="green"
                isDarkMode={isDarkMode}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 14 }}>
              <div
                style={{
                  fontSize: 13,
                  color: textSecondary,
                  padding: '8px 12px',
                  borderRadius: 999,
                background: isDarkMode ? 'rgba(15,23,42,0.42)' : guideTone.soft,
                border: `1px solid ${guideTone.border}`,
                boxShadow: !isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.72)' : 'none',
              }}
            >
                当前引导：<span style={{ color: textPrimary, fontWeight: 700 }}>{currentStepLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {matterType && <Tag color="blue" style={{ margin: 0 }}>{matterType}</Tag>}
                <Tag color="default" style={{ margin: 0 }}>{charCount.toLocaleString()} / 80,000</Tag>
                {loading && <Tag color="processing" style={{ margin: 0 }}>审查进行中</Tag>}
              </div>
            </div>
            {typeWarning && (
              <Alert
                type="warning"
                showIcon
                message="请先完成第 1 步事项选择，再发起审查。"
                style={{ marginTop: 14, borderRadius: 12 }}
                closable
                onClose={() => setTypeWarning(false)}
              />
            )}
          </div>

          <div style={{ ...panelStyle, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Text strong style={{ fontSize: 16 }}>审查结果</Text>
                <div style={{ fontSize: 12, color: textSecondary, marginTop: 2 }}>
                  审查过程、结论报告、问题依据和整改建议会在这里集中展示。
                </div>
              </div>
              {!loading && turns.length > 0 && <Tag color="success" style={{ margin: 0 }}>结果已生成</Tag>}
              {loading && (
                <Button danger type="dashed" icon={<StopOutlined />} onClick={handleStop} size="small">
                  停止生成
                </Button>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 8px' }}>
              {turns.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty description="完成上方配置后，在底部粘贴材料并开始审查" />
                </div>
              ) : (
                turns.map((msg, index) => (
                  <AuditTurn
                    key={msg.id}
                    msg={msg}
                    isDarkMode={isDarkMode}
                    onGenerateTemplate={(suggestion) => handleGenerateTemplate(suggestion, turns[index - 1]?.text)}
                    onLocateIssue={handleLocateIssue}
                    onEvidenceNavigate={handleEvidenceNavigate}
                    auditDoc={auditDoc}
                  />
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div style={{ ...panelStyle, padding: 16 }}>
            <Sender
              value={senderValue}
              onChange={setSenderValue}
              onSubmit={handleSend}
              loading={loading}
              disabled={loading}
              placeholder={matterType ? `粘贴【${matterType}】材料正文，回车提交或点击上方开始审查` : '请先选择事项类型'}
              style={{ borderRadius: 14, minHeight: 72 }}
            />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                支持 PDF / Word(.docx) / TXT，超长材料建议先通过左侧“上传材料解析”导入。
              </Text>
              <Text style={{ fontSize: 12, color: charOver ? '#ff4d4f' : textMuted }}>
                当前文本 {charCount.toLocaleString()} 字
              </Text>
            </div>
          </div>
        </div>
      </div>

      {/* Template Generation Modal */}
      <Modal
        title={<span>✨ AI 倍增：整改告知单及补正文本自动生成</span>}
        open={templateModalOpen}
        onCancel={handleCloseTemplateModal}
        footer={[
          <Button key="close" onClick={handleCloseTemplateModal}>
            {templateLoading ? '取消生成' : '关闭'}
          </Button>,
          <Button key="copy" type="primary" disabled={templateLoading || !templateContent} onClick={() => {
            navigator.clipboard.writeText(templateContent);
            antMessage.success('已复制整改文本到剪贴板！');
          }}>
            一键复制文本
          </Button>,
          <Button key="download" type="primary" disabled={templateLoading || !templateContent} onClick={() => {
            const blob = new Blob([templateContent], { type: 'application/msword' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `合规整改告知单_${new Date().getTime()}.doc`;
            a.click();
            URL.revokeObjectURL(url);
            antMessage.success('整改告知单 (Word) 下载成功');
          }}>
            下载整改单汇编 (Word)
          </Button>
        ]}
        width={750}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">基于审核发现的违规点：<Text strong type="danger">{templateSuggestion}</Text></Text>
        </div>
        <div style={{ minHeight: 200, padding: 20, background: isDarkMode ? '#141414' : '#f5f5f5', borderRadius: 8, marginTop: 16 }}>
          {templateLoading && !templateContent && !templateThinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#1677ff', fontSize: 15, padding: 20 }}>
              <Spin size="default" /> 正在深度结合《三重一大实施办法》为您起草包含具体补正说明的国企规范函件...
            </div>
          )}
          {templateThinking && !templateContent && (
            <div style={{ color: '#8c8c8c', fontSize: 13, padding: '10px 0', borderBottom: isDarkMode ? '1px dashed #333' : '1px dashed #e8e8e8', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#1677ff' }}>
                <LoadingOutlined /> <span>AI 专家正在深度阅读卷宗材料并构思公文要素...</span>
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto', fontStyle: 'italic', opacity: 0.8, whiteSpace: 'pre-wrap', paddingRight: 8 }}>
                {templateThinking}
              </div>
            </div>
          )}
          <div className={`markdown-content ${isDarkMode ? 'markdown-dark' : ''}`} style={{ fontSize: 14, lineHeight: 1.8 }}>
            <span className={templateLoading && templateContent ? 'typing-cursor' : ''}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(value) => value}>{templateContent}</ReactMarkdown>
            </span>
          </div>
        </div>
      </Modal>

      <style>{`
        .compliance-ai-core {
          width: 46px;
          height: 46px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          isolation: isolate;
        }

        .compliance-ai-ring {
          position: absolute;
          inset: 3px;
          border-radius: 50%;
          border: 1px solid rgba(22, 119, 255, 0.28);
          animation: compliance-ai-pulse 2.8s ease-in-out infinite;
        }

        .compliance-ai-ring-two {
          inset: -2px;
          animation-delay: 520ms;
          opacity: 0.56;
        }

        .compliance-ai-disc {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 15px;
          background:
            radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.14) 24%, transparent 35%),
            conic-gradient(from 120deg, #1677ff, #12b3a8, #7c3aed, #1677ff);
          box-shadow: 0 12px 24px rgba(22,119,255,0.22);
          animation: compliance-ai-spin 4.8s linear infinite;
          z-index: 2;
        }

        .compliance-ai-wave {
          position: absolute;
          left: 50%;
          bottom: -3px;
          transform: translateX(-50%);
          display: flex;
          gap: 3px;
          z-index: 3;
        }

        .compliance-ai-wave i {
          width: 3px;
          height: 7px;
          border-radius: 999px;
          opacity: 0.62;
          animation: compliance-ai-wave 960ms ease-in-out infinite;
        }

        .compliance-ai-core:not(.is-active) .compliance-ai-wave i {
          animation-duration: 1.8s;
          opacity: 0.38;
        }

        .structured-audit-report p {
          margin: 0 0 8px;
        }

        .structured-audit-report ul,
        .structured-audit-report ol {
          margin: 0 0 8px;
          padding-left: 18px;
        }

        .structured-audit-report table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0;
          font-size: 13px;
        }

        .structured-audit-report th,
        .structured-audit-report td {
          border: 1px solid ${isDarkMode ? '#263247' : '#e6ebf2'};
          padding: 7px 8px;
          vertical-align: top;
        }

        .structured-audit-report th {
          background: ${isDarkMode ? '#172033' : '#f8fafc'};
          color: ${isDarkMode ? '#f8fafc' : '#0f172a'};
        }

        @keyframes compliance-ai-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes compliance-ai-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.34; }
          50% { transform: scale(1.12); opacity: 0.86; }
        }

        @keyframes compliance-ai-wave {
          0%, 100% { transform: scaleY(0.55); }
          50% { transform: scaleY(1.45); }
        }
      `}</style>

      <Drawer
        title="三重一大制度流程与风险控制"
        open={rulesDrawerOpen}
        onClose={() => setRulesDrawerOpen(false)}
        width={920}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            这里汇总了 `rules/` 目录中的流程图和风控图。默认优先展示当前事项对应流程，同时保留总流程供横向核对。
          </Text>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {visibleRulesGallery.map(item => (
            <div
              key={item.id}
              style={{
                border,
                borderRadius: 16,
                overflow: 'hidden',
                background: isDarkMode ? '#0f172a' : '#fff',
              }}
            >
              <div style={{ padding: '14px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 15 }}>{item.title}</Text>
                  <Tag color={item.matterType === '总览' ? 'default' : 'blue'} style={{ margin: 0 }}>
                    {item.matterType}
                  </Tag>
                </div>
                <Text type="secondary">{item.summary}</Text>
              </div>
              <Image
                src={item.imageUrl}
                alt={item.title}
                preview
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 280,
                  objectFit: 'cover',
                  borderTop: border,
                  borderBottom: border,
                }}
              />
              <div style={{ padding: 14 }}>
                <Text strong style={{ fontSize: 13 }}>关键步骤</Text>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {item.steps?.map(step => (
                    <Tag key={step} color="processing" style={{ margin: 0 }}>
                      {step}
                    </Tag>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
