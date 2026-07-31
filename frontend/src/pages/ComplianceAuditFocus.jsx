import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Image,
  Input,
  Progress,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message as antMessage,
} from 'antd';
import {
  CheckCircleOutlined,
  FileTextOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch, authFetchJson } from '../lib/auth';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const MATTER_TYPES = ['重大决策', '重大项目安排', '重要人事任免', '大额度资金运作'];

const PLACEHOLDER_MAP = {
  '重大决策': '输入会议纪要、议题说明、前置审查材料等正文内容。',
  '重大项目安排': '输入项目背景、可研、预算、专家论证、法审意见等正文内容。',
  '重要人事任免': '输入民主推荐、组织考察、纪检意见、任前公示等正文内容。',
  '大额度资金运作': '输入资金用途、预算来源、集体研究、公示和支付安排等正文内容。',
};

const SKILL_ORDER = [
  { tool: 'extract_rules', title: '提取制度要求' },
  { tool: 'validate_material', title: '核验材料完整性' },
  { tool: 'check_procedure_completeness', title: '检查程序链路' },
  { tool: 'identify_responsibility', title: '识别责任主体' },
  { tool: 'generate_compliance_report', title: '生成审查结论' },
];

const STATUS_TONES = {
  blue: { soft: '#e8f1ff', border: 'rgba(22,119,255,0.22)', text: '#1456cc', solid: '#1677ff' },
  green: { soft: '#edf9f0', border: 'rgba(22,163,74,0.2)', text: '#166534', solid: '#16a34a' },
  orange: { soft: '#fff2e8', border: 'rgba(234,88,12,0.2)', text: '#c2410c', solid: '#ea580c' },
  gray: { soft: '#f8fafc', border: 'rgba(152,162,179,0.18)', text: '#667085', solid: '#98a2b3' },
};

function parseRiskRadar(text) {
  if (!text) return { text: '', radarItems: [] };
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
    radarItems,
  };
}

function inferResultTone(reportText, radarItems) {
  const raw = `${reportText || ''} ${(radarItems || []).map(item => item.status).join(' ')}`;
  if (/高风险|不合规|违规|red/.test(raw)) return 'orange';
  if (/缺失|待补|yellow|中风险/.test(raw)) return 'orange';
  return 'green';
}

function extractHighlights(reportText) {
  if (!reportText) return [];
  const lines = reportText
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
  return lines
    .filter(line => /^([1-9]\.|[-*]|#{1,3}\s)/.test(line))
    .map(line => line.replace(/^#{1,3}\s*/, '').replace(/^[-*]\s*/, '').trim())
    .slice(0, 4);
}

function StepChip({ index, title, state }) {
  const tone = state === 'done'
    ? STATUS_TONES.green
    : state === 'running'
      ? STATUS_TONES.blue
      : STATUS_TONES.gray;
  return (
    <div
      style={{
        padding: '9px 11px',
        borderRadius: 12,
        border: `1px solid ${tone.border}`,
        background: tone.soft,
      }}
    >
      <div style={{ fontSize: 11, color: tone.text }}>步骤 {index + 1}</div>
      <div style={{ marginTop: 3, fontWeight: 700, color: '#0f172a' }}>{title}</div>
      <div style={{ marginTop: 4 }}>
        <Tag color={state === 'done' ? 'success' : state === 'running' ? 'processing' : 'default'} style={{ margin: 0 }}>
          {state === 'done' ? '已完成' : state === 'running' ? '进行中' : '等待'}
        </Tag>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, hint, tone = STATUS_TONES.gray }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 18,
        border: `1px solid ${tone.border}`,
        background: tone.soft,
      }}
    >
      <div style={{ fontSize: 12, color: tone.text }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 28, lineHeight: 1.05, fontWeight: 700, color: '#0f172a' }}>{value}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12, color: '#667085', lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

export default function ComplianceAuditFocus({ isDarkMode = false }) {
  const [matterType, setMatterType] = useState(MATTER_TYPES[0]);
  const [materialText, setMaterialText] = useState('');
  const [parsedFile, setParsedFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState([]);
  const [reportText, setReportText] = useState('');
  const [streamText, setStreamText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [ruleUploadLoading, setRuleUploadLoading] = useState(false);
  const [customRules, setCustomRules] = useState([]);
  const [selectedCustomRuleIds, setSelectedCustomRuleIds] = useState([]);
  const [rulesGallery, setRulesGallery] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fileInputRef = useRef(null);
  const customRuleInputRef = useRef(null);
  const abortRef = useRef(null);
  const stepTimersRef = useRef({});

  const bg = isDarkMode ? '#0f172a' : '#f5f7fb';
  const panelBg = isDarkMode ? '#111827' : 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))';
  const mutedBg = isDarkMode ? '#0b1220' : '#f7f9fc';
  const border = isDarkMode ? '1px solid #233044' : '1px solid rgba(15,23,42,0.06)';
  const textPrimary = isDarkMode ? '#f8fafc' : '#0f172a';
  const textSecondary = isDarkMode ? '#8fa0b7' : '#98a2b3';

  useEffect(() => {
    const loadAssets = async () => {
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
    loadAssets();
  }, []);

  const availableCustomRules = useMemo(() => (
    customRules.filter(item => (
      !matterType || item.matterType === matterType || item.matterType === '通用' || !item.matterType
    ))
  ), [customRules, matterType]);

  const visibleRulesGallery = useMemo(() => (
    rulesGallery.filter(item => !matterType || item.matterType === matterType || item.matterType === '总览')
  ), [rulesGallery, matterType]);

  useEffect(() => {
    setSelectedCustomRuleIds(prev => prev.filter(id => availableCustomRules.some(item => item.id === id)));
  }, [availableCustomRules]);

  const parsed = parseRiskRadar(reportText || streamText);
  const resultToneKey = inferResultTone(parsed.text, parsed.radarItems);
  const resultTone = STATUS_TONES[resultToneKey];
  const highlights = extractHighlights(parsed.text);
  const progressPercent = steps.length
    ? Math.round((steps.filter(item => item.done).length / SKILL_ORDER.length) * 100)
    : 0;

  const handleParseFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const response = await authFetch('/parse_file', { method: 'POST', body: fd });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          detail = body.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }
      const data = await response.json();
      setMaterialText(data.text || '');
      setParsedFile({ name: data.filename, chars: data.char_count });
      antMessage.success(`已导入 ${data.filename}`);
    } catch (err) {
      antMessage.error(`文件解析失败：${err.message}`);
    } finally {
      setParsing(false);
      event.target.value = '';
    }
  };

  const handleCustomRuleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
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
      antMessage.success(`已纳入 ${uploadedRules.length} 份合规规则文件`);
    } catch (err) {
      antMessage.error(`制度上传失败：${err.message}`);
    } finally {
      setRuleUploadLoading(false);
      event.target.value = '';
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

  const resetAudit = () => {
    setSteps([]);
    setReportText('');
    setStreamText('');
    setErrorText('');
    setParsedFile(null);
  };

  const runAudit = async () => {
    if (!matterType) {
      antMessage.warning('请先选择事项类型');
      return;
    }
    if (!materialText.trim()) {
      antMessage.warning('请先输入或导入审查材料');
      return;
    }

    setLoading(true);
    setSteps([]);
    setReportText('');
    setStreamText('');
    setErrorText('');
    stepTimersRef.current = {};
    abortRef.current = new AbortController();

    try {
      const response = await authFetch('/api/audit_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matter_type: matterType,
          material_text: materialText,
          custom_rule_ids: selectedCustomRuleIds,
        }),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
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
              if (data.type === 'tool_start') {
                stepTimersRef.current[data.tool] = Date.now();
                setSteps(prev => {
                  const existing = prev.find(item => item.tool === data.tool);
                  if (existing) {
                    return prev.map(item => item.tool === data.tool ? { ...item, running: true } : item);
                  }
                  return [...prev, { tool: data.tool, running: true, done: false }];
                });
              }
              if (data.type === 'tool_end') {
                const durationMs = stepTimersRef.current[data.tool]
                  ? Date.now() - stepTimersRef.current[data.tool]
                  : null;
                setSteps(prev => prev.map(item => (
                  item.tool === data.tool
                    ? { ...item, running: false, done: true, durationMs, result: data.result }
                    : item
                )));
              }
              if (data.type === 'llm_chunk') {
                setStreamText(prev => prev + (data.content || ''));
              }
              if (data.type === 'report') {
                setReportText(data.content || '');
              }
              if (data.type === 'error') {
                setErrorText(data.detail || '审查失败');
              }
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrorText(`审查失败：${err.message}`);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setSteps(prev => prev.map(item => item.running ? { ...item, running: false, done: true } : item));
    }
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', background: bg, padding: 16, boxSizing: 'border-box' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        style={{ display: 'none' }}
        onChange={handleParseFile}
      />
      <input
        ref={customRuleInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleCustomRuleUpload}
      />

      <div style={{ maxWidth: 1520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card
          bordered={false}
          style={{
            borderRadius: 22,
            background: isDarkMode ? '#101828' : 'linear-gradient(135deg, #ffffff 0%, #f8fbff 48%, #eef5ff 100%)',
            border: isDarkMode ? '1px solid #223046' : '1px solid rgba(15,23,42,0.05)',
            boxShadow: isDarkMode ? 'none' : '0 24px 60px rgba(15,23,42,0.07), inset 0 1px 0 rgba(255,255,255,0.84)',
          }}
          styles={{ body: { padding: 22 } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 760 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 999, background: STATUS_TONES.blue.soft, color: STATUS_TONES.blue.text, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                <SafetyCertificateOutlined />
                三重一大 · 默认办理流程
              </div>
              <Title level={3} style={{ margin: 0, color: textPrimary, lineHeight: 1.2 }}>
                提交材料，直接生成合规结论
              </Title>
              <Paragraph style={{ margin: '8px 0 0', color: textSecondary, fontSize: 14, lineHeight: 1.65 }}>
                普通经办人员只需完成四步：选事项、放材料、开始审查、看结论。制度和流程图收在高级选项中。
              </Paragraph>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={resetAudit}>清空结果</Button>
              <Button onClick={() => setDrawerOpen(true)}>高级选项</Button>
            </Space>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 16 }}>
            {[
              ['1', '选择事项', hasAuditReady(matterType), STATUS_TONES.blue],
              ['2', '放入材料', Boolean(materialText.trim()), STATUS_TONES.orange],
              ['3', '开始审查', loading, STATUS_TONES.blue],
              ['4', '得到结论', Boolean(reportText), STATUS_TONES.green],
            ].map(([step, label, active, tone]) => (
              <div
                key={step}
                style={{
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: active ? tone.soft : '#ffffffaa',
                  border: `1px solid ${active ? tone.border : 'rgba(15,23,42,0.06)'}`,
                }}
              >
                <div style={{ fontSize: 11, color: active ? tone.text : '#98a2b3' }}>步骤 {step}</div>
                <div style={{ marginTop: 3, fontWeight: 700, color: '#0f172a' }}>{label}</div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 12 }}>
          <Card bordered={false} style={{ borderRadius: 18, background: panelBg, border, boxShadow: isDarkMode ? 'none' : '0 16px 40px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.82)' }} styles={{ body: { padding: 16 } }}>
            <div style={{ marginBottom: 18 }}>
              <Text style={{ fontSize: 12, color: textSecondary }}>第 1 步</Text>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: textPrimary }}>选择事项类型</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MATTER_TYPES.map(type => {
                const active = matterType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMatterType(type)}
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      borderRadius: 18,
                      border: active ? `1px solid ${STATUS_TONES.blue.border}` : '1px solid rgba(15,23,42,0.08)',
                      background: active ? STATUS_TONES.blue.soft : mutedBg,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{type}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: textSecondary }}>{PLACEHOLDER_MAP[type]}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 18, padding: 16, borderRadius: 18, background: mutedBg, border }}>
              <div style={{ fontSize: 12, color: textSecondary }}>高级规则</div>
              <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700, color: textPrimary }}>{selectedCustomRuleIds.length}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: textSecondary }}>已附加制度文件数量，可在右上角“高级选项”里管理。</div>
            </div>
          </Card>

          <Card bordered={false} style={{ borderRadius: 18, background: panelBg, border, boxShadow: isDarkMode ? 'none' : '0 16px 40px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.82)' }} styles={{ body: { padding: 18 } }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <Text style={{ fontSize: 12, color: textSecondary }}>第 2 步</Text>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: textPrimary }}>粘贴或导入材料正文</div>
                <div style={{ marginTop: 4, fontSize: 12, color: textSecondary }}>只保留一个主要输入口。你可以直接粘贴，也可以先上传文件自动解析。</div>
              </div>
              <Space>
                <Button icon={parsing ? <LoadingOutlined /> : <UploadOutlined />} loading={parsing} onClick={() => fileInputRef.current?.click()}>
                  导入材料
                </Button>
                {loading && (
                  <Button danger type="dashed" icon={<StopOutlined />} onClick={() => abortRef.current?.abort()}>
                    停止
                  </Button>
                )}
              </Space>
            </div>

            {parsedFile && (
              <div style={{ marginBottom: 12 }}>
                <Tag color="success" style={{ margin: 0 }}>{parsedFile.name} · {parsedFile.chars.toLocaleString()} 字</Tag>
              </div>
            )}

            <TextArea
              value={materialText}
              onChange={event => setMaterialText(event.target.value)}
              placeholder={PLACEHOLDER_MAP[matterType]}
              autoSize={{ minRows: 14, maxRows: 22 }}
              style={{ borderRadius: 18, background: mutedBg, borderColor: '#d8e1ec', fontSize: 14, lineHeight: 1.8 }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: textSecondary }}>
                当前正文 {materialText.length.toLocaleString()} 字
              </div>
              <Button type="primary" size="large" onClick={runAudit} disabled={loading || !materialText.trim()} style={{ height: 46, borderRadius: 14, paddingInline: 22 }}>
                开始智能审查
              </Button>
            </div>

            {errorText && (
              <Alert
                type="error"
                showIcon
                message={errorText}
                style={{ marginTop: 16, borderRadius: 14 }}
              />
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 12 }}>
          <Card bordered={false} style={{ borderRadius: 18, background: panelBg, border, boxShadow: isDarkMode ? 'none' : '0 16px 40px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.82)' }} styles={{ body: { padding: 16 } }}>
            <div style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: textSecondary }}>第 3 步</Text>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: textPrimary }}>审查进度与结论摘要</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SKILL_ORDER.map((item, index) => {
                const current = steps.find(step => step.tool === item.tool);
                const state = current?.done ? 'done' : current?.running ? 'running' : 'waiting';
                return <StepChip key={item.tool} index={index} title={item.title} state={state} />;
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <SummaryCard title="完成进度" value={`${progressPercent}%`} hint="五个固定步骤的完成比例" tone={loading ? STATUS_TONES.blue : Boolean(reportText) ? STATUS_TONES.green : STATUS_TONES.gray} />
            </div>
            <div style={{ marginTop: 12 }}>
              <SummaryCard title="审查状态" value={reportText ? (resultToneKey === 'green' ? '已出结论' : '存在提示') : loading ? '审查中' : '待开始'} hint="先给判断，再展开查看依据和完整报告。" tone={reportText ? resultTone : loading ? STATUS_TONES.blue : STATUS_TONES.gray} />
            </div>
          </Card>

          <Card bordered={false} style={{ borderRadius: 18, background: panelBg, border, boxShadow: isDarkMode ? 'none' : '0 16px 40px rgba(15,23,42,0.045), inset 0 1px 0 rgba(255,255,255,0.82)' }} styles={{ body: { padding: 18 } }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <Text style={{ fontSize: 12, color: textSecondary }}>第 4 步</Text>
                <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: textPrimary }}>先看结论，再看完整报告</div>
              </div>
              {reportText && <Tag color={resultToneKey === 'green' ? 'success' : 'warning'} style={{ margin: 0 }}>{resultToneKey === 'green' ? '结论清晰' : '存在提醒'}</Tag>}
            </div>

            {!loading && !reportText && !streamText && !errorText && (
              <div style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="开始审查后，这里会先呈现结论摘要，再展开完整报告。" />
              </div>
            )}

            {(loading || reportText || streamText) && (
              <>
                {(parsed.radarItems || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    {parsed.radarItems.map((item, index) => (
                      <Tag
                        key={`${item.label}-${index}`}
                        color={item.status === 'green' ? 'success' : item.status === 'yellow' ? 'warning' : 'error'}
                        style={{ margin: 0 }}
                      >
                        {item.label}
                      </Tag>
                    ))}
                  </div>
                )}

                {highlights.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
                    {highlights.map(item => (
                      <div key={item} style={{ padding: '12px 14px', borderRadius: 16, background: resultTone.soft, border: `1px solid ${resultTone.border}` }}>
                        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#0f172a' }}>{item}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ borderRadius: 16, background: mutedBg, border, padding: 16, minHeight: 240 }}>
                  {loading && !reportText && !streamText ? (
                    <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Space direction="vertical" align="center">
                        <Spin size="large" />
                        <Text style={{ color: textSecondary }}>系统正在串行完成五步审查，请稍候…</Text>
                      </Space>
                    </div>
                  ) : (
                    <div className="markdown-content" style={{ fontSize: 14, lineHeight: 1.85, color: textPrimary }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.text || streamText}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Drawer
        title="高级选项"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={920}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card bordered={false} style={{ borderRadius: 20, background: '#f8fafc' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>三重一大规则 PDF</div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>这里管理额外参与本次审查的规则 PDF，不干扰主操作流。</div>
              </div>
              <Button
                type="primary"
                ghost
                icon={ruleUploadLoading ? <LoadingOutlined /> : <UploadOutlined />}
                loading={ruleUploadLoading}
                onClick={() => customRuleInputRef.current?.click()}
              >
                上传规则 PDF
              </Button>
            </div>

            <Select
              mode="multiple"
              allowClear
              value={selectedCustomRuleIds}
              onChange={setSelectedCustomRuleIds}
              options={availableCustomRules.map(item => ({ label: `${item.name} · ${item.matterType || '通用'}`, value: item.id }))}
              style={{ width: '100%', marginBottom: 14 }}
              placeholder="选择参与本次审查的规则 PDF"
              loading={configLoading}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {availableCustomRules.map(rule => (
                <div key={rule.id} style={{ padding: 14, borderRadius: 16, background: '#fff', border: '1px solid rgba(15,23,42,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{rule.name}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        <Tag color={rule.matterType === '通用' ? 'default' : 'blue'} style={{ margin: 0 }}>{rule.matterType || '通用'}</Tag>
                        <Tag color="cyan" style={{ margin: 0 }}>{(rule.charCount || 0).toLocaleString()} 字</Tag>
                      </div>
                    </div>
                    <Button size="small" danger type="text" onClick={() => handleDeleteCustomRule(rule.id)}>删除</Button>
                  </div>
                </div>
              ))}
              {availableCustomRules.length === 0 && <Empty description="当前没有可用的规则 PDF" />}
            </div>
          </Card>

          <Card bordered={false} style={{ borderRadius: 20, background: '#f8fafc' }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>流程依据图</div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>流程图被收进高级区，只有需要时再展开查看。</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {visibleRulesGallery.map(item => (
                <div key={item.id} style={{ borderRadius: 18, overflow: 'hidden', background: '#fff', border: '1px solid rgba(15,23,42,0.08)' }}>
                  <div style={{ padding: '14px 14px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <Text strong>{item.title}</Text>
                      <Tag color={item.matterType === '总览' ? 'default' : 'blue'} style={{ margin: 0 }}>{item.matterType}</Tag>
                    </div>
                    <Text type="secondary">{item.summary}</Text>
                  </div>
                  <Image src={item.imageUrl} alt={item.title} preview style={{ width: '100%', maxHeight: 220, objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Drawer>
    </div>
  );
}

function hasAuditReady(value) {
  return Boolean(value);
}
