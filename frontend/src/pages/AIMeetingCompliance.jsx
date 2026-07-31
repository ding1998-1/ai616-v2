import React, { useMemo, useState } from 'react';
import { Button, Input, Progress, Select, Space, Tag, Typography, message } from 'antd';
import {
  AudioOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ClusterOutlined,
  EditOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SignatureOutlined,
  StopOutlined,
} from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

const STAGES = [
  { key: 'collect', title: '会前收集', desc: '群聊素材聚类成议题' },
  { key: 'freeze', title: '日程冻结', desc: '秘书确认正式议程' },
  { key: 'record', title: '声纹记录', desc: '会中录音与角色分离' },
  { key: 'audit', title: '合规终审', desc: '三重一大规则拦截' },
  { key: 'archive', title: '公文归档', desc: '表决签名与水印归档' },
];

const INITIAL_MESSAGES = [
  { id: 1, user: '张主任', dept: '基建科', type: 'text', time: '09:14', content: '高新区厂房二期消防改造预算可能要追加，现场反馈原方案不够。' },
  { id: 2, user: '李会计', dept: '财务部', type: 'text', time: '09:18', content: '追加金额预计 860 万，需要确认是否走重大项目和大额资金流程。' },
  { id: 3, user: '王工', dept: '项目现场', type: 'image', time: '09:26', content: '现场照片 2 张：消防管线、配电间改造点位' },
  { id: 4, user: '周法务', dept: '法务合规部', type: 'text', time: '09:41', content: '如果涉及合同变更，建议补充可研说明、预算测算和法审意见。' },
];

const SPEECH_TRACKS = [
  { person: '陈伟', role: '分管领导', tone: 'blue', text: '项目确有安全整改必要，但必须先补齐可研和预算测算，不能先实施后补程序。', audio: '00:12 - 00:38' },
  { person: '李倩', role: '法务合规部', tone: 'purple', text: '合同变更金额较高，建议纳入重大项目安排审查，并由法务出具书面意见。', audio: '00:39 - 01:08' },
  { person: '王磊', role: '纪检监察室', tone: 'orange', text: '议题需要绑定项目编码，后续表决、纪要和附件必须同一案卷归档。', audio: '01:09 - 01:34' },
];

const ARCHIVE_ITEMS = ['聊天碎片', '现场图片', '会议录音', '声纹分轨日志', '身份重指派记录', '合规审查报告', '红头纪要', '电子签名', '显性水印', '隐形盲水印'];

function getStageIndex(activeStage) {
  return Math.max(STAGES.findIndex(item => item.key === activeStage), 0);
}

export default function AIMeetingCompliance({ isDarkMode = false }) {
  const [activeStage, setActiveStage] = useState('collect');
  const [projectBound, setProjectBound] = useState(false);
  const [agendaFrozen, setAgendaFrozen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [auditDone, setAuditDone] = useState(false);
  const [archived, setArchived] = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState('');

  const palette = {
    pageBg: isDarkMode ? '#0d1422' : '#f4f7fb',
    panelBg: isDarkMode ? '#111827' : '#ffffff',
    panelSoft: isDarkMode ? '#172033' : '#f8fafc',
    ink: isDarkMode ? '#f8fafc' : '#111827',
    text: isDarkMode ? '#d7dee8' : '#1f2937',
    muted: isDarkMode ? '#8fa0b8' : '#667085',
    line: isDarkMode ? '#263247' : '#e3e8f0',
    blue: '#1d5fd7',
    green: '#12805c',
    red: '#c24135',
    amber: '#b45309',
  };

  const activeIndex = getStageIndex(activeStage);
  const stageProgress = Math.round(((activeIndex + 1) / STAGES.length) * 100);
  const missingMaterials = useMemo(() => {
    const base = ['可行性研究说明', '预算测算表', '合同变更草案'];
    return auditDone ? ['合同变更草案'] : base;
  }, [auditDone]);

  const sendMessage = () => {
    if (!inputValue.trim()) return;
    setMessages(prev => [
      ...prev,
      {
        id: Date.now(),
        user: '秘书',
        dept: '综合办',
        type: 'text',
        time: '10:02',
        content: inputValue.trim(),
      },
    ]);
    setInputValue('');
    message.success('AI 已纳入会前素材聚类');
  };

  const panelStyle = {
    background: palette.panelBg,
    border: `1px solid ${palette.line}`,
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: isDarkMode ? 'none' : '0 10px 28px rgba(15,23,42,0.045)',
  };

  const titleBar = (icon, title, extra) => (
    <div style={{ padding: '12px 14px', borderBottom: `1px solid ${palette.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Text strong style={{ color: palette.ink }}>{icon} {title}</Text>
      {extra}
    </div>
  );

  return (
    <div style={{ height: '100%', padding: 16, boxSizing: 'border-box', overflow: 'hidden', background: palette.pageBg, color: palette.text }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <section style={{ ...panelStyle, padding: 14, flex: '0 0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 14, alignItems: 'center' }}>
            <div>
              <Space size={8} wrap style={{ marginBottom: 8 }}>
                <Tag color="blue" style={{ margin: 0 }}>AI会议</Tag>
                <Tag color="orange" style={{ margin: 0 }}>三重一大</Tag>
                <Tag color={projectBound ? 'green' : 'red'} style={{ margin: 0 }}>{projectBound ? '已绑定项目' : '待绑定项目'}</Tag>
              </Space>
              <Title level={4} style={{ margin: 0, color: palette.ink }}>AI 会议与“三重一大”合规管理系统</Title>
              <div style={{ marginTop: 6, color: palette.muted, fontSize: 13 }}>
                从会前群聊碎片、会中声纹记录、会后分轨校对，到合规终审、公文表决和防伪归档的一体化演示。
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: palette.muted, fontSize: 12 }}>
                <span>全链路进度</span>
                <span>{stageProgress}%</span>
              </div>
              <Progress percent={stageProgress} showInfo={false} strokeColor={palette.blue} />
            </div>
          </div>

          <div className="ai-meeting-stage-strip" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
            {STAGES.map((stage, index) => {
              const active = stage.key === activeStage;
              const done = index < activeIndex;
              return (
                <button
                  key={stage.key}
                  onClick={() => setActiveStage(stage.key)}
                  style={{
                    textAlign: 'left',
                    border: `1px solid ${active ? '#93c5fd' : palette.line}`,
                    background: active ? (isDarkMode ? '#10213a' : '#eff6ff') : palette.panelSoft,
                    borderRadius: 10,
                    padding: '10px 11px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: done ? palette.green : active ? palette.blue : '#e8eef7', color: done || active ? '#fff' : palette.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 }}>
                      {done ? <CheckCircleOutlined /> : index + 1}
                    </span>
                    <span style={{ color: active ? palette.blue : palette.ink, fontWeight: 900 }}>{stage.title}</span>
                  </div>
                  <div style={{ marginTop: 5, color: palette.muted, fontSize: 12 }}>{stage.desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="ai-meeting-grid" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '360px minmax(460px, 1fr) 380px', gap: 12 }}>
          <aside style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {titleBar(<MessageOutlined style={{ color: palette.blue }} />, '会前群聊式收集', <Tag color="processing" style={{ margin: 0 }}>限期中</Tag>)}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, display: 'grid', alignContent: 'start', gap: 10 }}>
              {messages.map(item => (
                <div key={item.id} style={{ padding: 11, borderRadius: 10, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text strong style={{ color: palette.ink, fontSize: 13 }}>{item.user} · {item.dept}</Text>
                    <span style={{ color: palette.muted, fontSize: 12 }}>{item.time}</span>
                  </div>
                  <div style={{ marginTop: 6, color: palette.text, fontSize: 13, lineHeight: 1.6 }}>
                    {item.type === 'image' && <Tag color="cyan" style={{ marginRight: 6 }}>图片</Tag>}
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${palette.line}` }}>
              <Input.TextArea
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                placeholder="像群聊一样补充一句材料，例如：请财务补一下预算测算表"
                autoSize={{ minRows: 2, maxRows: 3 }}
              />
              <Button type="primary" block icon={<SendOutlined />} onClick={sendMessage} style={{ marginTop: 8, height: 38, fontWeight: 800 }}>
                发送到会前收集群
              </Button>
            </div>
          </aside>

          <main style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {titleBar(<ClusterOutlined style={{ color: palette.blue }} />, 'AI 议题树与声纹分轨', <Tag color={agendaFrozen ? 'green' : 'blue'} style={{ margin: 0 }}>{agendaFrozen ? '议程已冻结' : '议题生成中'}</Tag>)}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, display: 'grid', gap: 12, alignContent: 'start' }}>
              <div style={{ border: `1px solid ${palette.line}`, background: palette.panelSoft, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <Text strong style={{ color: palette.ink, fontSize: 16 }}>高新区二期厂房消防改造追加预算议题</Text>
                    <div style={{ marginTop: 6, color: palette.muted, fontSize: 13 }}>AI 已将 4 条文字和 2 张现场图片聚类为 1 个结构化议题，并识别出资金、项目、合同变更标签。</div>
                  </div>
                  <Tag color={projectBound ? 'green' : 'red'} style={{ margin: 0 }}>{projectBound ? '已绑定影子项目' : '项目待绑定'}</Tag>
                </div>
                {!projectBound && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: isDarkMode ? '#2d1618' : '#fff1f2', border: `1px solid ${isDarkMode ? '#7f1d1d' : '#fecdd3'}` }}>
                    <div style={{ color: isDarkMode ? '#fecaca' : palette.red, fontWeight: 900 }}>智能推荐：检测到可能属于“高新区二期厂房改造”</div>
                    <div style={{ marginTop: 6, color: isDarkMode ? '#fecaca' : palette.red, fontSize: 13 }}>未绑定项目时，终审阶段会强制拦截。</div>
                    <Button type="primary" danger onClick={() => { setProjectBound(true); message.success('已绑定影子项目缓存库'); }} style={{ marginTop: 10 }}>
                      一键绑定影子项目
                    </Button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {['重大项目安排', '大额度资金运作', '合同变更', '消防安全'].map(tag => <Tag key={tag} color="blue" style={{ margin: 0 }}>{tag}</Tag>)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ border: `1px solid ${palette.line}`, background: palette.panelSoft, borderRadius: 12, padding: 14 }}>
                  <Text strong style={{ color: palette.ink }}>会议日程冻结</Text>
                  <Paragraph style={{ margin: '8px 0 12px', color: palette.muted, fontSize: 13 }}>秘书确认议题后，系统锁定会前收集内容并形成正式日程。</Paragraph>
                  <Button icon={<FileDoneOutlined />} type={agendaFrozen ? 'default' : 'primary'} onClick={() => { setAgendaFrozen(true); setActiveStage('freeze'); }}>
                    {agendaFrozen ? '日程已冻结' : '一键确认议题'}
                  </Button>
                </div>
                <div style={{ border: `1px solid ${palette.line}`, background: palette.panelSoft, borderRadius: 12, padding: 14 }}>
                  <Text strong style={{ color: palette.ink }}>会中声纹记录</Text>
                  <Paragraph style={{ margin: '8px 0 12px', color: palette.muted, fontSize: 13 }}>录音时同步做声纹识别和角色分离，会议结束后自动分轨。</Paragraph>
                  <Button icon={recording ? <StopOutlined /> : <AudioOutlined />} danger={recording} type="primary" onClick={() => { setRecording(prev => !prev); setActiveStage('record'); }}>
                    {recording ? '停止录音' : '启动会议录音'}
                  </Button>
                </div>
              </div>

              <div style={{ border: `1px solid ${palette.line}`, background: palette.panelSoft, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Text strong style={{ color: palette.ink }}>会后声纹分轨与人工校对</Text>
                  <Tag color="cyan" style={{ margin: 0 }}>音字同步锚点</Tag>
                </div>
                <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
                  {SPEECH_TRACKS.map(track => (
                    <div key={track.person} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 130px', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, background: palette.panelBg, border: `1px solid ${palette.line}` }}>
                      <div>
                        <Text strong style={{ color: palette.ink }}>{track.person}</Text>
                        <div style={{ color: palette.muted, fontSize: 12 }}>{track.role}</div>
                      </div>
                      <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.55 }}>{track.text}</div>
                      <Space size={6}>
                        <Button size="small" icon={<AudioOutlined />}>{track.audio}</Button>
                        <Select size="small" value={track.person} style={{ width: 72 }} options={SPEECH_TRACKS.map(item => ({ label: item.person, value: item.person }))} />
                      </Space>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>

          <aside style={{ ...panelStyle, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {titleBar(<SafetyCertificateOutlined style={{ color: palette.blue }} />, '终审拦截与成果归档', <Tag color={auditDone ? 'green' : 'orange'} style={{ margin: 0 }}>{auditDone ? '已通过终审' : '待补齐'}</Tag>)}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              <div style={{ padding: 12, borderRadius: 12, background: projectBound ? (isDarkMode ? '#10281b' : '#f0fdf4') : (isDarkMode ? '#2d1618' : '#fff1f2'), border: `1px solid ${projectBound ? (isDarkMode ? '#166534' : '#bbf7d0') : (isDarkMode ? '#7f1d1d' : '#fecdd3')}` }}>
                <Text strong style={{ color: projectBound ? palette.green : palette.red }}>项目强绑定拦截</Text>
                <div style={{ marginTop: 6, color: projectBound ? palette.green : palette.red, fontSize: 13 }}>
                  {projectBound ? '已绑定影子项目：高新区二期厂房改造。' : '触发三重一大但未绑定项目，系统禁止进入终审。'}
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <Text strong style={{ color: palette.ink }}>支撑材料核验</Text>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {missingMaterials.map(item => (
                    <div key={item} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: palette.text, fontSize: 13 }}>{item}</span>
                      <Tag color="orange" style={{ margin: 0 }}>AI催办</Tag>
                    </div>
                  ))}
                </div>
                <Button block style={{ marginTop: 10 }} onClick={() => message.success('已在群聊/私聊中 @ 负责人补充材料')}>
                  @ 负责人催办补充
                </Button>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <Text strong style={{ color: palette.ink }}>一键公文与表决</Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  <Button icon={<EditOutlined />} onClick={() => { setAuditDone(true); setActiveStage('audit'); }}>生成红头纪要</Button>
                  <Button icon={<SignatureOutlined />} onClick={() => { setAuditDone(true); setActiveStage('archive'); }}>发起电子签</Button>
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: palette.panelSoft, border: `1px solid ${palette.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text strong style={{ color: palette.ink }}>高强度防伪归档</Text>
                  <Tag color={archived ? 'green' : 'default'} style={{ margin: 0 }}>{archived ? '已归档' : '待归档'}</Tag>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                  {ARCHIVE_ITEMS.map(item => <Tag key={item} color="blue" style={{ margin: 0 }}>{item}</Tag>)}
                </div>
                <Button type="primary" block icon={<FolderOpenOutlined />} disabled={!projectBound} onClick={() => { setArchived(true); setActiveStage('archive'); message.success('已生成防伪归档包'); }} style={{ marginTop: 12, height: 40, fontWeight: 800 }}>
                  打包加水印归档
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <style>{`
        @media (max-width: 1440px) {
          .ai-meeting-grid {
            grid-template-columns: 330px minmax(420px,1fr) 350px !important;
          }
        }

        @media (max-width: 1180px) {
          .ai-meeting-stage-strip,
          .ai-meeting-grid {
            grid-template-columns: 1fr !important;
          }

          .ai-meeting-grid {
            overflow: auto;
          }
        }
      `}</style>
    </div>
  );
}
