import React, { useState, useRef, useEffect } from 'react';
import { Typography, Button, Space, Avatar, Collapse, Spin, Modal } from 'antd';
import {
  RobotOutlined, UserOutlined, LoadingOutlined,
  BookOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { Welcome, Sender, Prompts } from '@ant-design/x';
import ReactMarkdown from 'react-markdown';
import { authFetch } from '../lib/auth';

const { Text } = Typography;

const QUICK_PROMPTS = [
  { key: '重大决策流程', label: '重大决策应包含哪些流程？', description: '查询决策前置程序与合规要求' },
  { key: '大额资金审批', label: '大额资金使用审批流程', description: '了解资金拨付规定步骤与双签要求' },
  { key: '人事任免', label: '人事任免应当注意什么？', description: '党管干部与纪检监督程序' },
  { key: '项目防范风险', label: '项目安排如何防范风险？', description: '可行性论证与专家评审要求' },
];

// Single turn (user or assistant)
function KBTurn({ msg, loading, isDarkMode }) {
  const isUser = msg.role === 'user';
  const border = isDarkMode ? '1px solid #333' : '1px solid #eee';
  const isStreaming = loading && !msg.isError && msg.role !== 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div className="user-bubble" style={{
          background: 'linear-gradient(135deg,#1677ff,#0958d9)',
          color: '#fff',
          borderRadius: '16px 4px 16px 16px',
          padding: '10px 16px', maxWidth: '80%',
        }}>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
        </div>
        <Avatar icon={<UserOutlined />} style={{ background: '#0958d9', marginLeft: 8, flexShrink: 0, alignSelf: 'flex-end' }} />
      </div>
    );
  }

  const showLoading = loading && !msg.text && !msg.thinking && !msg.isError;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
      <Avatar icon={<RobotOutlined />} style={{ background: '#52c41a', marginRight: 8, flexShrink: 0, marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Tool progress pill */}
        {msg.toolStatus && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: '#888',
            background: isDarkMode ? '#1f1f1f' : '#f5f5f5',
            border, borderRadius: 20, padding: '3px 12px', marginBottom: 8,
          }}>
            <LoadingOutlined style={{ fontSize: 11 }} />
            {msg.toolStatus}
          </div>
        )}

        {/* Thinking process — collapsible */}
        {msg.thinking && (
          <Collapse
            size="small"
            style={{ marginBottom: 10, border }}
            items={[{
              key: '1',
              label: <span style={{ fontSize: 12, color: '#888' }}>💭 模型思考过程</span>,
              children: (
                <div style={{
                  fontSize: 12, color: '#aaa', whiteSpace: 'pre-wrap',
                  maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace',
                }}>
                  {msg.thinking}
                </div>
              ),
            }]}
          />
        )}

        {showLoading && <Spin size="small" />}

        {msg.isError && <Text type="danger">{msg.text}</Text>}

        {/* Streaming / final answer */}
        {!msg.isError && msg.text && (
          <div className={`markdown-content ${isDarkMode ? 'markdown-dark' : ''}`}
            style={{ fontSize: 14, lineHeight: 1.8 }}>
            <span className={isStreaming ? 'typing-cursor' : ''}>
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </span>
          </div>
        )}

        {/* 参考资料来源 */}
        {!msg.isError && msg.sources && msg.sources.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: border }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>
              📚 参考资料（{msg.sources.length} 条）
            </Text>
            {msg.sources.map(s => (
              <Button
                key={s.index}
                type="link"
                size="small"
                onClick={() => {
                  Modal.info({
                    title: `📄 ${s.source}  ${s.location}`,
                    content: (
                      <div style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7 }}>
                        {s.snippet}
                      </div>
                    ),
                    width: 600,
                    okText: '关闭',
                  });
                }}
                style={{ padding: '0 8px 0 0', fontSize: 12 }}
              >
                参考{s.index} — {s.source}（{s.location}）
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function KnowledgeBase({ isDarkMode = true }) {
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [senderValue, setSenderValue] = useState('');
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const doQuery = async (queryText) => {
    if (!queryText?.trim()) return;

    const uid = `u_${Date.now()}`;
    const aid = `a_${Date.now() + 1}`;
    setTurns(prev => [
      ...prev,
      { id: uid, role: 'user', text: queryText },
      { id: aid, role: 'assistant', text: '', thinking: '', toolStatus: '', isError: false },
    ]);
    setSenderValue('');
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const resp = await authFetch('/api/kb_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
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
                if (data.type === 'tool_start') return { ...m, toolStatus: data.tool };
                if (data.type === 'tool_end') return { ...m, toolStatus: '' };
                if (data.type === 'sources') return { ...m, sources: data.sources || [] };
                if (data.type === 'thinking_chunk') return { ...m, thinking: (m.thinking || '') + data.content };
                if (data.type === 'llm_chunk') return { ...m, text: (m.text || '') + data.content };
                if (data.type === 'report') return { ...m, text: data.content, toolStatus: '' };
                if (data.type === 'error') return { ...m, text: data.detail, isError: true, toolStatus: '' };
                if (data.type === 'queue_warning') {
                  return { ...m, text: (m.text || '') + `\n\n⏳ **系统提示**：${data.content}\n\n` };
                }
                return m;
              }));
            } catch (_) { }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setTurns(prev => prev.map(m =>
          m.id.startsWith('a_') && !m.text
            ? { ...m, text: `检索失败：${err.message}`, isError: true }
            : m
        ));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();
  const handleClear = () => {
    if (loading) return;
    Modal.confirm({
      title: '清空对话',
      content: '确认清空所有问答记录吗？',
      okText: '清空', okType: 'danger',
      onOk: () => { setTurns([]); setSenderValue(''); },
    });
  };
  const handlePromptClick = ({ data }) => doQuery(data.label);
  const isEmpty = turns.length === 0;
  const bg = isDarkMode ? '#111827' : '#fff';
  const border = isDarkMode ? '1px solid #374151' : '1px solid #eee';

  return (
    <div
      className={`siri-thinking-border-wrapper ${loading ? 'thinking' : ''}`}
      style={{ height: '100%', background: bg, padding: 20, boxSizing: 'border-box' }}
    >
      <div className="siri-content-inner" style={{ background: bg }}>

        {/* Fixed header */}
        <div style={{ flexShrink: 0, padding: '16px 24px 0' }}>
          <Welcome
            icon={<BookOutlined style={{ fontSize: 26, color: '#52c41a' }} />}
            title="企业知识库智能问答 (RAG)"
            description="本地向量数据库已装载城投合规资料，支持自然语言检索与智能归纳问答。"
            style={{
              background: isDarkMode
                ? 'linear-gradient(135deg,#111827,#1f2937)'
                : 'linear-gradient(135deg,#f6ffed,#e6f7ff)',
              border, borderRadius: 8, marginBottom: 10,
            }}
          />
          {turns.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Button
                size="small" type="text" danger icon={<DeleteOutlined />}
                onClick={handleClear} disabled={loading}
              >
                清空对话
              </Button>
            </div>
          )}
          {isEmpty && (
            <Prompts
              title="您可以试着这样提问 👇"
              items={QUICK_PROMPTS}
              onItemClick={handlePromptClick}
              wrap
              style={{ marginBottom: 10 }}
            />
          )}
        </div>

        {/* Message area */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 24px 8px' }}>
          {turns.map(msg => (
            <KBTurn key={msg.id} msg={msg} loading={loading} isDarkMode={isDarkMode} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Fixed input */}
        <div style={{ flexShrink: 0, padding: '8px 24px 16px', borderTop: border }}>
          {loading && (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <Button danger type="dashed" icon={<StopOutlined />} onClick={handleStop} size="small">
                停止生成
              </Button>
            </div>
          )}
          <Sender
            value={senderValue}
            onChange={setSenderValue}
            onSubmit={doQuery}
            loading={loading}
            disabled={loading}
            placeholder="输入您对城投合规、三重一大的疑问，Enter 发送"
            style={{ borderRadius: 8 }}
          />
        </div>
      </div>
    </div>
  );
}
