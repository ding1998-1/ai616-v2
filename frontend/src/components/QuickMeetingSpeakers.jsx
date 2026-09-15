import React, { useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { authFetchJson, getStoredToken } from '../lib/auth';

function SpeakerSample({ url, segment }) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const token = getStoredToken();
      const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('录音加载失败，请重试');
      setSource(URL.createObjectURL(await response.blob()));
    } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  };
  return <div style={{ marginTop: 10 }}>
    {source ? <audio controls preload="metadata" src={source} style={{ width: '100%' }} onLoadedMetadata={event => { event.currentTarget.currentTime = segment.start; }} /> : <Button size="small" loading={loading} onClick={load}>加载录音试听</Button>}
    {error && <Typography.Text type="danger">{error}</Typography.Text>}
  </div>;
}

export default function QuickMeetingSpeakers({ meetingId, state, audioRows, readOnly, onChange }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const recordings = state.recordings || [];
  const save = async () => {
    setSaving(true);
    try {
      const next = await authFetchJson(`/api/voiceprint/meetings/${meetingId}/diarization/name`, {
        method: 'POST', body: JSON.stringify({ audioEventId: editing.audioEventId, speakerId: editing.speakerId, name }),
      });
      onChange(next);
      setEditing(null);
      message.success(name.trim() ? '已确认本段录音中的发言人姓名' : '已恢复匿名姓名');
    } catch (error) { message.error(error.message); }
    finally { setSaving(false); }
  };
  return <>
    <Typography.Paragraph type="secondary">录音完成后区分发言人。同一编号仅在对应录音内有效，姓名由人工确认。</Typography.Paragraph>
    {!recordings.length && <Empty description={state.enabled ? '录音保存后等待分离结果' : '发言人分离尚未启用，录音和字幕可正常查看'} />}
    {recordings.map((recording, index) => {
      const audio = audioRows.find(row => row.id === recording.audioEventId || String(row.playbackUrl || '').includes(recording.sourceFile));
      return <section key={recording.audioEventId} style={{ padding: 16, border: '1px solid #e5e9f0', borderRadius: 12, marginBottom: 12 }}>
        <Space wrap><Typography.Text strong>录音 {index + 1}</Typography.Text><Tag>{{ done: '已完成', queued: '排队中', running: '处理中', failed: '失败', interrupted: '已中断' }[recording.status] || '待处理'}</Tag></Space>
        {(recording.speakers || []).map(speaker => {
          const key = JSON.stringify([recording.audioEventId, speaker.speakerId]);
          const confirmed = state.identities?.names?.[key] || '';
          const segment = (recording.segments || []).find(item => item.speakerId === speaker.speakerId);
          return <div key={speaker.speakerId} style={{ padding: '14px 0', borderBottom: '1px solid #edf0f5' }}>
            <Space wrap><Typography.Text strong>{confirmed || speaker.speakerLabel}</Typography.Text><Tag>{confirmed ? '人工确认' : '待指定姓名'}</Tag>
              {!readOnly && <Button size="small" onClick={() => { setEditing({ audioEventId: recording.audioEventId, speakerId: speaker.speakerId }); setName(confirmed); }}>指定姓名</Button>}
            </Space>
            {audio && segment && <SpeakerSample url={audio.playbackUrl} segment={segment} />}
            <Typography.Text type="secondary">对应录音内 {segment?.start ?? 0} 秒起，可试听后确认。</Typography.Text>
          </div>;
        })}
        {recording.error && <Typography.Paragraph type="danger">{recording.error}</Typography.Paragraph>}
        {!readOnly && ['failed', 'interrupted'].includes(recording.status) && <Button onClick={async () => {
          try {
            const next = await authFetchJson(`/api/voiceprint/meetings/${meetingId}/diarization/retry?audio_event_id=${encodeURIComponent(recording.audioEventId)}`, { method: 'POST' });
            onChange(next);
            message.success('已提交本段录音重新分离');
          } catch (error) { message.error(error.message); }
        }}>重试本段分离</Button>}
      </section>;
    })}
    <Modal title="确认发言人姓名" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={save} confirmLoading={saving} okText="保存姓名" cancelText="取消">
      <Typography.Paragraph>仅修改本场会议、对应录音的发言人标注。清空姓名可恢复匿名，修改记录会保留。</Typography.Paragraph>
      <Input aria-label="发言人姓名" value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="输入姓名，或留空恢复匿名" />
    </Modal>
  </>;
}
