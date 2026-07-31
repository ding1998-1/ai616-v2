import React, { useEffect, useMemo, useState } from 'react';
import { Typography, Table, Button, Tag, Space, Input, DatePicker, Select, Drawer, Descriptions, Timeline, Card, Badge, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined, SearchOutlined, FolderOpenOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { fetchJson } from '../lib/demoApi';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const TYPE_COLOR = {
  '重大决策': 'blue',
  '重大项目安排': 'purple',
  '大额度资金运作': 'orange',
  '重要人事任免': 'green',
};

function pickField(text = '', label) {
  const match = String(text).match(new RegExp(`${label}[:：]\\s*([^\\n]+)`));
  return match ? match[1].trim() : '';
}

function normalizeArchiveRecord(record) {
  const rawTitle = String(record.title || '');
  const matterName = pickField(rawTitle, '事项名称') || rawTitle.split('\n')[0] || '未命名归档事项';
  const oaNo = record.oaNo || record.oaCode || pickField(rawTitle, 'OA编号');
  const dept = pickField(rawTitle, '发起部门');
  const meeting = pickField(rawTitle, '拟提交会议');
  const materials = pickField(rawTitle, '材料清单');
  return {
    matterName,
    oaNo,
    metaLine: [oaNo && `OA编号：${oaNo}`, dept && `发起部门：${dept}`, meeting && `会议：${meeting}`].filter(Boolean).join(' · '),
    summary: materials ? `材料清单：${materials}` : (record.archiveSummary || '材料清单、审议记录、风险校验报告已纳入归档包'),
  };
}

export default function DecisionArchive({ isDarkMode = false }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [activeRecord, setActiveRecord] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const result = await fetchJson('/api/audit_history');
        if (alive && result.success) {
          setData(result.history || []);
        }
      } catch (error) {
        if (alive) message.error(error.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchHistory();
    return () => { alive = false; };
  }, []);

  const columns = useMemo(() => ([
    {
      title: '决策编号',
      dataIndex: 'id',
      key: 'id',
      width: 170,
      render: text => <Text strong style={{ color: '#1d2129', fontVariantNumeric: 'tabular-nums' }}>{text}</Text>,
    },
    {
      title: '事项类型',
      dataIndex: 'matterType',
      key: 'matterType',
      width: 160,
      render: type => <Tag color={TYPE_COLOR[type] || 'blue'} style={{ margin: 0 }}>{type}</Tag>,
    },
    {
      title: '事项名称',
      dataIndex: 'title',
      key: 'title',
      width: 410,
      render: (_, record) => (
        (() => {
          const normalized = normalizeArchiveRecord(record);
          return (
            <div className="archive-title-cell">
              <div className="archive-title-main">{normalized.matterName}</div>
              <div className="archive-title-meta">
                {normalized.metaLine && <span>{normalized.metaLine}</span>}
                <span>{normalized.summary}</span>
              </div>
            </div>
          );
        })()
      ),
    },
    {
      title: '审议日期',
      dataIndex: 'date',
      key: 'date',
      width: 180,
      render: date => <span style={{ color: '#4e5969', fontVariantNumeric: 'tabular-nums' }}>{date}</span>,
    },
    {
      title: '风险等级',
      dataIndex: 'riskLevel',
      key: 'riskLevel',
      width: 130,
      render: level => {
        let color = 'green';
        if (level === '中风险') color = 'warning';
        if (level === '高风险') color = 'error';
        return <Tag color={color} style={{ margin: 0 }}>{level}</Tag>;
      },
    },
    {
      title: '参会人员',
      dataIndex: 'participants',
      key: 'participants',
      width: 210,
      render: text => <span className="archive-participants">{text || '系统自动审核'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      fixed: 'right',
      render: (_, record) => (
        <Space size={6} className="archive-actions">
          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => { setActiveRecord(record); setDetailsVisible(true); }}>详情</Button>
          <Button type="link" size="small" icon={<FilePdfOutlined />} onClick={() => message.success(`已生成《${record.title}》迎检报告 PDF`)}>
            导出报告
          </Button>
        </Space>
      ),
    },
  ]), []);

  const cardBg = '#ffffff';
  const border = '1px solid #e5e6eb';

  return (
    <div className="decision-archive-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 18, boxSizing: 'border-box', overflow: 'hidden', background: '#f7f8fa' }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0, color: '#1d2129', fontWeight: 700 }}>决策溯源档案</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>集中查询审查记录、时间线、原始附件与迎检报告。</Text>
        </div>
        <Button type="primary" icon={<DownloadOutlined />} style={{ height: 36, borderRadius: 8 }}>批量导出迎检报告</Button>
      </div>

      <div className="archive-filter-bar" style={{ background: cardBg, padding: 12, borderRadius: 10, marginBottom: 12, border }}>
        <Space wrap>
          <Input placeholder="搜索事项名称/编号" prefix={<SearchOutlined />} style={{ width: 260 }} allowClear />
          <Select
            placeholder="事项类型"
            style={{ width: 150 }}
            allowClear
            options={[
              { value: '重大决策', label: '重大决策' },
              { value: '重大项目安排', label: '重大项目安排' },
              { value: '大额度资金运作', label: '大额度资金运作' },
              { value: '重要人事任免', label: '重要人事任免' },
            ]}
          />
          <RangePicker style={{ width: 260 }} />
          <Button type="primary" style={{ borderRadius: 8 }}>搜索</Button>
        </Space>
      </div>

      <div className="archive-table-wrap" style={{ background: cardBg, borderRadius: 12, border, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1460, y: 'calc(100vh - 330px)' }}
          rowKey="id"
        />
      </div>

      <Drawer
        title={<span style={{ color: isDarkMode ? '#e5e7eb' : '#1f2937' }}>{activeRecord ? `档案详情: ${activeRecord.title}` : '档案详情'}</span>}
        placement="right"
        width={720}
        onClose={() => setDetailsVisible(false)}
        open={detailsVisible}
        styles={{
          body: { background: isDarkMode ? '#111827' : '#ffffff', paddingBottom: 80 },
          header: { background: isDarkMode ? '#1f2937' : '#ffffff', borderBottom: isDarkMode ? '1px solid #374151' : '1px solid #f0f0f0' },
        }}
      >
        {activeRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="基础信息" bordered={false} style={{ background: isDarkMode ? '#1f2937' : '#fafafa' }} headStyle={{ borderBottom: isDarkMode ? '1px solid #374151' : '1px solid #f0f0f0', color: isDarkMode ? '#e5e7eb' : '#1f2937' }}>
              <Descriptions column={2} labelStyle={{ color: isDarkMode ? '#9ca3af' : '#6b7280' }} contentStyle={{ color: isDarkMode ? '#e5e7eb' : '#111827', fontWeight: 500 }}>
                <Descriptions.Item label="决策编号">{activeRecord.id}</Descriptions.Item>
                <Descriptions.Item label="事项类型"><Tag color={TYPE_COLOR[activeRecord.matterType] || 'blue'}>{activeRecord.matterType}</Tag></Descriptions.Item>
                <Descriptions.Item label="审议日期">{activeRecord.date}</Descriptions.Item>
                <Descriptions.Item label="状态"><Badge status="success" text="已归档" style={{ color: isDarkMode ? '#e5e7eb' : '#111827' }} /></Descriptions.Item>
                <Descriptions.Item label="当前风险等级" span={2}>
                  {activeRecord.riskLevel === '高风险'
                    ? <Badge color="red" text="高风险 - 曾触发违规警告并生成整改通知" style={{ color: '#ef4444' }} />
                    : activeRecord.riskLevel === '中风险'
                      ? <Badge color="orange" text="中风险 - 存在次要瑕疵已补正" style={{ color: '#f97316' }} />
                      : <Badge color="green" text="低风险 - 决策合规流程完备" style={{ color: '#22c55e' }} />}
                </Descriptions.Item>
                <Descriptions.Item label="参会人员" span={2}>{activeRecord.participants}</Descriptions.Item>
                {activeRecord.archiveSummary && <Descriptions.Item label="档案摘要" span={2}>{activeRecord.archiveSummary}</Descriptions.Item>}
              </Descriptions>
            </Card>

            <Card title="决策审议流转节点" bordered={false} style={{ background: isDarkMode ? '#1f2937' : '#fafafa' }} headStyle={{ borderBottom: isDarkMode ? '1px solid #374151' : '1px solid #f0f0f0', color: isDarkMode ? '#e5e7eb' : '#1f2937' }}>
              <Timeline
                style={{ marginTop: 16 }}
                items={(activeRecord.timeline || []).map(item => ({
                  color: item.color,
                  dot: <CheckCircleOutlined />,
                  children: (
                    <div>
                      <Text strong style={{ color: isDarkMode ? '#e5e7eb' : '#1f2937' }}>{item.title}</Text><br />
                      <Text type="secondary" style={{ fontSize: 12 }}>{item.description}</Text>
                    </div>
                  ),
                }))}
              />
            </Card>

            <Card title="原始凭证文件库" bordered={false} style={{ background: isDarkMode ? '#1f2937' : '#fafafa' }} headStyle={{ borderBottom: isDarkMode ? '1px solid #374151' : '1px solid #f0f0f0', color: isDarkMode ? '#e5e7eb' : '#1f2937' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {(activeRecord.attachments || []).map(file => (
                  <div key={file.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: isDarkMode ? '#374151' : '#f3f4f6', borderRadius: 6 }}>
                    <span><FilePdfOutlined style={{ marginRight: 8, color: '#ef4444' }} /> {file.name}</span>
                    <Button type="link" size="small" onClick={() => message.info(`暂未接入 ${file.name} 的在线预览`)}>预览 / 下载</Button>
                  </div>
                ))}
              </Space>
            </Card>
          </div>
        )}
      </Drawer>

      <style>{`
        .decision-archive-page * {
          letter-spacing: 0;
        }

        .decision-archive-page .archive-filter-bar .ant-input-affix-wrapper,
        .decision-archive-page .archive-filter-bar .ant-select-selector,
        .decision-archive-page .archive-filter-bar .ant-picker {
          height: 36px !important;
          border-radius: 8px !important;
          border-color: #e5e6eb !important;
          background: #fff !important;
        }

        .decision-archive-page .ant-table {
          color: #1d2129;
          font-size: 13px;
          background: #fff;
        }

        .decision-archive-page .ant-table-thead > tr > th {
          height: 42px;
          padding: 10px 14px !important;
          background: #f2f3f5 !important;
          color: #4e5969 !important;
          font-weight: 600 !important;
          border-bottom: 1px solid #e5e6eb !important;
        }

        .decision-archive-page .ant-table-tbody > tr > td {
          padding: 14px !important;
          border-bottom: 1px solid #f2f3f5 !important;
          vertical-align: middle;
        }

        .decision-archive-page .ant-table-tbody > tr:hover > td {
          background: #f7fbff !important;
        }

        .decision-archive-page .ant-table-cell::before {
          display: none !important;
        }

        .decision-archive-page .ant-table-container,
        .decision-archive-page .ant-table-content {
          border-radius: 12px 12px 0 0;
        }

        .archive-title-cell {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .archive-title-main {
          color: #1d2129;
          font-size: 14px;
          line-height: 1.45;
          font-weight: 700;
        }

        .archive-title-meta {
          display: grid;
          gap: 2px;
          color: #86909c;
          font-size: 12px;
          line-height: 1.55;
        }

        .archive-title-meta span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .archive-participants {
          color: #4e5969;
          font-size: 13px;
        }

        .archive-actions .ant-btn {
          border-radius: 8px;
          font-weight: 600;
        }

        .decision-archive-page .ant-pagination {
          margin: 10px 14px !important;
        }
      `}</style>
    </div>
  );
}
