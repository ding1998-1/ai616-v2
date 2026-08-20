import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

// ═══ ErrorBoundary — 懒加载失败自动重试 + 数据恢复 ═══════════════════
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retrying: false, retryCount: 0 };
    this.maxRetries = 3;
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] 页面加载失败:', error, info);
    this.setState({ errorInfo: info });
    const isChunkError = error?.message?.includes('dynamically imported module')
                      || error?.message?.includes('Failed to fetch');
    if (isChunkError) {
      // 保存当前会议状态防丢失
      try {
        const state = {
          meetingId: window.__CURRENT_MEETING_ID__,
          transcripts: window.__REMOTE_TRANSCRIPTS__?.slice(-50),
          time: Date.now(),
        };
        localStorage.setItem('__ai616_recovery__', JSON.stringify(state));
      } catch (_) {}
      // 旧 chunk 已不存在（重新部署导致）→ 直接强制刷新加载新 index.html
      if (this.state.retryCount >= this.maxRetries) {
        window.location.reload(true);
        return;
      }
      const next = this.state.retryCount + 1;
      this.setState({ retrying: true, retryCount: next });
      this._retryTimer = window.setTimeout(() => {
        this.setState({ hasError: false, retrying: false });
        window.location.reload(true);
      }, 2000 * (2 ** (next - 1)));
      return;
    }
  }
  componentWillUnmount() {
    if (this._retryTimer) window.clearTimeout(this._retryTimer);
  }
  render() {
    if (this.state.hasError && !this.state.retrying) {
      const errMsg = this.state.error?.message || '未知错误';
      return (
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          color: 'var(--ui-text-1)', padding: 24, overflow: 'auto',
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>页面加载失败</div>
          <div style={{ fontSize: 14, color: 'var(--ui-danger)', fontWeight: 600, textAlign: 'center', maxWidth: 500 }}>
            {errMsg}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, retryCount: 0 }); window.location.reload(); }}
            style={{
              padding: '8px 24px', borderRadius: 8, border: 'none',
              background: 'var(--ui-primary)', color: '#fff',
              cursor: 'pointer', fontSize: 14,
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    if (this.state.retrying) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ui-text-2)' }}>
          <Spin /><span>组件加载异常，自动恢复中（{this.state.retryCount}/{this.maxRetries}）…</span>
        </div>
      );
    }
    return this.props.children;
  }
}
import { Badge, Layout, Menu, theme, ConfigProvider, Tooltip, Dropdown, Button, Space, Avatar, Typography, Spin, Tag } from 'antd';
import {
  FileTextOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  BulbOutlined,
  BulbFilled,
  BookOutlined,
  FolderOpenOutlined,
  DashboardOutlined,
  DesktopOutlined,
  AudioOutlined,
  TeamOutlined,
  LogoutOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import { authFetchJson, getStoredToken, setStoredToken } from './lib/auth';

const ComplianceAudit = lazy(() => import('./pages/ComplianceAudit'));
const MeetingComplianceWorkflow = lazy(() => import('./pages/MeetingComplianceWorkflow'));
const MobileMeetingRecorder = lazy(() => import('./pages/MobileMeetingRecorder'));
const IssueCollectPage = lazy(() => import('./pages/IssueCollectPage'));
const ComplianceAuditFocus = lazy(() => import('./pages/ComplianceAuditFocus'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const CaseAnalysis = lazy(() => import('./pages/CaseAnalysis'));
const KnowledgeLibrary = lazy(() => import('./pages/KnowledgeLibrary'));
const DecisionArchive = lazy(() => import('./pages/DecisionArchive'));
const StatisticalDashboard = lazy(() => import('./pages/StatisticalDashboard'));
const OAWorkflow = lazy(() => import('./pages/OAWorkflow'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const RulesLibrary = lazy(() => import('./pages/RulesLibrary'));
const TodoDashboard = lazy(() => import('./pages/TodoDashboard'));

const { Sider, Content, Header } = Layout;
const { Text, Title } = Typography;
const UI_PRIMARY = '#165DFF';
const UI_PAGE_BG = 'var(--ui-bg-page)';
const UI_PANEL_BG = 'var(--ui-bg-panel)';
const UI_BORDER = 'var(--ui-border-2)';

const PAGE_META = {
  ai_meeting: { title: '会议管理', desc: '从议题准备、多人录音、实时转写到决议签署与归档。' },
  dashboard: { title: '处置工作台', desc: '先看风险，再进事项，最后归档留痕。' },
  compliance: { title: '三重一大审查', desc: '重大事项会议启用的增强合规审查，按制度依据生成审查意见。' },
  compliance_focus: { title: '快速审查', desc: '普通经办人员使用的简化审查路径。' },
  todos: { title: '待办事项', desc: '会议决议与任务落实的跟踪看板。' },
  oa: { title: 'OA 审批联动', desc: '模拟事项流转、风险拦截和审批凭证联动。' },
  archive: { title: '归档中心', desc: '查询审查记录、时间线和原始附件。' },
  knowledge: { title: '会议知识库', desc: '从历史会议、制度和案例中检索业务口径。' },
  cases: { title: '合同审查', desc: '预览合同、定位风险、处理建议并下载审查版。' },
  library: { title: '知识文库', desc: '维护制度、案例和共享资料的生效状态。' },
  rules: { title: '制度规则库', desc: '管理三重一大审查规则文件，支持上传、筛选、预览和删除。' },
  users: { title: '用户管理', desc: '维护账号、角色、状态和组织归属。' },
};

function SidebarBrandMark() {
  return (
    <div
      style={{
        width: 38,
        height: 38,
        borderRadius: 12,
        background: UI_PRIMARY,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 10px 24px rgba(22, 93, 255, 0.22)',
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <path
          d="M12 3.5 18.5 6v5.6c0 4.2-2.6 7.7-6.5 8.9-3.9-1.2-6.5-4.7-6.5-8.9V6L12 3.5Z"
          stroke="white"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path
          d="m8.9 12 2.1 2.2 4.2-4.4"
          stroke="white"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function useBackendStatus() {
  const [online, setOnline] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch('/health', { method: 'GET', signal: AbortSignal.timeout(4000) });
        if (!cancelled) setOnline(response.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return online;
}

function SidebarClock({ isDarkMode, notificationCount = 0 }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');
  const dateStr = time.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
  return (
    <div style={{ padding: '10px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: isDarkMode ? 'rgba(255,255,255,0.85)' : '#fff', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
        {hh}:{mm}<span style={{ fontSize: 14, opacity: 0.6, marginLeft: 4 }}>:{ss}</span>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{dateStr}</span>
        {notificationCount > 0 && (
          <Badge count={notificationCount} size="small" style={{ backgroundColor: '#ef4444' }} title={`${notificationCount} 条新通知`} />
        )}
      </div>
    </div>
  );
}

function SidebarStatus({ online }) {
  const label = online === null ? '连接检测中…' : online ? '后端服务正常' : '后端不可达';
  const dotColor = online === null ? '#f59e0b' : online ? '#22c55e' : '#ef4444';
  return (
    <Tooltip title={online ? '后端 API 在线' : '无法连接到后端，请检查服务是否启动'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 4px ${dotColor}22` }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      </div>
    </Tooltip>
  );
}

function AppShell({ currentUser, onLogout }) {
  const [currentPage, setCurrentPage] = useState(() => {
    const page = new URLSearchParams(window.location.search).get('page');
    return PAGE_META[page] ? page : 'ai_meeting';
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const backendOnline = useBackendStatus();

  // 通知轮询
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await authFetchJson('/api/notifications');
        const unread = (data.notifications || []).filter(n => !n.read).length;
        setNotificationCount(unread);
      } catch (_) {}
    };
    poll();
    const timer = setInterval(poll, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.uiTheme = isDarkMode ? 'dark' : 'light';
  }, [isDarkMode]);

  const menuItems = useMemo(() => {
    const items = [
      { key: 'ai_meeting', icon: <AudioOutlined />, label: '会议管理' },
      { key: 'todos', icon: <ScheduleOutlined />, label: '待办事项' },
      { type: 'divider' },
      { key: 'dashboard', icon: <DashboardOutlined />, label: '处置工作台' },
      { key: 'compliance_focus', icon: <SafetyCertificateOutlined />, label: '快速审查' },
      { key: 'compliance', icon: <FileTextOutlined />, label: '三重一大审查' },
      { key: 'oa', icon: <DesktopOutlined />, label: 'OA 审批' },
      { key: 'archive', icon: <FolderOpenOutlined />, label: '归档中心' },
      { key: 'knowledge', icon: <DatabaseOutlined />, label: '会议知识库' },
      { key: 'cases', icon: <ExperimentOutlined />, label: '合同审查' },
      { key: 'library', icon: <BookOutlined />, label: '知识文库' },
    ];
    if (currentUser?.role === 'admin') {
      items.push({ key: 'rules', icon: <SafetyCertificateOutlined />, label: '制度规则库' });
      items.push({ key: 'users', icon: <TeamOutlined />, label: '用户管理' });
    }
    return items;
  }, [currentUser]);

  const pageMeta = PAGE_META[currentPage] || PAGE_META.ai_meeting;

  const handleNavigate = useCallback((page) => {
    setCurrentPage(page);
    // 同步更新 URL，刷新后保持在当前页面
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    window.history.replaceState(null, '', url);
  }, []);

  const pageContent = useMemo(() => {
    const props = { isDarkMode, currentUser, onNavigate: handleNavigate };
    let PageComponent = MeetingComplianceWorkflow;
    switch (currentPage) {
      case 'compliance': PageComponent = ComplianceAudit; break;
      case 'ai_meeting': PageComponent = MeetingComplianceWorkflow; break;
      case 'compliance_focus': PageComponent = ComplianceAuditFocus; break;
      case 'oa': PageComponent = OAWorkflow; break;
      case 'archive': PageComponent = DecisionArchive; break;
      case 'todos': PageComponent = TodoDashboard; break;
      case 'knowledge': PageComponent = KnowledgeBase; break;
      case 'cases': PageComponent = CaseAnalysis; break;
      case 'library': PageComponent = KnowledgeLibrary; break;
      case 'rules': PageComponent = RulesLibrary; break;
      case 'users': PageComponent = UserManagement; break;
      default: PageComponent = StatisticalDashboard; break;
    }
    return (
      <ErrorBoundary key={currentPage}>
        <Suspense
          fallback={(
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Space><Spin /><span>页面加载中…</span></Space>
            </div>
          )}
        >
          <PageComponent {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  }, [currentPage, isDarkMode, currentUser, handleNavigate]);

  const userMenu = {
    items: [
      { key: 'role', label: `${currentUser?.role === 'admin' ? '管理员' : '业务用户'} · ${currentUser?.dept || ''}`, icon: <SafetyCertificateOutlined /> },
      { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, onClick: onLogout },
    ],
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: UI_PRIMARY,
          colorInfo: UI_PRIMARY,
          colorText: 'var(--ui-text-1)',
          colorTextSecondary: 'var(--ui-text-2)',
          colorBorder: 'var(--ui-border-2)',
          colorBgLayout: UI_PAGE_BG,
          colorBgContainer: UI_PANEL_BG,
          borderRadius: 8,
          fontFamily: 'var(--ui-font-family)',
        },
        components: {
          Button: { borderRadius: 8, controlHeight: 36, fontWeight: 500 },
          Card: { borderRadiusLG: 12, paddingLG: 16 },
          Tag: { borderRadiusSM: 999 },
        },
      }}
    >
      <Layout className="app-shell" style={{ height: '100vh', background: UI_PAGE_BG }}>
        <Sider
          width={218}
          theme="dark"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--ui-bg-sidebar)',
            borderRight: '1px solid rgba(255,255,255,0.05)',
            boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.03)',
          }}
        >
          <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SidebarBrandMark />
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>AI 会议管理</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>会议 · 议题 · 决议 · 归档</div>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar size={34} icon={<UserOutlined />} style={{ background: UI_PRIMARY }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 500 }}>{currentUser?.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.48)', fontSize: 11 }}>{currentUser?.dept}</div>
                </div>
              </div>
            </div>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[currentPage]}
            items={menuItems}
            onClick={({ key }) => handleNavigate(key)}
            style={{ borderRight: 0, flex: 1, background: 'transparent', marginTop: 8, paddingInline: 4 }}
          />

          <div style={{ flexShrink: 0 }}>
            <SidebarClock isDarkMode={isDarkMode} notificationCount={notificationCount} />
            <SidebarStatus online={backendOnline} />
          </div>
        </Sider>

        <Layout style={{ marginLeft: 218, minHeight: 0 }}>
          <Header style={{ height: 'auto', lineHeight: 'normal', padding: '10px 16px 0', background: 'transparent', flex: '0 0 auto' }}>
            <div style={{ background: UI_PANEL_BG, borderRadius: 16, border: `1px solid ${UI_BORDER}`, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: 'var(--ui-shadow-panel)' }}>
              <div>
                <Title level={4} style={{ margin: 0, fontSize: 'var(--ui-font-page-title)', fontWeight: 600, color: 'var(--ui-text-1)' }}>{pageMeta.title}</Title>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Text type="secondary">{pageMeta.desc}</Text>
                  <Tag color="blue" style={{ margin: 0, borderRadius: 999, fontWeight: 500 }}>{currentUser?.role === 'admin' ? '管理员视图' : '业务视图'}</Tag>
                </div>
              </div>
              <Space size={10}>
                <Tooltip title="切换主题">
                  <Button shape="circle" icon={isDarkMode ? <BulbFilled /> : <BulbOutlined />} onClick={() => setIsDarkMode(v => !v)} />
                </Tooltip>
                <Dropdown menu={userMenu} trigger={['click']}>
                  <Button style={{ height: 40, borderRadius: 999 }}>
                    <Space>
                      <Avatar size={24} icon={<UserOutlined />} />
                      <span>{currentUser?.name}</span>
                    </Space>
                  </Button>
                </Dropdown>
              </Space>
            </div>
          </Header>

          <Content style={{ padding: '10px 16px 16px', minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: UI_PANEL_BG, borderRadius: 16, border: `1px solid ${UI_BORDER}`, boxShadow: 'var(--ui-shadow-panel)' }}>
              {pageContent}
            </div>
          </Content>
        </Layout>
      </Layout>

      <style>{`
        .app-shell .ant-menu {
          font-size: 14px;
        }

        .app-shell .ant-menu-dark .ant-menu-item {
          border-radius: 10px;
          margin-block: 4px;
          margin-inline: 5px;
          height: 40px;
          line-height: 40px;
          color: rgba(255,255,255,0.72);
          transition: background 180ms ease, color 180ms ease, transform 180ms ease;
        }

        .app-shell .ant-menu-dark .ant-menu-item:hover {
          background: rgba(255,255,255,0.06) !important;
          color: #fff !important;
          transform: translateX(1px);
        }

        .app-shell .ant-menu-dark .ant-menu-item-selected {
          background: linear-gradient(90deg, rgba(22, 93, 255, 0.3), rgba(22, 93, 255, 0.12)) !important;
          color: #fff !important;
          box-shadow: inset 0 0 0 1px rgba(22, 93, 255, 0.22);
        }

        .app-shell .ant-menu-dark .ant-menu-item-selected::after {
          display: none;
        }
      `}</style>
    </ConfigProvider>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const isMobileRecorderPath = window.location.pathname.replace(/\/+$/, '') === '/mobile-recorder';
  const isIssueCollectPath = window.location.pathname.replace(/\/+$/, '') === '/issue-collect';

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const token = getStoredToken();
      if (!token) {
        if (alive) setBooting(false);
        return;
      }
      try {
        const data = await authFetchJson('/api/auth/me');
        if (alive) setCurrentUser(data.user);
      } catch (_) {
        setStoredToken('');
      } finally {
        if (alive) setBooting(false);
      }
    };
    boot();
    return () => { alive = false; };
  }, []);

  if (booting) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <Space><Spin /><span>系统加载中…</span></Space>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} entry={isMobileRecorderPath ? 'mobile-recorder' : isIssueCollectPath ? 'issue-collect' : 'app'} />;
  }

  if (isIssueCollectPath) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: UI_PRIMARY,
            colorInfo: UI_PRIMARY,
            borderRadius: 8,
            fontFamily: 'var(--ui-font-family)',
          },
        }}
      >
        <Suspense
          fallback={(
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
              <Space><Spin /><span>问题收集页加载中…</span></Space>
            </div>
          )}
        >
          <ErrorBoundary>
            <IssueCollectPage currentUser={currentUser} onLogout={() => { setStoredToken(''); setCurrentUser(null); }} />
          </ErrorBoundary>
        </Suspense>
      </ConfigProvider>
    );
  }

  if (isMobileRecorderPath) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: UI_PRIMARY,
            colorInfo: UI_PRIMARY,
            borderRadius: 8,
            fontFamily: 'var(--ui-font-family)',
          },
        }}
      >
        <Suspense
          fallback={(
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
              <Space><Spin /><span>手机录音页加载中…</span></Space>
            </div>
          )}
        >
          <ErrorBoundary>
            <MobileMeetingRecorder currentUser={currentUser} onLogout={() => { setStoredToken(''); setCurrentUser(null); }} />
          </ErrorBoundary>
        </Suspense>
      </ConfigProvider>
    );
  }

  return <AppShell currentUser={currentUser} onLogout={() => { setStoredToken(''); setCurrentUser(null); }} />;
}
