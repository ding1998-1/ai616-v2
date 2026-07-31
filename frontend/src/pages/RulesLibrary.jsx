import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  FilePdfOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { authFetchJson } from '../lib/auth';

const { Title, Text, Paragraph } = Typography;

const MATTER_TYPE_OPTIONS = [
  { label: '通用', value: '通用' },
  { label: '重大决策', value: '重大决策' },
  { label: '重大项目安排', value: '重大项目安排' },
  { label: '大额度资金运作', value: '大额度资金运作' },
  { label: '重要人事任免', value: '重要人事任免' },
];

export default function RulesLibrary({ currentUser }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [matterTypeFilter, setMatterTypeFilter] = useState('all');
  const [uploadMatterType, setUploadMatterType] = useState('通用');
  const [keyword, setKeyword] = useState('');
  const [previewRule, setPreviewRule] = useState(null);
  const uploadInputRef = useRef(null);

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await authFetchJson('/api/custom_rules');
      setRules(data.files || []);
    } catch (err) {
      message.error(`规则库加载失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const filteredRules = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return rules.filter((item) => {
      const matchMatterType = matterTypeFilter === 'all' || (item.matterType || '通用') === matterTypeFilter;
      if (!matchMatterType) return false;
      if (!q) return true;
      const haystack = [
        item.name,
        item.matterType,
        item.uploadedAt,
        ...(item.summaryLines || []),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rules, matterTypeFilter, keyword]);

  const totalChars = rules.reduce((sum, item) => sum + (item.charCount || 0), 0);
  const filteredChars = filteredRules.reduce((sum, item) => sum + (item.charCount || 0), 0);

  const handleUploadRules = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadLoading(true);
    try {
      const uploadedRules = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const data = await authFetchJson(
          `/api/custom_rules/upload?matter_type=${encodeURIComponent(uploadMatterType || '通用')}`,
          { method: 'POST', body: fd },
        );
        uploadedRules.push(data.file);
      }
      setRules((prev) => {
        const next = [...prev];
        for (const rule of [...uploadedRules].reverse()) {
          next.unshift(rule);
        }
        return next.filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index);
      });
      message.success(`已上传 ${uploadedRules.length} 份规则文件`);
    } catch (err) {
      message.error(`上传失败：${err.message}`);
    } finally {
      setUploadLoading(false);
      event.target.value = '';
    }
  };

  const handleDelete = async (ruleId) => {
    try {
      await authFetchJson(`/api/custom_rules/${ruleId}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((item) => item.id !== ruleId));
      if (previewRule?.id === ruleId) {
        setPreviewRule(null);
      }
      message.success('规则文件已删除');
    } catch (err) {
      message.error(`删除失败：${err.message}`);
    }
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, boxSizing: 'border-box', background: '#f6f8fb' }}>
      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleUploadRules}
      />

      <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card bordered={false} style={{ borderRadius: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>
                <SafetyCertificateOutlined style={{ marginRight: 8, color: '#1677ff' }} />
                合规规则库
              </Title>
              <Text type="secondary">
                管理三重一大审查规则文件。审查页仍可快捷上传，这里负责集中上传、筛选、预览和删除。
              </Text>
              <div style={{ marginTop: 10 }}>
                <Tag color="blue" style={{ margin: 0 }}>{currentUser?.name || '当前用户'}</Tag>
                <Tag color="geekblue" style={{ marginLeft: 8 }}>{currentUser?.dept || '未识别部门'}</Tag>
              </div>
            </div>

            <Space wrap>
              <Select
                value={uploadMatterType}
                onChange={setUploadMatterType}
                options={MATTER_TYPE_OPTIONS}
                style={{ width: 180 }}
              />
              <Button
                type="primary"
                icon={uploadLoading ? <Spin size="small" /> : <UploadOutlined />}
                loading={uploadLoading}
                onClick={() => uploadInputRef.current?.click()}
              >
                上传规则文件
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadRules} loading={loading}>
                刷新
              </Button>
            </Space>
          </div>

          <Alert
            showIcon
            type="info"
            style={{ marginTop: 16, borderRadius: 14 }}
            message="上传说明"
            description="这里只接收 PDF。上传时会按你当前选定的事项类型归类；如果是通用制度，请保持“通用”。"
          />
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16 }}>
          <Card bordered={false} style={{ borderRadius: 18 }}>
            <Statistic title="规则总数" value={rules.length} suffix="份" />
          </Card>
          <Card bordered={false} style={{ borderRadius: 18 }}>
            <Statistic title="当前筛选" value={filteredRules.length} suffix="份" />
          </Card>
          <Card bordered={false} style={{ borderRadius: 18 }}>
            <Statistic title="规则字数" value={matterTypeFilter === 'all' ? totalChars : filteredChars} />
          </Card>
        </div>

        <Card bordered={false} style={{ borderRadius: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Select
              value={matterTypeFilter}
              onChange={setMatterTypeFilter}
              options={[{ label: '全部事项类型', value: 'all' }, ...MATTER_TYPE_OPTIONS]}
              style={{ width: 220 }}
            />
            <Input
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="按文件名、摘要关键词筛选"
              style={{ width: 300, maxWidth: '100%' }}
            />
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {loading ? (
            <Card bordered={false} style={{ borderRadius: 20, gridColumn: '1 / -1' }}>
              <div style={{ padding: 48, textAlign: 'center' }}>
                <Spin />
              </div>
            </Card>
          ) : filteredRules.length === 0 ? (
            <Card bordered={false} style={{ borderRadius: 20, gridColumn: '1 / -1' }}>
              <Empty description="当前筛选下没有规则文件" />
            </Card>
          ) : (
            filteredRules.map((rule) => (
              <Card
                key={rule.id}
                bordered={false}
                style={{ borderRadius: 20, boxShadow: '0 8px 24px rgba(15,23,42,0.05)' }}
                bodyStyle={{ padding: 18 }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <Space align="start">
                    <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 22, marginTop: 3 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{rule.name}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        <Tag color={rule.matterType === '通用' ? 'default' : 'blue'} style={{ margin: 0 }}>
                          {rule.matterType || '通用'}
                        </Tag>
                        <Tag color="cyan" style={{ margin: 0 }}>
                          {(rule.charCount || 0).toLocaleString()} 字
                        </Tag>
                      </div>
                    </div>
                  </Space>

                  <Space>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewRule(rule)}>
                      查看
                    </Button>
                    <Popconfirm
                      title="确认删除这份规则文件？"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => handleDelete(rule.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>

                <div style={{ marginTop: 14, fontSize: 12, color: '#667085' }}>
                  上传时间：{rule.uploadedAt || '未知'}
                </div>

                <div style={{ marginTop: 12 }}>
                  <Text strong style={{ fontSize: 13 }}>摘要命中</Text>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(rule.summaryLines || []).slice(0, 4).map((line, index) => (
                      <div
                        key={`${rule.id}_${index}`}
                        style={{
                          fontSize: 12,
                          color: '#475467',
                          lineHeight: 1.6,
                          background: '#f8fafc',
                          borderRadius: 10,
                          padding: '8px 10px',
                        }}
                      >
                        {line}
                      </div>
                    ))}
                    {(!rule.summaryLines || rule.summaryLines.length === 0) && (
                      <Text type="secondary" style={{ fontSize: 12 }}>暂无摘要命中内容</Text>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      <Modal
        open={Boolean(previewRule)}
        title={previewRule?.name || '规则预览'}
        onCancel={() => setPreviewRule(null)}
        footer={null}
        width={860}
      >
        {previewRule && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Space wrap>
              <Tag color={previewRule.matterType === '通用' ? 'default' : 'blue'}>{previewRule.matterType || '通用'}</Tag>
              <Tag color="cyan">{(previewRule.charCount || 0).toLocaleString()} 字</Tag>
              <Tag>{previewRule.uploadedAt || '未知时间'}</Tag>
            </Space>

            <div>
              <Text strong>摘要命中</Text>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(previewRule.summaryLines || []).map((line, index) => (
                  <div
                    key={`preview_${index}`}
                    style={{ background: '#f8fafc', borderRadius: 10, padding: '8px 10px', lineHeight: 1.7 }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Text strong>解析正文</Text>
              <Paragraph
                style={{
                  marginTop: 8,
                  maxHeight: 420,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  background: '#fafafa',
                  borderRadius: 12,
                  padding: 14,
                  lineHeight: 1.75,
                }}
              >
                {previewRule.parsedText || '暂无可显示内容'}
              </Paragraph>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
