import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message, Popconfirm } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, ExclamationCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { authFetchJson } from '../lib/auth';

const { Text, Title } = Typography;
const { Option } = Select;

const STATUS_OPTIONS = ['待处理', '进行中', '已完成', '已取消'];
const PRIORITY_OPTIONS = ['高', '中', '低'];

const STATUS_COLORS = {
  '待处理': 'blue',
  '进行中': 'orange',
  '已完成': 'green',
  '已取消': 'default',
};

const PRIORITY_COLORS = {
  '高': 'red',
  '中': 'gold',
  '低': 'default',
};

export default function TodoDashboard({ isDarkMode = false, currentUser = null, onNavigate }) {
  const [todos, setTodos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [editModal, setEditModal] = useState({ open: false, todo: null });
  const [editForm, setEditForm] = useState({ task: '', owner: '', deadline: '', priority: '中', status: '待处理' });

  const palette = useMemo(() => isDarkMode ? {
    bg: '#1a1a2e', card: '#16213e', text: '#e0e0e0', border: '#2a2a4a',
    accent: '#4fc3f7', danger: '#ef5350', success: '#66bb6a',
  } : {
    bg: '#f5f7fa', card: '#ffffff', text: '#1a1a2e', border: '#e8e8e8',
    accent: '#1890ff', danger: '#ff4d4f', success: '#52c41a',
  }, [isDarkMode]);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      if (filterOwner) params.set('owner', filterOwner);
      const data = await authFetchJson(`/api/todos?${params.toString()}`);
      if (data.success) {
        setTodos(data.todos || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      message.error('加载待办失败：' + err.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, filterOwner]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  const handleStatusChange = async (todoId, newStatus) => {
    try {
      await authFetchJson(`/api/todos/${todoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      message.success(`已更新为「${newStatus}」`);
      fetchTodos();
    } catch (err) {
      message.error('更新失败：' + err.message);
    }
  };

  const handleDelete = async (todoId) => {
    try {
      await authFetchJson(`/api/todos/${todoId}`, { method: 'DELETE' });
      message.success('已删除');
      fetchTodos();
    } catch (err) {
      message.error('删除失败：' + err.message);
    }
  };

  const handleEdit = (todo) => {
    setEditForm({
      task: todo.task,
      owner: todo.owner,
      deadline: todo.deadline,
      priority: todo.priority,
      status: todo.status,
    });
    setEditModal({ open: true, todo });
  };

  const handleEditSave = async () => {
    try {
      await authFetchJson(`/api/todos/${editModal.todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      message.success('已更新');
      setEditModal({ open: false, todo: null });
      fetchTodos();
    } catch (err) {
      message.error('更新失败：' + err.message);
    }
  };

  // 统计
  const stats = useMemo(() => {
    const pending = todos.filter(t => t.status === '待处理').length;
    const inProgress = todos.filter(t => t.status === '进行中').length;
    const done = todos.filter(t => t.status === '已完成').length;
    const overdue = todos.filter(t => {
      if (!t.deadline || t.status === '已完成' || t.status === '已取消') return false;
      return new Date(t.deadline) < new Date();
    }).length;
    return { pending, inProgress, done, overdue };
  }, [todos]);

  const columns = [
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v) => <Tag color={PRIORITY_COLORS[v] || 'default'}>{v}</Tag>,
    },
    {
      title: '待办事项',
      dataIndex: 'task',
      ellipsis: true,
      render: (v, r) => (
        <div>
          <Text style={{ color: palette.text, textDecoration: r.status === '已完成' ? 'line-through' : 'none' }}>{v}</Text>
          {r.meetingTitle && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              来源：{r.meetingTitle}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '责任人',
      dataIndex: 'owner',
      width: 100,
    },
    {
      title: '截止时间',
      dataIndex: 'deadline',
      width: 120,
      render: (v, r) => {
        if (!v) return <span style={{ color: '#999' }}>未设置</span>;
        const isOverdue = new Date(v) < new Date() && r.status !== '已完成' && r.status !== '已取消';
        return <span style={{ color: isOverdue ? palette.danger : palette.text }}>{v}</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag>,
    },
    {
      title: '操作',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          {record.status === '待处理' && (
            <Button size="small" type="link" onClick={() => handleStatusChange(record.id, '进行中')}>
              开始
            </Button>
          )}
          {record.status === '进行中' && (
            <Button size="small" type="link" style={{ color: palette.success }} onClick={() => handleStatusChange(record.id, '已完成')}>
              完成
            </Button>
          )}
          {record.status === '已完成' && (
            <Button size="small" type="link" onClick={() => handleStatusChange(record.id, '待处理')}>
              重开
            </Button>
          )}
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="确认删除此待办？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: palette.bg, minHeight: '100vh' }}>
      <Title level={3} style={{ color: palette.text, marginBottom: 24 }}>待办跟踪</Title>

      {/* 统计卡片 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[
          { label: '待处理', value: stats.pending, icon: <ClockCircleOutlined />, color: '#1890ff' },
          { label: '进行中', value: stats.inProgress, icon: <ExclamationCircleOutlined />, color: '#fa8c16' },
          { label: '已完成', value: stats.done, icon: <CheckCircleOutlined />, color: '#52c41a' },
          { label: '已逾期', value: stats.overdue, icon: <ExclamationCircleOutlined />, color: '#ff4d4f' },
        ].map(s => (
          <Card key={s.label} size="small" style={{ flex: 1, background: palette.card, border: `1px solid ${palette.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24, color: s.color }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{s.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 16, background: palette.card, border: `1px solid ${palette.border}` }}>
        <Space wrap>
          <Select placeholder="状态" allowClear style={{ width: 120 }} value={filterStatus || undefined} onChange={v => setFilterStatus(v || '')}>
            {STATUS_OPTIONS.map(s => <Option key={s} value={s}>{s}</Option>)}
          </Select>
          <Select placeholder="优先级" allowClear style={{ width: 100 }} value={filterPriority || undefined} onChange={v => setFilterPriority(v || '')}>
            {PRIORITY_OPTIONS.map(p => <Option key={p} value={p}>{p}</Option>)}
          </Select>
          <Input placeholder="责任人" allowClear style={{ width: 120 }} value={filterOwner} onChange={e => setFilterOwner(e.target.value)} />
          <Button icon={<ReloadOutlined />} onClick={fetchTodos}>刷新</Button>
        </Space>
      </Card>

      {/* 待办列表 */}
      <Card style={{ background: palette.card, border: `1px solid ${palette.border}` }}>
        <Table
          className="todo-dashboard-table"
          dataSource={todos}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, total, showTotal: t => `共 ${t} 条` }}
          size="small"
        />
      </Card>

      <style>{`
        .todo-dashboard-table .ant-table-thead > tr > th {
          background: ${isDarkMode ? '#1e293b' : '#fafafa'} !important;
          color: ${isDarkMode ? '#e0e0e0' : '#1a1a2e'} !important;
          font-weight: 600;
          border-bottom: 1px solid ${isDarkMode ? '#2a2a4a' : '#e8e8e8'} !important;
        }
        .todo-dashboard-table .ant-table-tbody > tr > td {
          background: ${isDarkMode ? '#16213e' : '#ffffff'} !important;
          color: ${isDarkMode ? '#e0e0e0' : '#1a1a2e'} !important;
          border-bottom: 1px solid ${isDarkMode ? '#2a2a4a' : '#e8e8e8'} !important;
        }
        .todo-dashboard-table .ant-table-tbody > tr:hover > td {
          background: ${isDarkMode ? '#1a2744' : '#f0f7ff'} !important;
        }
      `}</style>

      {/* 编辑弹窗 */}
      <Modal
        title="编辑待办"
        open={editModal.open}
        onOk={handleEditSave}
        onCancel={() => setEditModal({ open: false, todo: null })}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text>待办内容</Text>
            <Input.TextArea rows={2} value={editForm.task} onChange={e => setEditForm(f => ({ ...f, task: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Text>责任人</Text>
              <Input value={editForm.owner} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <Text>截止时间</Text>
              <Input type="date" value={editForm.deadline} onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Text>优先级</Text>
              <Select value={editForm.priority} onChange={v => setEditForm(f => ({ ...f, priority: v }))} style={{ width: '100%' }}>
                {PRIORITY_OPTIONS.map(p => <Option key={p} value={p}>{p}</Option>)}
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <Text>状态</Text>
              <Select value={editForm.status} onChange={v => setEditForm(f => ({ ...f, status: v }))} style={{ width: '100%' }}>
                {STATUS_OPTIONS.map(s => <Option key={s} value={s}>{s}</Option>)}
              </Select>
            </div>
          </div>
        </Space>
      </Modal>
    </div>
  );
}
