import React, { useState, useEffect } from 'react';
import {
    Tabs, Upload, Button, Table, Tag, Space, Typography,
    Card, Empty, Modal, Input, Tooltip,
    Badge, Avatar,
} from 'antd';
import {
    DeleteOutlined,
    FilePdfOutlined, FileWordOutlined, FileTextOutlined,
    BookOutlined, FolderOpenOutlined, ShareAltOutlined,
    SearchOutlined,
    CheckCircleOutlined, SafetyCertificateOutlined,
    UserOutlined, LockOutlined, RobotOutlined, EyeOutlined, InfoCircleOutlined,
    LoadingOutlined, ThunderboltOutlined, DatabaseOutlined,
    DisconnectOutlined, EditOutlined,
} from '@ant-design/icons';
import { message } from 'antd';
import OfficeEditor from '../components/OfficeEditor';
import DocxPreviewModal from '../components/DocxPreviewModal';
import { fetchJson, loadDemoAssets } from '../lib/demoApi';
import { authFetch, authHeaders, authFetchJson } from '../lib/auth';

const { Text } = Typography;
const { Dragger } = Upload;

const EMPTY_USER = { name: '未登录用户', role: 'staff', dept: '合规法务部' };

function categorizeFiles(files) {
    return {
        cases: files.filter(file => file.libraryCategory === 'cases' || file.type === 'case' || file.tags?.includes('案例')),
        knowledge: files.filter(file => file.libraryCategory === 'knowledge' || (file.libraryCategory == null && file.type !== 'case' && !file.tags?.includes('案例') && !file.tags?.includes('共享'))),
        shared: files.filter(file => file.libraryCategory === 'shared' || file.tags?.includes('共享')),
    };
}

const getFileIcon = (type) => {
    if (type === 'pdf') return <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
    if (type === 'docx') return <FileWordOutlined style={{ color: '#1677ff', fontSize: 18 }} />;
    return <FileTextOutlined style={{ color: '#888', fontSize: 18 }} />;
};

function getLibraryTheme(isDarkMode) {
    const borderColor = isDarkMode ? '#374151' : 'rgba(15,23,42,0.08)';
    return {
        pageBg: isDarkMode
            ? 'linear-gradient(180deg, #0f172a 0%, #111827 100%)'
            : 'linear-gradient(180deg, #f8fbff 0%, #eef3f9 100%)',
        panelBg: isDarkMode
            ? 'linear-gradient(180deg, rgba(17,24,39,0.98) 0%, rgba(15,23,42,0.98) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,250,252,0.98) 100%)',
        softBg: isDarkMode
            ? 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(17,24,39,0.98) 100%)'
            : 'linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(241,245,249,0.98) 100%)',
        border: `1px solid ${borderColor}`,
        textPrimary: isDarkMode ? '#f8fafc' : '#0f172a',
        textSecondary: isDarkMode ? '#94a3b8' : '#667085',
        textMuted: isDarkMode ? '#64748b' : '#98a2b3',
        shadow: isDarkMode ? '0 18px 40px rgba(2,6,23,0.34)' : '0 18px 40px rgba(15,23,42,0.06)',
        strongShadow: isDarkMode ? '0 24px 56px rgba(2,6,23,0.4)' : '0 24px 56px rgba(15,23,42,0.08)',
        topHighlight: isDarkMode ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'inset 0 1px 0 rgba(255,255,255,0.92)',
    };
}

function HintIcon({ title, isDarkMode }) {
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

const UploaderCell = ({ record }) => {
    const isAdmin = record.uploaderRole === 'admin';
    return (
        <Space size={6}>
            <Avatar
                size={24}
                icon={isAdmin ? <SafetyCertificateOutlined /> : <UserOutlined />}
                style={{ background: isAdmin ? '#1677ff' : '#8c8c8c', flexShrink: 0 }}
            />
            <div style={{ lineHeight: 1.3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 13 }}>{record.uploader}</Text>
                    {isAdmin && (
                        <Tag color="blue" style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>官方</Tag>
                    )}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>{record.dept}</Text>
            </div>
        </Space>
    );
};

function DocTable({ data, setData, isDarkMode, onKbChange, onEdit, onPreviewDocx, currentUser, tabKey }) {
    const [search, setSearch] = useState('');
    const theme = getLibraryTheme(isDarkMode);
    const border = theme.border;
    const isAdmin = currentUser?.role === 'admin';
    const canDelete = (rec) => isAdmin || rec.uploader === currentUser?.name;

    const filtered = data.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.tags.some(t => t.includes(search)) ||
        r.uploader.includes(search)
    );

    const handleDelete = (id, rec) => {
        if (!canDelete(rec)) { message.warning('仅上传者或系统管理员可删除此文件'); return; }
        Modal.confirm({
            title: '确认删除',
            content: `删除"${rec.name}"后无法恢复，是否继续？`,
            okText: '删除', okType: 'danger',
            onOk: async () => {
                try {
                    await authFetch(`/api/knowledge_files/${id}`, { method: 'DELETE' });
                } catch (_) {}
                setData(prev => prev.filter(r => r.id !== id));
            },
        });
    };

    // Real vectorization: call /ingest_file with a dummy blob of the parsed text
    const handleToggleLink = async (rec) => {
        if (rec.vectorizing) return;

        if (rec.vectorized) {
            // Already vectorized — just toggle UI (we can't easily remove from ChromaDB without knowing IDs)
            try {
                const r = await authFetch(`/api/knowledge_files/${rec.id}/link`, { method: 'POST' });
                if (r.ok) {
                    const d = await r.json();
                    setData(prev => prev.map(r => r.id === rec.id ? { ...r, linked: d.linked } : r));
                    message.info(d.linked ? '已重新关联到合规问答' : '已取消关联（向量数据保留在知识库中）');
                }
            } catch (_) {}
            onKbChange?.();
            return;
        }

        // Not yet vectorized — call backend API
        if (!rec.parsedText) {
            message.warning('请先上传文件或等待解析完成后再关联');
            return;
        }

        // Mark as vectorizing
        setData(prev => prev.map(r => r.id === rec.id ? { ...r, vectorizing: true } : r));
        message.loading({ content: `正在向量化"${rec.name}"并入库...`, key: rec.id, duration: 0 });

        try {
            // Call backend API to vectorize
            const res = await authFetch(`/api/knowledge_files/${rec.id}/vectorize`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const result = await res.json();
            setData(prev => prev.map(r =>
                r.id === rec.id ? { ...r, vectorizing: false, vectorized: result.vectorized, linked: result.linked } : r
            ));
            message.success({ content: result.vectorized ? `✅ "${rec.name}" 已入库` : `❌ "${rec.name}" 向量化失败`, key: rec.id, duration: 4 });
            onKbChange?.();
        } catch (e) {
            setData(prev => prev.map(r => r.id === rec.id ? { ...r, vectorizing: false } : r));
            message.error({ content: `入库失败：${e.message}`, key: rec.id, duration: 4 });
        }
    };

    const handleUpload = async (file) => {
        // Get the actual File object — Ant Design wraps it as RcFile
        const actualFile = file.originFileObj || file;
        const ext = actualFile.name.split('.').pop().toLowerCase();
        const id = `u_${Date.now()}`;
        const newDoc = {
            id, name: actualFile.name,
            type: ext === 'pdf' ? 'pdf' : 'docx',
            size: `${Math.round(actualFile.size / 1024)} KB`,
            date: new Date().toISOString().slice(0, 10),
            tags: ['新上传'],
            linked: false, vectorized: false,
            uploader: currentUser?.name || EMPTY_USER.name,
            uploaderRole: currentUser?.role || EMPTY_USER.role,
            dept: currentUser?.dept || EMPTY_USER.dept,
            libraryCategory: tabKey || 'knowledge',
            parsedText: null, parsing: true,
            savedName: null,
        };
        setData(prev => {
                const updated = [newDoc, ...prev];
                authFetch('/api/knowledge_files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newDoc),
                }).catch(err => console.warn('[Upload] 知识文库记录创建失败:', err));
                return updated;
            });
        message.loading({ content: `正在解析 ${actualFile.name}...`, key: id, duration: 0 });

        try {
            // For Office files, also upload to editable docs store
            let savedName = null;
            if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'].includes(ext)) {
                try {
                    const fdUpload = new FormData();
                    fdUpload.append('file', actualFile, actualFile.name);
                    const rUpload = await authFetch('/api/doc/upload', { method: 'POST', body: fdUpload });
                    if (rUpload.ok) {
                        const bodyText = await rUpload.text();
                        if (bodyText) {
                            const dUpload = JSON.parse(bodyText);
                            savedName = dUpload.saved_as;
                        }
                    } else {
                        console.warn('[Upload] doc/upload failed:', rUpload.status, await rUpload.text());
                    }
                } catch (_) {
                    // Non-critical: editing won't be available
                }
            }

            // Step 1: Parse
            const fd1 = new FormData();
            fd1.append('file', actualFile, actualFile.name);
            const r1 = await authFetch('/parse_file', { method: 'POST', body: fd1 });
            if (!r1.ok) throw new Error('解析失败');
            const d1 = await r1.json();

            setData(prev => prev.map(r => r.id === id ? { ...r, parsedText: d1.text, parsing: false, savedName } : r));

            // Update backend record (now with parsedText)
            authFetch(`/api/knowledge_files/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, name: actualFile.name, type: ext === 'pdf' ? 'pdf' : 'docx', size: `${Math.round(actualFile.size / 1024)} KB`, date: new Date().toISOString().slice(0, 10), tags: ['新上传'], linked: false, vectorized: false, uploader: currentUser?.name || EMPTY_USER.name, uploaderRole: currentUser?.role || EMPTY_USER.role, dept: currentUser?.dept || EMPTY_USER.dept, libraryCategory: tabKey || 'knowledge', parsedText: d1.text, savedName }),
            }).catch(err => console.warn('[Upload] 知识文库记录更新失败(parse):', err));

            // Step 2: Auto-vectorize
            message.loading({ content: `正在向量化并入库 ${actualFile.name}...`, key: id, duration: 0 });
            const blob = new Blob([d1.text], { type: 'text/plain' });
            const fd2 = new FormData();
            fd2.append('file', blob, actualFile.name + '.txt');
            const r2 = await authFetch('/ingest_file', { method: 'POST', body: fd2 });

            if (r2.ok) {
                const d2 = await r2.json();
                const updatedTags = savedName ? ['新上传', '已入库', '可编辑'] : ['新上传', '已入库'];
                setData(prev => prev.map(r =>
                    r.id === id ? { ...r, vectorized: true, linked: true, tags: updatedTags } : r
                ));
                authFetch(`/api/knowledge_files/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vectorized: true, linked: true, tags: updatedTags }),
                }).catch(err => console.warn('[Upload] 知识文库记录更新失败(vectorize):', err));
                message.success({
                    content: savedName
                        ? `✅ ${actualFile.name} 解析完成（${d1.char_count.toLocaleString()} 字符），向量化 ${d2.chunks} 片段入库，已关联合规问答，可在线编辑`
                        : `✅ ${actualFile.name} 解析完成（${d1.char_count.toLocaleString()} 字符），向量化 ${d2.chunks} 片段入库，已关联合规问答`,
                    key: id, duration: 5
                });
                onKbChange?.();
            } else {
                setData(prev => prev.map(r =>
                    r.id === id ? { ...r, tags: savedName ? ['新上传', '待入库', '可编辑'] : ['新上传', '待入库'] } : r
                ));
                message.warning({ content: `${actualFile.name} 解析完成，但向量化失败，请手动点击"关联"重试`, key: id, duration: 5 });
            }
        } catch (e) {
            setData(prev => prev.map(r => r.id === id ? { ...r, parsing: false } : r));
            message.error({ content: `${actualFile.name} 上传失败：${e.message}`, key: id, duration: 4 });
        }
        return false;
    };

    const columns = [
        {
            title: '文件名', dataIndex: 'name',
            render: (name, rec) => (
                <Space>
                    {getFileIcon(rec.type)}
                    {rec.uploaderRole === 'admin' && (
                        <Tooltip title="系统管理员上传的官方文件，受保护">
                            <LockOutlined style={{ color: '#1677ff', fontSize: 12 }} />
                        </Tooltip>
                    )}
                    <Text style={{ maxWidth: 260 }} ellipsis={{ tooltip: name }}>{name}</Text>
                    {rec.parsing && <Tag icon={<LoadingOutlined />} color="processing">解析中</Tag>}
                    {rec.vectorizing && <Tag icon={<LoadingOutlined />} color="purple">向量化中</Tag>}
                </Space>
            ),
        },
        { title: '上传人', width: 160, render: (_, rec) => <UploaderCell record={rec} /> },
        {
            title: '标签', dataIndex: 'tags', width: 170,
            render: tags => tags.map(t => (
                <Tag key={t} color={t === '已入库' ? 'success' : t === '待入库' ? 'warning' : 'geekblue'} style={{ marginBottom: 2 }}>{t}</Tag>
            )),
        },
        { title: '大小', dataIndex: 'size', width: 80, align: 'center' },
        { title: '上传日期', dataIndex: 'date', width: 110, align: 'center' },
        {
            title: '合规问答关联',
            dataIndex: 'linked', width: 130, align: 'center',
            render: (linked, rec) => {
                if (rec.parsing || rec.vectorizing) {
                    return <Tag icon={<LoadingOutlined />} color="processing">处理中</Tag>;
                }
                if (rec.vectorized && linked) {
                    return (
                        <Tooltip title="已向量化入库，合规问答可检索 · 点击取消关联">
                            <Tag color="success" icon={<CheckCircleOutlined />} style={{ cursor: 'pointer' }} onClick={() => handleToggleLink(rec)}>
                                已关联
                            </Tag>
                        </Tooltip>
                    );
                }
                if (rec.vectorized && !linked) {
                    return (
                        <Tooltip title="已入库但未关联 · 点击重新关联">
                            <Tag color="warning" style={{ cursor: 'pointer' }} onClick={() => handleToggleLink(rec)}>
                                未关联
                            </Tag>
                        </Tooltip>
                    );
                }
                return (
                    <Tooltip title={rec.parsedText ? '点击向量化并关联到合规问答' : '请先上传文件以获取内容'}>
                        <Tag
                            color={rec.parsedText ? 'default' : 'default'}
                            style={{ cursor: rec.parsedText ? 'pointer' : 'not-allowed', opacity: rec.parsedText ? 1 : 0.5 }}
                            onClick={() => rec.parsedText && handleToggleLink(rec)}
                            icon={<ThunderboltOutlined />}
                        >
                            {rec.parsedText ? '点击入库' : '未解析'}
                        </Tag>
                    </Tooltip>
                );
            },
        },
        {
            title: '操作', width: 160, align: 'center',
            render: (_, rec) => (
                <Space size="small">
                    {rec.savedName && rec.type === 'docx' && (
                        <Tooltip title="按 Word 版式预览 DOCX">
                            <Button size="small" icon={<EyeOutlined />} onClick={() => onPreviewDocx?.(rec)}>
                                预览
                            </Button>
                        </Tooltip>
                    )}
                    {rec.savedName && (
                        <Tooltip title="在 OnlyOffice 中在线编辑">
                            <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => onEdit?.(rec)}>
                                编辑
                            </Button>
                        </Tooltip>
                    )}
                    {!rec.parsing && rec.parsedText && (
                        <Tooltip title="预览解析文本">
                            <Button size="small" icon={<EyeOutlined />} onClick={() => Modal.info({
                                title: rec.name, width: 720,
                                content: (
                                    <div style={{ maxHeight: 480, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, fontFamily: 'monospace', lineHeight: 1.7 }}>
                                        {rec.parsedText}
                                    </div>
                                ),
                            })} />
                        </Tooltip>
                    )}
                    <Tooltip title={canDelete(rec) ? '删除' : '无删除权限'}>
                        <Button size="small" danger icon={<DeleteOutlined />} disabled={!canDelete(rec)} onClick={() => handleDelete(rec.id, rec)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    const linkedCount = data.filter(r => r.linked && r.vectorized).length;
    const vectorizedCount = data.filter(r => r.vectorized).length;
    const stats = [
        { label: '文档总数', value: `${data.length} 份`, tone: '#1677ff' },
        { label: '已向量化', value: `${vectorizedCount} 份`, tone: '#7c3aed' },
        { label: '已关联问答', value: `${linkedCount} 份`, tone: '#16a34a' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) minmax(260px, 1.4fr)',
                    gap: 12,
                }}
            >
                {stats.map((item) => (
                    <Card
                        key={item.label}
                        bordered={false}
                        style={{
                            borderRadius: 22,
                            background: theme.panelBg,
                            border,
                            boxShadow: theme.shadow,
                        }}
                        styles={{ body: { padding: 18 } }}
                    >
                        <div style={{ fontSize: 12, color: theme.textSecondary }}>{item.label}</div>
                        <div style={{ marginTop: 8, fontSize: 28, lineHeight: 1.05, fontWeight: 700, color: theme.textPrimary }}>
                            {item.value}
                        </div>
                        <div style={{ marginTop: 10, width: 44, height: 4, borderRadius: 999, background: item.tone, opacity: 0.9 }} />
                    </Card>
                ))}

                <Card
                    bordered={false}
                    style={{
                        borderRadius: 22,
                        background: linkedCount > 0
                            ? 'linear-gradient(135deg, rgba(22,163,74,0.1) 0%, rgba(255,255,255,0.96) 100%)'
                            : theme.panelBg,
                        border,
                        boxShadow: theme.shadow,
                    }}
                    styles={{ body: { padding: 18 } }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            style={{
                                width: 42,
                                height: 42,
                                borderRadius: 16,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: linkedCount > 0 ? 'rgba(22,163,74,0.14)' : 'rgba(148,163,184,0.14)',
                            }}
                        >
                            <RobotOutlined style={{ color: linkedCount > 0 ? '#16a34a' : theme.textMuted, fontSize: 18 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: theme.textSecondary }}>知识问答检索状态</div>
                            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: theme.textPrimary }}>
                                {linkedCount > 0 ? `${linkedCount} 份文档已可检索` : '当前暂无已关联文档'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                <span style={{ fontSize: 12, color: theme.textSecondary }}>自动入库</span>
                                <HintIcon title="上传后自动解析并入库，业务侧可直接在合规问答中调用。" isDarkMode={isDarkMode} />
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <Card
                bordered={false}
                style={{
                    borderRadius: 24,
                    background: theme.panelBg,
                    border,
                    boxShadow: theme.strongShadow,
                }}
                styles={{ body: { padding: 18 } }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(260px, 0.8fr)', gap: 14 }}>
                    <Dragger
                        className="knowledge-dragger"
                        accept=".pdf,.docx,.doc,.txt"
                        multiple
                        beforeUpload={handleUpload}
                        showUploadList={false}
                        style={{
                            borderRadius: 22,
                            border: `1px dashed ${isDarkMode ? '#475569' : '#cbd5e1'}`,
                            background: theme.softBg,
                            marginBottom: 0,
                        }}
                    >
                        <p style={{ marginBottom: 10 }}>
                            <DatabaseOutlined style={{ fontSize: 28, color: '#6d5efc' }} />
                        </p>
                        <p style={{ marginBottom: 8 }}>
                            <Text strong style={{ color: theme.textPrimary }}>上传文件</Text>
                        </p>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>PDF / Word / TXT</Text>
                            <HintIcon title="上传后自动解析、向量化并接入问答检索。" isDarkMode={isDarkMode} />
                        </div>
                    </Dragger>

                    <div
                        style={{
                            borderRadius: 22,
                            background: theme.softBg,
                            border,
                            boxShadow: theme.topHighlight,
                            padding: 18,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 12,
                        }}
                    >
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.textSecondary }}>
                                <span>快速检索</span>
                                <HintIcon title="用于快速定位案例、制度或共享资料，当前结果实时过滤下方表格。" isDarkMode={isDarkMode} />
                            </div>
                            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: theme.textPrimary }}>
                                按文件名、上传人或标签筛选
                            </div>
                        </div>

                        <Input
                            prefix={<SearchOutlined style={{ color: theme.textMuted }} />}
                            placeholder="搜索文件名、上传人或标签"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="knowledge-search"
                            allowClear
                        />
                    </div>
                </div>
            </Card>

            <Card
                bordered={false}
                style={{
                    borderRadius: 24,
                    background: theme.panelBg,
                    border,
                    boxShadow: theme.shadow,
                }}
                styles={{ body: { padding: 12 } }}
            >
                <Table
                    className="knowledge-doc-table"
                    columns={columns}
                    dataSource={filtered}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 8, showSizeChanger: false }}
                    rowClassName={(rec) => rec.uploaderRole === 'admin' ? 'admin-row' : ''}
                    locale={{ emptyText: <Empty description="暂无文档" /> }}
                />
            </Card>
        </div>
    );
}

export default function KnowledgeLibrary({ isDarkMode = true }) {
    const [caseData, setCaseData] = useState([]);
    const [knowledgeData, setKnowledgeData] = useState([]);
    const [sharedData, setSharedData] = useState([]);
    const [kbStats, setKbStats] = useState(null);
    const [currentUser, setCurrentUser] = useState(EMPTY_USER);
    const [activeTab, setActiveTab] = useState('knowledge');

    // OnlyOffice editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorFile, setEditorFile] = useState(null); // { savedName, name }
    const [previewFile, setPreviewFile] = useState(null); // { savedName, name }

    const theme = getLibraryTheme(isDarkMode);
    const bg = theme.pageBg;
    const border = theme.border;

    const fetchKbStats = async () => {
        try {
            const data = await fetchJson('/api/kb_stats');
            setKbStats(data);
        } catch (_) { }
    };

    useEffect(() => {
        let alive = true;
        const boot = async () => {
            fetchKbStats();

            // 1) Try to get the real logged-in user from auth
            let realUser = null;
            try {
                const authMe = await authFetchJson('/api/auth/me');
                if (authMe?.success && authMe?.user) {
                    realUser = {
                        name: authMe.user.name || authMe.user.username,
                        role: authMe.user.role || 'staff',
                        dept: authMe.user.dept || '合规法务部',
                    };
                }
            } catch (_) {
                // Auth may not be set up yet — will fall back to demo user
            }

            // 2) Load demo assets and knowledge files in parallel
            let demoUser = EMPTY_USER;
            let files = [];
            try {
                const [demoAssets, knowledgeFiles] = await Promise.all([
                    loadDemoAssets(),
                    fetchJson('/api/knowledge_files'),
                ]);
                if (!alive) return;
                // Use real user if available, otherwise demo user, otherwise empty
                demoUser = realUser
                    || demoAssets?.knowledgeLibrary?.currentUser
                    || demoAssets?.user
                    || EMPTY_USER;
                files = knowledgeFiles?.files?.length
                    ? knowledgeFiles.files
                    : (demoAssets?.knowledgeLibrary?.seedFiles || []);
            } catch (error) {
                if (!alive) return;
                // Even if demo/assets fails, try to use real user and empty file list
                if (realUser) {
                    demoUser = realUser;
                }
                console.warn('知识文库：部分资源加载失败，将使用离线模式', error.message);
            }

            setCurrentUser(demoUser);
            const categorized = categorizeFiles(files);
            setCaseData(categorized.cases);
            setKnowledgeData(categorized.knowledge);
            setSharedData(categorized.shared);
        };
        boot();
        return () => { alive = false; };
    }, []);

    const handleEditDoc = (rec) => {
        if (!rec.savedName) {
            message.warning('该文件未保存到编辑区，请重新上传');
            return;
        }
        setEditorFile({ savedName: rec.savedName, name: rec.name });
        setEditorOpen(true);
    };

    const handleEditorClose = () => {
        setEditorOpen(false);
        setEditorFile(null);
    };

    const handlePreviewDocx = (rec) => {
        if (!rec.savedName) {
            message.warning('该文件未保存到预览区，请重新上传');
            return;
        }
        setPreviewFile({ savedName: rec.savedName, name: rec.name });
    };

    const allData = [...caseData, ...knowledgeData, ...sharedData];
    const totalLinked = allData.filter(r => r.linked && r.vectorized).length;

    const tabItems = [
        {
            key: 'cases',
            label: (
                <span><FolderOpenOutlined /> 案例文库 <Badge count={caseData.length} size="small" style={{ marginLeft: 6, background: '#722ed1' }} /></span>
            ),
            children: <DocTable tabKey="cases" data={caseData} setData={setCaseData} isDarkMode={isDarkMode} onKbChange={fetchKbStats} onEdit={handleEditDoc} onPreviewDocx={handlePreviewDocx} currentUser={currentUser} />,
        },
        {
            key: 'knowledge',
            label: (
                <span><BookOutlined /> 知识文库 <Badge count={knowledgeData.length} size="small" style={{ marginLeft: 6, background: '#1677ff' }} /></span>
            ),
            children: <DocTable tabKey="knowledge" data={knowledgeData} setData={setKnowledgeData} isDarkMode={isDarkMode} onKbChange={fetchKbStats} onEdit={handleEditDoc} onPreviewDocx={handlePreviewDocx} currentUser={currentUser} />,
        },
        {
            key: 'shared',
            label: (
                <span><ShareAltOutlined /> 共享文库 <Badge count={sharedData.length} size="small" style={{ marginLeft: 6, background: '#52c41a' }} /></span>
            ),
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div
                        style={{
                            borderRadius: 20,
                            border,
                            background: theme.softBg,
                            boxShadow: theme.shadow,
                            padding: '14px 16px',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>共享文库</div>
                            <HintIcon title="全员可访问的公共文档区域。上传文件会自动解析并向量化入库，可被企业合规问答实时检索调用。" isDarkMode={isDarkMode} />
                        </div>
                    </div>
                    <DocTable tabKey="shared" data={sharedData} setData={setSharedData} isDarkMode={isDarkMode} onKbChange={fetchKbStats} onEdit={handleEditDoc} onPreviewDocx={handlePreviewDocx} currentUser={currentUser} />
                </div>
            ),
        },
    ];

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20, boxSizing: 'border-box', background: bg }}>
            {/* KB Status bar */}
            {kbStats && (
                <div style={{
                    marginBottom: 12,
                    padding: '12px 16px',
                    borderRadius: 18,
                    border,
                    background: kbStats.available
                        ? 'linear-gradient(135deg, rgba(22,163,74,0.1) 0%, rgba(255,255,255,0.96) 100%)'
                        : 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(255,255,255,0.96) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    boxShadow: theme.shadow,
                }}>
                    {kbStats.available
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : <DisconnectOutlined style={{ color: '#ff4d4f' }} />
                    }
                    <Text style={{ fontSize: 13, color: theme.textPrimary }}>
                        <Text strong>向量知识库</Text>
                        {kbStats.available
                            ? <Text style={{ color: '#52c41a' }}>已就绪 · 共 {kbStats.count} 个语义片段 · 合规问答可实时检索</Text>
                            : <Text style={{ color: '#ff4d4f' }}>未就绪 · {kbStats.message}</Text>
                        }
                    </Text>
                </div>
            )}

            <div
                style={{
                    flexShrink: 0,
                    marginBottom: 14,
                    padding: 22,
                    borderRadius: 26,
                    border,
                    background: 'linear-gradient(135deg, rgba(109,94,252,0.12) 0%, rgba(53,99,233,0.08) 36%, rgba(255,255,255,0.96) 100%)',
                    boxShadow: theme.strongShadow,
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        inset: 'auto -40px -60px auto',
                        width: 220,
                        height: 220,
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(109,94,252,0.16) 0%, rgba(109,94,252,0) 70%)',
                        pointerEvents: 'none',
                    }}
                />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', position: 'relative' }}>
                    <div style={{ maxWidth: 680 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                                style={{
                                    width: 52,
                                    height: 52,
                                    borderRadius: 18,
                                    background: 'linear-gradient(135deg, #4f7cff 0%, #6d5efc 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 16px 34px rgba(79,124,255,0.22)',
                                }}
                            >
                                <BookOutlined style={{ fontSize: 24, color: '#fff' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: theme.textSecondary }}>Knowledge Workspace</div>
                                <div style={{ marginTop: 2, fontSize: 28, lineHeight: 1.1, fontWeight: 700, color: theme.textPrimary }}>
                                    知识文库管理
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                            <div style={{ fontSize: 14, color: theme.textSecondary }}>
                                {currentUser.name} · {currentUser.dept}
                            </div>
                            <HintIcon title="上传的制度、案例与共享资料会自动解析、向量化入库，并可直接接入企业合规问答。" isDarkMode={isDarkMode} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: 10, minWidth: 320, flex: '1 1 360px' }}>
                        {[
                            { label: '已关联文档', value: `${totalLinked} 份` },
                            { label: '当前用户角色', value: currentUser.role === 'admin' ? '管理员' : '业务用户' },
                            { label: '知识片段总量', value: kbStats?.available ? `${kbStats.count}` : '未就绪' },
                        ].map((item) => (
                            <div
                                key={item.label}
                                style={{
                                    borderRadius: 18,
                                    padding: '14px 16px',
                                    background: theme.panelBg,
                                    border,
                                    boxShadow: theme.shadow,
                                }}
                            >
                                <div style={{ fontSize: 12, color: theme.textSecondary }}>{item.label}</div>
                                <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: theme.textPrimary }}>
                                    {item.value}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <div
                    style={{
                        minHeight: '100%',
                        borderRadius: 28,
                        border,
                        background: theme.panelBg,
                        boxShadow: theme.strongShadow,
                        overflow: 'hidden',
                    }}
                >
                    <Tabs
                        className="knowledge-tabs"
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={tabItems}
                        size="large"
                        style={{ background: 'transparent', padding: 14 }}
                        tabBarStyle={{ padding: '2px 8px 0' }}
                    />
                </div>
            </div>

            <style>{`
        .admin-row td { background: ${isDarkMode ? 'rgba(22,119,255,0.04)' : 'rgba(22,119,255,0.035)'} !important; }
        .admin-row:hover td { background: ${isDarkMode ? 'rgba(22,119,255,0.09)' : 'rgba(22,119,255,0.075)'} !important; }
        .knowledge-tabs .ant-tabs-nav::before { border-bottom-color: ${isDarkMode ? 'rgba(71,85,105,0.45)' : 'rgba(15,23,42,0.08)'}; }
        .knowledge-tabs .ant-tabs-tab {
            border-radius: 14px 14px 0 0;
            transition: all 180ms ease;
            padding-inline: 14px;
        }
        .knowledge-tabs .ant-tabs-tab-active {
            background: ${isDarkMode ? 'rgba(17,24,39,0.9)' : 'rgba(255,255,255,0.92)'};
        }
        .knowledge-tabs .ant-tabs-content-holder {
            padding: 6px 2px 2px;
        }
        .knowledge-doc-table .ant-table {
            background: transparent;
        }
        .knowledge-doc-table .ant-table-container table > thead > tr > th {
            background: ${isDarkMode ? 'rgba(15,23,42,0.88)' : 'rgba(248,250,252,0.88)'};
            color: ${theme.textSecondary};
            font-size: 12px;
        }
        .knowledge-doc-table .ant-table-tbody > tr > td {
            border-bottom-color: ${isDarkMode ? 'rgba(71,85,105,0.24)' : 'rgba(15,23,42,0.06)'};
        }
        .knowledge-doc-table .ant-table-tbody > tr:hover > td {
            background: ${isDarkMode ? 'rgba(17,24,39,0.86)' : 'rgba(248,250,252,0.86)'} !important;
        }
        .knowledge-search.ant-input-affix-wrapper {
            border-radius: 14px;
            border-color: ${isDarkMode ? '#475569' : '#d7deea'};
            background: ${isDarkMode ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.94)'};
            box-shadow: ${theme.topHighlight};
        }
        .knowledge-dragger.ant-upload-wrapper .ant-upload-drag {
            border-radius: 22px;
            border-color: ${isDarkMode ? '#475569' : '#cbd5e1'};
            background: transparent;
            box-shadow: ${theme.topHighlight};
        }
      `}</style>

            {/* OnlyOffice 文档编辑器 */}
            <OfficeEditor
                open={editorOpen}
                savedName={editorFile?.savedName}
                onClose={handleEditorClose}
                onSave={() => message.success('文档已保存')}
            />

            <DocxPreviewModal
                open={Boolean(previewFile)}
                savedName={previewFile?.savedName}
                title={previewFile?.name || 'DOCX 预览'}
                onClose={() => setPreviewFile(null)}
            />
        </div>
    );
}
