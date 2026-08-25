import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message, Divider, List, Empty } from 'antd';
import { ApartmentOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import { authFetchJson, getStoredToken } from '../lib/auth';

const { Title, Text } = Typography;

const ROLE_OPTIONS = [
  { label: '管理员', value: 'admin' },
  { label: '业务用户', value: 'staff' },
  { label: '会议秘书', value: 'meeting_secretary' },
  { label: '会议主持人', value: 'meeting_chair' },
  { label: '董事 / 股东', value: 'board_member' },
  { label: '党委委员', value: 'party_member' },
  { label: '法务合规', value: 'legal' },
  { label: '审计监督', value: 'audit' },
  { label: '知识库管理员', value: 'knowledge_admin' },
];
const STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
];

const STATUS_COLORS = {
  active: 'success',
  disabled: 'default',
};

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map(option => [option.value, option.label]));
const roleLabel = value => ROLE_LABELS[value] || '业务用户';
const statusLabel = value => (value === 'active' ? '启用' : '停用');

export default function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [deptEditing, setDeptEditing] = useState(null);
  const [deptName, setDeptName] = useState('');
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [orgName, setOrgName] = useState('');
  const [exporting, setExporting] = useState(false);

  const exportAllData = useCallback(async () => {
    setExporting(true);
    try {
      const token = getStoredToken();
      const resp = await fetch('/api/export/meetings', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai616_export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('数据导出成功');
    } catch (err) {
      message.error('导出失败：' + err.message);
    } finally {
      setExporting(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await authFetchJson('/api/settings');
      if (data.success) setOrgName(data.orgName || '');
    } catch {}
  }, []);

  const saveOrgName = useCallback(async () => {
    try {
      await authFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName }),
      });
      message.success('单位名称已保存');
    } catch (err) {
      message.error('保存失败：' + err.message);
    }
  }, [orgName]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authFetchJson('/api/users');
      setUsers(data.users || []);
    } catch (err) {
      message.error(`用户列表加载失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDepartments = useCallback(async () => {
    try {
      const data = await authFetchJson('/api/departments');
      setDepartments(data.departments || []);
    } catch (err) {
      // 静默失败——部门列表不影响核心功能
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadDepartments();
    loadSettings();
  }, [loadUsers, loadDepartments, loadSettings]);

  const deptOptions = useMemo(
    () => departments.map(d => ({ label: d.name, value: d.name })),
    [departments],
  );

  // ── 部门管理操作 ─────────────────────────────────────────────────
  const openDeptCreate = () => {
    setDeptEditing(null);
    setDeptName('');
    setDeptModalOpen(true);
  };

  const openDeptRename = (dept) => {
    setDeptEditing(dept);
    setDeptName(dept.name);
    setDeptModalOpen(true);
  };

  const handleDeptSave = async () => {
    const name = deptName.trim();
    if (!name) return message.warning('请输入部门名称');
    try {
      if (deptEditing) {
        await authFetchJson(`/api/departments/${deptEditing.id}`, {
          method: 'PUT', body: JSON.stringify({ name }),
        });
        message.success(`部门已重命名为「${name}」`);
      } else {
        await authFetchJson('/api/departments', {
          method: 'POST', body: JSON.stringify({ name }),
        });
        message.success(`部门「${name}」已创建`);
      }
      setDeptModalOpen(false);
      loadDepartments();
      loadUsers();
    } catch (err) {
      message.error(err.message || '操作失败');
    }
  };

  const handleDeptDelete = async (dept) => {
    try {
      await authFetchJson(`/api/departments/${dept.id}`, { method: 'DELETE' });
      message.success(`部门「${dept.name}」已删除`);
      loadDepartments();
      loadUsers();
    } catch (err) {
      message.error(err.message || '删除失败');
    }
  };

  const stats = useMemo(() => {
    const enabled = users.filter(item => item.status === 'active').length;
    const admins = users.filter(item => item.role === 'admin').length;
    const deptCount = departments.length;
    return [
      { label: '账号总数', value: users.length, icon: <TeamOutlined />, tone: 'blue' },
      { label: '启用账号', value: enabled, icon: <CheckCircleOutlined />, tone: 'green' },
      { label: '管理员', value: admins, icon: <SafetyCertificateOutlined />, tone: 'orange' },
      { label: '组织部门', value: deptCount, icon: <ApartmentOutlined />, tone: 'cyan' },
    ];
  }, [users]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'staff', status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({ ...record, password: '' });
    setModalOpen(true);
  };

  const handleDelete = async (record) => {
    try {
      await authFetchJson(`/api/users/${record.id}`, { method: 'DELETE' });
      message.success('用户已删除');
      loadUsers();
    } catch (err) {
      message.error(`删除失败：${err.message}`);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const url = editing ? `/api/users/${editing.id}` : '/api/users';
      const method = editing ? 'PUT' : 'POST';
      await authFetchJson(url, { method, body: JSON.stringify(values) });
      message.success(editing ? '用户已更新' : '用户已创建');
      setModalOpen(false);
      loadUsers();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.message);
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', width: 160, render: value => <Text strong style={{ color: 'var(--ui-text-1)' }}>{value}</Text> },
    { title: '用户名', dataIndex: 'username', width: 180, ellipsis: true },
    { title: '角色', dataIndex: 'role', width: 150, render: value => <Tag color={value === 'admin' ? 'blue' : 'geekblue'}>{roleLabel(value)}</Tag> },
    { title: '部门', dataIndex: 'dept', width: 190, ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 120, render: value => <Tag color={STATUS_COLORS[value] || 'default'}>{statusLabel(value)}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 190 },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size={8}>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除该用户？" onConfirm={() => handleDelete(record)} disabled={currentUser?.id === record.id}>
            <Button size="small" danger disabled={currentUser?.id === record.id}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="user-management-page">
      <section className="user-management-hero">
        <div className="user-management-title-wrap">
          <span className="user-management-icon"><TeamOutlined /></span>
          <div>
            <Title level={4} className="user-management-title">用户与权限管理</Title>
            <Text className="user-management-desc">维护账号、角色、状态和公司组织归属。</Text>
          </div>
        </div>
        <Space>
          <Button icon={<ApartmentOutlined />} onClick={openDeptCreate}>管理部门</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增用户</Button>
        </Space>
      </section>

      <section className="user-management-stats">
        {stats.map(item => (
          <div key={item.label} className={`user-management-stat is-${item.tone}`}>
            <span>{item.icon}</span>
            <div>
              <strong>{item.value}</strong>
              <em>{item.label}</em>
            </div>
          </div>
        ))}
      </section>

      <div className="user-management-card">
        <Table
          className="user-management-table"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1140 }}
          rowClassName={record => currentUser?.id === record.id ? 'is-current-user' : ''}
        />
      </div>

      {/* 系统设置 */}
      <div className="user-management-card" style={{ marginTop: 16, padding: 20 }}>
        <Title level={5} style={{ marginBottom: 16 }}>系统设置</Title>
        <Space align="end" size="middle" wrap>
          <div>
            <Text style={{ display: 'block', marginBottom: 4 }}>单位名称（归档公文发文机关）</Text>
            <Input
              placeholder="例如：XX集团有限公司"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              style={{ width: 320 }}
            />
          </div>
          <Button type="primary" onClick={saveOrgName}>保存</Button>
          <Button onClick={exportAllData} loading={exporting}>导出全部数据 (JSON)</Button>
        </Space>
      </div>

      <Modal
        open={modalOpen}
        title={editing ? '编辑用户' : '新增用户'}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText={editing ? '保存' : '创建'}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="密码" name="password" extra={editing ? '留空则保留原密码' : '请设置至少 6 位密码，不使用公共默认密码'}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="部门" name="dept" rules={[{ required: true, message: '请选择部门' }]}>
            <Select showSearch options={deptOptions} placeholder="选择部门" notFoundContent="暂无部门，请先创建" />
          </Form.Item>
          <Form.Item label="会议角色" name="meetingRole" extra="在会议中显示的角色，如'会议秘书''技术总监'等">
            <Input placeholder="参会代表" />
          </Form.Item>
          <Form.Item label="会议席位" name="meetingSeat" extra="席位编号，如 A01 / 主持主控席 / 移动端席位">
            <Input placeholder="自动分配" />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 部门管理弹窗 */}
      <Modal
        open={deptModalOpen}
        title={deptEditing ? '重命名部门' : '新建部门'}
        onCancel={() => setDeptModalOpen(false)}
        onOk={handleDeptSave}
        okText={deptEditing ? '保存' : '创建'}
      >
        <Form layout="vertical">
          <Form.Item label="部门名称">
            <Input
              value={deptName}
              onChange={e => setDeptName(e.target.value)}
              placeholder="输入部门名称"
              onPressEnter={handleDeptSave}
            />
          </Form.Item>
        </Form>
        <Divider style={{ margin: '12px 0' }} />
        <Text type="secondary" style={{ fontSize: 13 }}>现有部门</Text>
        {departments.length === 0 ? (
          <Empty description="暂无部门" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            size="small"
            style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}
            dataSource={[...departments].sort((a, b) => a.name.localeCompare(b.name, 'zh'))}
            renderItem={dept => (
              <List.Item
                actions={[
                  <Button key="rename" type="link" size="small" icon={<EditOutlined />} onClick={() => openDeptRename(dept)} />,
                  <Popconfirm key="del" title={`删除「${dept.name}」？有用户的部门无法删除`} onConfirm={() => handleDeptDelete(dept)}>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                {dept.name}
              </List.Item>
            )}
          />
        )}
      </Modal>

      <style>{`
        .user-management-page {
          height: 100%;
          padding: 18px;
          box-sizing: border-box;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          color: var(--ui-text-2);
        }

        .user-management-hero {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px;
          border: 1px solid var(--ui-border-2);
          border-radius: 16px;
          background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.9));
          box-shadow: var(--ui-shadow-panel);
        }

        .user-management-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .user-management-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--ui-primary-soft);
          color: var(--ui-primary);
          font-size: 20px;
          flex: 0 0 auto;
        }

        .user-management-title {
          margin: 0 !important;
          color: var(--ui-text-1) !important;
          font-size: 20px !important;
          line-height: 1.2 !important;
          font-weight: 700 !important;
        }

        .user-management-desc {
          display: block;
          margin-top: 6px;
          color: var(--ui-text-3) !important;
          font-size: 13px;
        }

        .user-management-primary {
          height: 40px;
          border-radius: 10px;
          padding: 0 16px;
          box-shadow: 0 8px 18px rgba(22, 93, 255, 0.18);
        }

        .user-management-stats {
          flex: 0 0 auto;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .user-management-stat {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          padding: 13px 14px;
          border: 1px solid var(--ui-border-2);
          border-radius: 14px;
          background: var(--ui-bg-panel);
        }

        .user-management-stat > span {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }

        .user-management-stat strong {
          display: block;
          color: var(--ui-text-1);
          font-size: 22px;
          line-height: 1;
          font-weight: 750;
          font-variant-numeric: tabular-nums;
        }

        .user-management-stat em {
          display: block;
          margin-top: 6px;
          color: var(--ui-text-3);
          font-style: normal;
          font-size: 12px;
        }

        .user-management-stat.is-blue > span {
          color: var(--ui-primary);
          background: var(--ui-primary-soft);
        }

        .user-management-stat.is-green > span {
          color: var(--ui-success);
          background: #e8ffea;
        }

        .user-management-stat.is-orange > span {
          color: var(--ui-warning);
          background: #fff7e8;
        }

        .user-management-stat.is-cyan > span {
          color: #14c9c9;
          background: #e8fffb;
        }

        .user-management-card {
          flex: 1;
          min-height: 0;
          border: 1px solid var(--ui-border-2);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: var(--ui-shadow-panel);
          background: var(--ui-bg-panel);
          padding: 14px 18px 12px;
          display: flex;
          flex-direction: column;
        }

        .user-management-table {
          flex: 1;
          min-height: 0;
        }

        .user-management-table .ant-table {
          background: #fff !important;
          color: var(--ui-text-2);
          border-radius: 12px;
        }

        .user-management-table .ant-table-container {
          border: 1px solid var(--ui-border-2);
          border-radius: 12px;
          overflow: hidden;
          background: #fff !important;
        }

        .user-management-table .ant-table-container table > thead > tr > th {
          background: #f6f8fc !important;
          color: var(--ui-text-2) !important;
          border-bottom: 1px solid var(--ui-border-2) !important;
          font-size: 13px;
          font-weight: 700;
          height: 48px;
        }

        .user-management-table .ant-table-container table > thead > tr > th::before {
          background: var(--ui-border-2) !important;
        }

        .user-management-table .ant-table-tbody > tr > td {
          background: #fff !important;
          color: var(--ui-text-2) !important;
          border-bottom: 1px solid var(--ui-border-1) !important;
          height: 54px;
          font-size: 13px;
        }

        .user-management-table .ant-table-tbody > tr:hover > td {
          background: #f7fbff !important;
        }

        .user-management-table .ant-table-tbody > tr.is-current-user > td {
          background: #fbfdff !important;
        }

        .user-management-table .ant-table-tbody > tr.is-current-user:hover > td {
          background: #eef6ff !important;
        }

        .user-management-table .ant-table-cell-fix-right,
        .user-management-table .ant-table-cell-fix-left {
          background: inherit !important;
        }

        .user-management-table .ant-pagination {
          margin: 14px 0 0 !important;
        }

        .user-management-table .ant-btn-sm {
          height: 28px;
          border-radius: 8px;
          padding-inline: 10px;
        }

        @media (max-width: 1180px) {
          .user-management-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .user-management-page {
            padding: 12px;
            overflow: auto;
          }

          .user-management-hero {
            align-items: stretch;
            flex-direction: column;
          }

          .user-management-primary {
            width: 100%;
          }

          .user-management-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
