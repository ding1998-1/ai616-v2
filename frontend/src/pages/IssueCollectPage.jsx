import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, FileTextOutlined, LogoutOutlined, PictureOutlined, SendOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { authFetchJson } from '../lib/auth';

const { Text, Title } = Typography;

function compactText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function parseIssueMeta(meta) {
  if (!meta) return { label: '', attachments: [] };
  if (typeof meta === 'object') {
    return {
      label: compactText(meta.label || meta.category || ''),
      attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
    };
  }
  try {
    const parsed = JSON.parse(meta);
    return {
      label: compactText(parsed.label || parsed.category || ''),
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return { label: compactText(meta), attachments: [] };
  }
}

export default function IssueCollectPage({ currentUser, onLogout }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const meetingId = params.get('meetingId') || 'meeting-gxq-fc-2026-02';
  const meetingTitle = params.get('meeting') || 'AI 会议问题收集';
  const agenda = params.get('agenda') || '待梳理议题';
  const projectName = params.get('project') || '本地项目';
  const meetingDate = params.get('date') || '2026-06-10';
  const queryMeetingMode = params.get('mode') === 'normal' ? 'normal' : params.get('mode') === 'major' ? 'major' : '';
  const [form] = Form.useForm();
  const fileInputRef = useRef(null);
  const [meetingDetail, setMeetingDetail] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [parsingFiles, setParsingFiles] = useState(false);
  const [attachmentRows, setAttachmentRows] = useState([]);
  const [submittedIssues, setSubmittedIssues] = useState([]);

  useEffect(() => {
    const root = document.getElementById('root');
    document.documentElement.classList.add('issue-collect-scroll');
    document.body.classList.add('issue-collect-scroll');
    root?.classList.add('issue-collect-scroll');
    return () => {
      document.documentElement.classList.remove('issue-collect-scroll');
      document.body.classList.remove('issue-collect-scroll');
      root?.classList.remove('issue-collect-scroll');
    };
  }, []);

  useEffect(() => {
    let alive = true;
    authFetchJson(`/api/meetings/${meetingId}`)
      .then(data => {
        if (!alive) return;
        setMeetingDetail(data.meeting);
        setSubmittedIssues(Array.isArray(data.meeting?.issueSources) ? data.meeting.issueSources.slice(-5).reverse() : []);
      })
      .catch(() => {
        if (!alive) return;
        setMeetingDetail(null);
      });
    return () => { alive = false; };
  }, [meetingId]);

  const resolvedMeetingTitle = meetingDetail?.title || meetingTitle;
  const resolvedProjectName = meetingDetail?.project || projectName;
  const resolvedAgenda = meetingDetail?.agenda || agenda;
  const resolvedDate = meetingDetail?.date || meetingDate;
  const resolvedMeetingMode = queryMeetingMode || (meetingDetail?.meetingMode === 'major' ? 'major' : 'normal');
  const isMajorMeeting = resolvedMeetingMode !== 'normal';

  const handleAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setParsingFiles(true);
    const nextRows = [];
    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (isImage) {
        let imageDataUrl = '';
        try {
          imageDataUrl = await readFileAsDataUrl(file);
          const fd = new FormData();
          fd.append('file', file);
          const response = await fetch('/api/ocr/image', {
            method: 'POST',
            headers: {
              ...(localStorage.getItem('ai_compliance_token') ? { Authorization: `Bearer ${localStorage.getItem('ai_compliance_token')}` } : {}),
            },
            body: fd,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          nextRows.push({
            id: `${file.name}-${file.size}-${Date.now()}`,
            name: file.name,
            type: 'image',
            size: file.size,
            imageDataUrl,
            text: data.text ? `OCR：${compactText(data.text).slice(0, 800)}` : 'OCR 未识别到有效文字，图片已作为素材提交。',
          });
        } catch (error) {
          if (!imageDataUrl) {
            try {
              imageDataUrl = await readFileAsDataUrl(file);
            } catch {
              imageDataUrl = '';
            }
          }
          nextRows.push({
            id: `${file.name}-${file.size}-${Date.now()}`,
            name: file.name,
            type: 'image',
            size: file.size,
            imageDataUrl,
            text: `图片已接收，OCR 暂未完成：${error.message}`,
          });
        }
        continue;
      }
      if (!['docx', 'pdf', 'txt', 'md'].includes(ext)) {
        nextRows.push({
          id: `${file.name}-${file.size}-${Date.now()}`,
          name: file.name,
          type: 'file',
          size: file.size,
          text: '附件已记录文件名，当前仅支持 docx/pdf/txt/md 自动提取文字。',
        });
        continue;
      }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const response = await fetch('/parse_file', { method: 'POST', body: fd });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        nextRows.push({
          id: `${file.name}-${file.size}-${Date.now()}`,
          name: file.name,
          type: 'file',
          size: file.size,
          text: compactText(data.text).slice(0, 800) || '附件已解析，但未提取到有效文字。',
        });
      } catch (error) {
        nextRows.push({
          id: `${file.name}-${file.size}-${Date.now()}`,
          name: file.name,
          type: 'file',
          size: file.size,
          text: `附件解析失败：${error.message}`,
        });
      }
    }
    setAttachmentRows(prev => [...prev, ...nextRows].slice(-6));
    setParsingFiles(false);
  };

  const submitIssue = async (values) => {
    const content = compactText(values.content);
    if (!content && !attachmentRows.length) {
      message.warning(isMajorMeeting ? '请填写问题描述或上传材料' : '请填写问题描述或上传图片/附件');
      return;
    }
    const amount = compactText(values.amount);
    const material = compactText(values.material);
    const attachmentLines = attachmentRows.map(item => {
      const prefix = item.type === 'image' ? '图片素材' : '附件文字';
      return `${prefix}：${item.name}；${item.text}`;
    });
    const metaPayload = {
      label: isMajorMeeting ? (values.category || '外部填报') : '普通会议问题素材',
      meetingMode: resolvedMeetingMode,
      attachments: attachmentRows.map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        size: item.size,
        text: item.text,
        imageDataUrl: item.imageDataUrl || '',
      })),
    };
    const contentLines = isMajorMeeting
      ? [
          content ? `问题描述：${content}` : '',
          `事项类型：${values.category || '待 AI 判断'}`,
          amount ? `涉及金额：${amount}` : '',
          material ? `材料情况：${material}` : '',
          ...attachmentLines,
        ].filter(Boolean)
      : [
          content ? `问题描述：${content}` : '',
          ...attachmentLines,
        ].filter(Boolean);

    setSubmitting(true);
    try {
      if (!meetingDetail) {
        await authFetchJson('/api/meetings', {
          method: 'POST',
          body: JSON.stringify({
            id: meetingId,
            title: resolvedMeetingTitle,
            project: resolvedProjectName,
            agenda: resolvedAgenda,
            date: resolvedDate,
            type: '党委会',
            meetingMode: resolvedMeetingMode,
            phase: '问题收集中',
          }),
        });
      }
      const data = await authFetchJson(`/api/meetings/${meetingId}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          name: `${currentUser?.dept || '外部单位'} ${currentUser?.name || currentUser?.username || '填报人'}`.trim(),
          type: attachmentRows.some(item => item.type === 'image') ? 'image' : 'text',
          content: contentLines.join('；'),
          meta: JSON.stringify(metaPayload),
          source: 'issue-collect-share',
        }),
      });
      setSubmittedIssues(Array.isArray(data.meeting?.issueSources) ? data.meeting.issueSources.slice(-5).reverse() : [data.issue]);
      form.resetFields();
      setAttachmentRows([]);
      message.success('已提交，秘书端问题池会同步出现');
    } catch (error) {
      message.error(`提交失败：${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="issue-collect-page">
      <main className="issue-collect-shell">
        <section className="issue-collect-hero">
          <div>
            <Space size={8} wrap>
              <Tag color="blue" bordered={false}>问题收集</Tag>
              <Tag color={isMajorMeeting ? 'red' : 'green'} bordered={false}>{isMajorMeeting ? '三重一大会议' : '普通会议'}</Tag>
            </Space>
            <Title level={2}>{isMajorMeeting ? '把上会问题先填进来' : '把会议问题或素材丢进来'}</Title>
            <Text>
              {isMajorMeeting
                ? '不用填写会议表。把现场问题、资金疑点、材料缺口写清楚，AI 会在秘书端整理成可上会待办。'
                : '普通会议不用填金额和表决材料。写一段话，或上传图片/附件，AI 会帮秘书整理成待讨论事项。'}
            </Text>
          </div>
          <Button icon={<LogoutOutlined />} onClick={onLogout}>退出</Button>
        </section>

        <section className="issue-collect-info">
          <div>
            <span>会议</span>
            <strong>{resolvedMeetingTitle}</strong>
          </div>
          <div>
            <span>{isMajorMeeting ? '项目' : '事项'}</span>
            <strong>{resolvedProjectName}</strong>
          </div>
          <div>
            <span>日期</span>
            <strong>{resolvedDate}</strong>
          </div>
          <div>
            <span>当前议题</span>
            <strong>{resolvedAgenda}</strong>
          </div>
        </section>

        <section className="issue-collect-card">
          <div className="issue-collect-user">
            <UserOutlined />
            <span>{currentUser?.dept || '外部单位'} · {currentUser?.name || currentUser?.username}</span>
          </div>

          <div className={isMajorMeeting ? 'issue-collect-mode-note is-major' : 'issue-collect-mode-note'}>
            <strong>{isMajorMeeting ? '当前为三重一大会议' : '当前为普通会议'}</strong>
            <span>{isMajorMeeting ? '会议性质由秘书端设置，本页需要补充事项类型、金额和材料情况。' : '会议性质由秘书端设置，本页只收文字、图片或附件，不需要填写金额和材料清单。'}</span>
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={submitIssue}
            initialValues={{ category: '现场问题' }}
          >
            <Form.Item
              label={isMajorMeeting ? '问题描述' : '问题 / 素材描述'}
              name="content"
              rules={attachmentRows.length ? [] : [{ required: true, message: isMajorMeeting ? '请填写问题描述' : '请填写问题描述或上传图片/附件' }]}
            >
              <Input.TextArea
                autoSize={{ minRows: 5, maxRows: 8 }}
                placeholder={isMajorMeeting
                  ? '例：二期厂房消防改造现场变更较多，预算可能追加 860 万，资金来源测算表还没补齐。'
                  : '例：今天例会需要讨论食堂改造反馈、系统登录慢、窗口排队时间长。也可以直接上传现场照片或附件。'}
              />
            </Form.Item>

            {isMajorMeeting && (
              <>
                <div className="issue-collect-grid">
                  <Form.Item label="事项类型" name="category">
                    <Select
                      options={['现场问题', '资金疑点', '材料缺口', '合同变更', '干部人事', '其他'].map(item => ({ label: item, value: item }))}
                    />
                  </Form.Item>
                  <Form.Item label="涉及金额" name="amount">
                    <Input placeholder="例：860 万 / 暂不确定" />
                  </Form.Item>
                </div>

                <Form.Item label="材料情况" name="material">
                  <Input placeholder="例：已有现场照片，缺资金测算表和法务意见" />
                </Form.Item>
              </>
            )}

            <div className="issue-collect-upload">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.docx,.pdf,.txt,.md"
                style={{ display: 'none' }}
                onChange={handleAttachmentChange}
              />
              <Button icon={<UploadOutlined />} loading={parsingFiles} onClick={() => fileInputRef.current?.click()}>
                {isMajorMeeting ? '上传图片 / 材料附件' : '上传图片 / 附件'}
              </Button>
              <Text>{isMajorMeeting ? '三重一大材料会进入秘书端议题池。' : '普通会议只作为问题素材，不要求金额和材料清单。'}</Text>
            </div>

            {attachmentRows.length > 0 && (
              <div className="issue-collect-attachments">
                {attachmentRows.map(item => (
                  <div key={item.id} className="issue-collect-attachment-item">
                    {item.type === 'image' && item.imageDataUrl ? (
                      <img src={item.imageDataUrl} alt={item.name} className="issue-collect-attachment-thumb" />
                    ) : item.type === 'image' ? <PictureOutlined /> : <FileTextOutlined />}
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button type="primary" htmlType="submit" loading={submitting} icon={<SendOutlined />} block size="large">
              {isMajorMeeting ? '提交给秘书端 AI 议题池' : '提交给秘书端待讨论事项'}
            </Button>
          </Form>
        </section>

        <section className="issue-collect-card">
          <div className="issue-collect-section-title">
            <CheckCircleOutlined />
            <strong>最近提交</strong>
          </div>
          <div className="issue-collect-list">
            {submittedIssues.map(item => (
              <div key={item.id || `${item.time}-${item.content}`} className="issue-collect-list-item">
                <div>
                  <strong>{item.name || '填报人'}</strong>
                  <span>{item.time || item.serverTime || '--:--'}</span>
                </div>
                {parseIssueMeta(item.meta).attachments.filter(attachment => attachment.type === 'image' && attachment.imageDataUrl).map(attachment => (
                  <img key={attachment.id || attachment.name} src={attachment.imageDataUrl} alt={attachment.name} className="issue-collect-list-image" />
                ))}
                <p>{item.content}</p>
              </div>
            ))}
            {!submittedIssues.length && (
              <Alert type="info" showIcon message="还没有提交记录" description="提交后会出现在这里，同时写回秘书端的问题收集区。" />
            )}
          </div>
        </section>
      </main>

      <style>{`
        html.issue-collect-scroll,
        body.issue-collect-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }

        body.issue-collect-scroll #root,
        #root.issue-collect-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow: visible !important;
        }

        .issue-collect-page {
          min-height: 100dvh;
          padding: 18px;
          box-sizing: border-box;
          background: #f5f7fb;
          color: #1d2129;
        }

        .issue-collect-shell {
          width: min(760px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 12px;
          padding-bottom: calc(28px + env(safe-area-inset-bottom));
        }

        .issue-collect-hero,
        .issue-collect-card,
        .issue-collect-info {
          border-radius: 14px;
          border: 1px solid #e5e6eb;
          background: #fff;
          box-shadow: 0 12px 32px rgba(29, 33, 41, 0.06);
        }

        .issue-collect-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
          padding: 18px;
        }

        .issue-collect-hero h2 {
          margin: 10px 0 8px;
          color: #1d2129;
          font-size: 26px;
          line-height: 1.25;
          font-weight: 750;
        }

        .issue-collect-hero .ant-typography {
          color: #86909c;
          font-size: 14px;
          line-height: 1.7;
        }

        .issue-collect-info {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0;
          overflow: hidden;
        }

        .issue-collect-info div {
          min-width: 0;
          padding: 12px 14px;
          border-top: 1px solid #f2f3f5;
        }

        .issue-collect-info div:nth-child(-n + 2) {
          border-top: 0;
        }

        .issue-collect-info div:nth-child(odd) {
          border-right: 1px solid #f2f3f5;
        }

        .issue-collect-info span {
          display: block;
          color: #86909c;
          font-size: 12px;
        }

        .issue-collect-info strong {
          display: block;
          margin-top: 4px;
          color: #1d2129;
          font-size: 14px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .issue-collect-card {
          padding: 16px;
        }

        .issue-collect-user {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          color: #4e5969;
          font-size: 13px;
          font-weight: 600;
        }

        .issue-collect-mode-note {
          display: grid;
          gap: 4px;
          margin: 0 0 14px;
          padding: 11px 12px;
          border-radius: 10px;
          border: 1px solid #b7eb8f;
          background: #f6ffed;
        }

        .issue-collect-mode-note.is-major {
          border-color: #ffccc7;
          background: #fff2f0;
        }

        .issue-collect-mode-note strong {
          color: #1d2129;
          font-size: 13px;
          line-height: 1.35;
          font-weight: 700;
        }

        .issue-collect-mode-note span {
          color: #4e5969;
          font-size: 12px;
          line-height: 1.5;
        }

        .issue-collect-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
        }

        .issue-collect-upload {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: -2px 0 14px;
          padding: 12px;
          border-radius: 10px;
          border: 1px dashed #c9cdd4;
          background: #f7f8fa;
        }

        .issue-collect-upload .ant-typography {
          color: #86909c;
          font-size: 12px;
          line-height: 1.5;
        }

        .issue-collect-attachments {
          display: grid;
          gap: 8px;
          margin: -4px 0 14px;
        }

        .issue-collect-attachment-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid #e5e6eb;
          background: #fff;
        }

        .issue-collect-attachment-item > .anticon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #e8f3ff;
          color: #165dff;
        }

        .issue-collect-attachment-thumb {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          object-fit: cover;
          border: 1px solid #e5e6eb;
          background: #f2f3f5;
        }

        .issue-collect-attachment-item strong,
        .issue-collect-attachment-item span {
          display: block;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .issue-collect-attachment-item strong {
          color: #1d2129;
          font-size: 13px;
          line-height: 1.35;
        }

        .issue-collect-attachment-item span {
          margin-top: 4px;
          color: #86909c;
          font-size: 12px;
          line-height: 1.5;
        }

        .issue-collect-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #165dff;
          margin-bottom: 10px;
        }

        .issue-collect-list {
          display: grid;
          gap: 8px;
        }

        .issue-collect-list-item {
          padding: 11px;
          border-radius: 10px;
          background: #f7f8fa;
          border: 1px solid #e5e6eb;
        }

        .issue-collect-list-item div {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #4e5969;
          font-size: 12px;
        }

        .issue-collect-list-item p {
          margin: 7px 0 0;
          color: #1d2129;
          font-size: 13px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        .issue-collect-list-image {
          display: block;
          width: 100%;
          max-height: 220px;
          margin-top: 9px;
          border-radius: 10px;
          object-fit: contain;
          border: 1px solid #e5e6eb;
          background: #fff;
        }

        @media (max-width: 640px) {
          .issue-collect-page {
            padding: 10px;
          }

          .issue-collect-hero {
            grid-template-columns: 1fr;
            padding: 15px;
          }

          .issue-collect-hero h2 {
            font-size: 22px;
          }

          .issue-collect-info,
          .issue-collect-grid {
            grid-template-columns: 1fr;
          }

          .issue-collect-upload {
            align-items: stretch;
            flex-direction: column;
          }

          .issue-collect-info div {
            border-right: 0 !important;
          }

          .issue-collect-info div:nth-child(2) {
            border-top: 1px solid #f2f3f5;
          }
        }
      `}</style>
    </div>
  );
}
