import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, Segmented, Space, Tag, Typography, message } from 'antd';
import { CheckSquareOutlined, DatabaseOutlined, EditOutlined, IdcardOutlined, LockOutlined, MessageOutlined, MobileOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { setStoredToken } from '../lib/auth';

const { Title, Text } = Typography;

export default function LoginPage({ onLogin, entry = 'app' }) {
  const isMobileRecorder = entry === 'mobile-recorder';
  const isIssueCollect = entry === 'issue-collect';
  const isExternalMeetingEntry = isMobileRecorder || isIssueCollect;
  const [loading, setLoading] = useState(false);
  const [launchPhase, setLaunchPhase] = useState('idle');
  const [error, setError] = useState('');
  const [rememberAccount, setRememberAccount] = useState(() => {
    try { return window.localStorage.getItem('ai616_remember_account') === '1'; } catch (_) { return false; }
  });
  const [savedAccount] = useState(() => {
    try {
      return window.localStorage.getItem('ai616_remember_account') === '1'
        ? (window.localStorage.getItem('ai616_login_username') || 'admin')
        : 'admin';
    } catch (_) { return 'admin'; }
  });
  const [authMode, setAuthMode] = useState(isExternalMeetingEntry ? 'register' : 'login');
  const shellRef = useRef(null);
  const rafRef = useRef(null);
  const pointerRef = useRef({ currentX: 50, currentY: 38, targetX: 50, targetY: 38 });
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const meetingId = params.get('meetingId') || '';
  const meetingTitle = params.get('meeting') || '';
  const agenda = params.get('agenda') || '';
  const projectName = params.get('project') || '';
  const meetingDate = params.get('date') || '';

  useEffect(() => {
    if (!isExternalMeetingEntry) return undefined;
    const root = document.getElementById('root');
    document.documentElement.classList.add('mobile-recorder-scroll');
    document.body.classList.add('mobile-recorder-scroll');
    root?.classList.add('mobile-recorder-scroll');
    return () => {
      document.documentElement.classList.remove('mobile-recorder-scroll');
      document.body.classList.remove('mobile-recorder-scroll');
      root?.classList.remove('mobile-recorder-scroll');
    };
  }, [isExternalMeetingEntry]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return undefined;

    const tick = () => {
      const pointer = pointerRef.current;
      pointer.currentX += (pointer.targetX - pointer.currentX) * 0.08;
      pointer.currentY += (pointer.targetY - pointer.currentY) * 0.08;
      node.style.setProperty('--mx', `${pointer.currentX}%`);
      node.style.setProperty('--my', `${pointer.currentY}%`);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handlePointerMove = (event) => {
    const node = shellRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    pointerRef.current.targetX = ((event.clientX - rect.left) / rect.width) * 100;
    pointerRef.current.targetY = ((event.clientY - rect.top) / rect.height) * 100;
  };

  const handlePointerLeave = () => {
    pointerRef.current.targetX = 50;
    pointerRef.current.targetY = 38;
  };

  const finishAuth = async (data) => {
    setStoredToken(data.token);
    window.sessionStorage.removeItem('ai616_external_auth_reset');
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    setLaunchPhase('exiting');
    await new Promise((resolve) => window.setTimeout(resolve, 680));
    onLogin?.(data.user);
  };

  const handleLogin = async (values) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: values.username,
        password: values.password,
        ...(isExternalMeetingEntry ? {
          meetingId,
          meetingTitle,
          agenda,
          meetingDate,
          roleLabel: isIssueCollect ? '问题填报人' : '参会代表',
        } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      let errMsg = data.detail || data.message || `HTTP ${response.status}`;
      if (Array.isArray(errMsg)) {
        errMsg = errMsg.map(e => {
          const field = (e.loc || []).slice(-1)[0] || '未知字段';
          return `${field}: ${e.msg}`;
        }).join('；');
      }
      throw new Error(errMsg);
    }
    try {
      if (rememberAccount) {
        window.localStorage.setItem('ai616_login_username', values.username);
        window.localStorage.setItem('ai616_remember_account', '1');
      } else {
        window.localStorage.removeItem('ai616_login_username');
        window.localStorage.removeItem('ai616_remember_account');
      }
    } catch (_) {}
    await finishAuth(data);
  };

  const handleMeetingRegister = async (values) => {
    const response = await fetch('/api/auth/meeting-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: values.username,
        password: values.password,
        name: values.name,
        dept: values.dept,
        meeting_role: values.meeting_role,
        meeting_seat: values.meeting_seat,
        meeting_id: meetingId,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      // Pydantic 校验错误是数组，格式化为可读字符串
      let errMsg = data.detail || data.message || `HTTP ${response.status}`;
      if (Array.isArray(errMsg)) {
        errMsg = errMsg.map(e => {
          const field = (e.loc || []).slice(-1)[0] || '未知字段';
          return `${field}: ${e.msg}`;
        }).join('；');
      }
      throw new Error(errMsg);
    }
    // 一次性凭据：仅本次返回，必须提示用户保存
    if (data.oneTimePassword) {
      message.warning({
        content: `系统已为你生成一次性密码：${data.oneTimePassword}。请务必保存，下次登录需要输入该密码。`,
        duration: 12,
      });
    }
    await finishAuth(data);
  };

  const handleSubmit = async (values) => {
    setLoading(true);
    setLaunchPhase('collapsing');
    setError('');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      setLaunchPhase('spinning');
      if (isExternalMeetingEntry && authMode === 'register') {
        await handleMeetingRegister(values);
      } else {
        await handleLogin(values);
      }
    } catch (err) {
      setError(err.message);
      setLaunchPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const isAnimatingButton = launchPhase !== 'idle';
  const isSpinning = launchPhase === 'spinning';
  const isExiting = launchPhase === 'exiting';
  const showSpinner = launchPhase === 'spinning' || launchPhase === 'exiting';
  const submitText = isExternalMeetingEntry
    ? (authMode === 'register' ? (isIssueCollect ? '登记并进入填报' : '登记并进入录音') : (isIssueCollect ? '登录并进入填报' : '登录并进入录音'))
    : '进入系统';
  const formInitialValues = isExternalMeetingEntry && authMode === 'register'
    ? {
      username: '',
      password: '',
      name: '',
      dept: '参会单位',
      meeting_role: isIssueCollect ? '问题填报人' : '参会代表',
      meeting_seat: isIssueCollect ? '问题收集端' : '移动端席位',
    }
    : { username: isExternalMeetingEntry ? '' : savedAccount, password: '' };

  return (
    <div
      ref={shellRef}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      className={[
        'login-minimal-shell',
        isExternalMeetingEntry ? 'is-mobile-recorder' : '',
        isExiting ? 'is-exiting' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--mx': '50%',
        '--my': '38%',
        inset: isExternalMeetingEntry ? 0 : undefined,
        width: isExternalMeetingEntry ? '100vw' : undefined,
        height: isExternalMeetingEntry ? '100dvh' : undefined,
        minHeight: '100dvh',
        position: isExternalMeetingEntry ? 'fixed' : 'relative',
        overflowX: 'hidden',
        overflowY: isExternalMeetingEntry ? 'auto' : 'hidden',
        WebkitOverflowScrolling: 'touch',
        touchAction: isExternalMeetingEntry ? 'pan-y' : 'auto',
        background: '#f5f5f7',
      }}
    >
      <div className="login-minimal-ambient login-minimal-ambient-a" />
      <div className="login-minimal-ambient login-minimal-ambient-b" />
      <div className="login-minimal-pointer-glow" />
      <div className="login-minimal-noise" />

      <div
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: isExternalMeetingEntry ? 'start center' : 'center',
          padding: isExternalMeetingEntry ? '12px 12px calc(72px + env(safe-area-inset-bottom))' : '40px 20px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          className={isExiting ? 'login-hero-panel is-exiting' : 'login-hero-panel'}
          style={{
            width: '100%',
            maxWidth: isExternalMeetingEntry ? 430 : 980,
            display: 'grid',
            gridTemplateColumns: isExternalMeetingEntry ? 'minmax(0, 1fr)' : 'minmax(300px, 1fr) minmax(360px, 420px)',
            gap: isExternalMeetingEntry ? 10 : 28,
            alignItems: 'center',
          }}
        >
          <div className={isExiting ? 'login-copy-panel is-exiting' : 'login-copy-panel'} style={{ padding: isExternalMeetingEntry ? '0 4px 2px' : '18px 12px 18px 8px' }}>
            {isExternalMeetingEntry && <Tag
              variant="filled"
              style={{
                borderRadius: 999,
                padding: '7px 12px',
                background: 'rgba(255,255,255,0.72)',
                color: '#475569',
                fontWeight: 600,
                letterSpacing: '0.02em',
                boxShadow: '0 8px 18px rgba(15,23,42,0.06)',
              }}
            >
              {isIssueCollect ? '问题收集入口' : isMobileRecorder ? '会议录音入口' : 'AI MEETING WORKSPACE'}
            </Tag>}
            {!isExternalMeetingEntry && (
              <div className="login-brand-lockup">
                <span><SafetyCertificateOutlined /></span>
                <strong>AI 会议工作空间</strong>
              </div>
            )}
            {isExternalMeetingEntry && !isMobileRecorder && <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                background: 'rgba(255,255,255,0.72)',
                border: '1px solid rgba(15,23,42,0.06)',
                boxShadow: '0 18px 36px rgba(15,23,42,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(16px)',
              }}
            >
              {isMobileRecorder ? <MobileOutlined style={{ fontSize: 24, color: '#1d4ed8' }} /> : <SafetyCertificateOutlined style={{ fontSize: 24, color: '#1d4ed8' }} />}
            </div>}

            <Title
              level={1}
              style={{
                margin: isExternalMeetingEntry ? '10px 0 6px' : '26px 0 14px',
                fontSize: isExternalMeetingEntry ? 22 : 54,
                lineHeight: isExternalMeetingEntry ? 1.25 : 1.04,
                letterSpacing: isExternalMeetingEntry ? 0 : '-0.05em',
                color: '#111827',
                fontWeight: 700,
              }}
            >
              {isExternalMeetingEntry ? (
                meetingTitle
              ) : (
                <>
                  AI 会议
                  <br />
                  从议题，到共识。
                </>
              )}
            </Title>

            <Text
              style={{
                display: 'block',
                maxWidth: 520,
                fontSize: isExternalMeetingEntry ? 12 : 17,
                lineHeight: isExternalMeetingEntry ? 1.55 : 1.85,
                color: '#4b5563',
              }}
            >
              {isExternalMeetingEntry
                ? `${meetingDate} · ${projectName} · ${agenda}`
                : '把会前准备、现场讨论、决议签署和历史追溯放进一条清晰的工作流。普通会议直接开始，重大事项按需启用治理检查。'}
            </Text>

            {!isExternalMeetingEntry && (
              <div className="login-capability-grid">
                {[
                  [<MessageOutlined />, '议题管理', '结构化议题收集与分级'],
                  [<EditOutlined />, '实时记录', 'AI 转写与要点实时提炼'],
                  [<CheckSquareOutlined />, '决议追踪', '任务分配与进度自动追踪'],
                  [<DatabaseOutlined />, '知识沉淀', '会议资料归档与智能检索'],
                ].map(([icon, title, desc]) => (
                  <div key={title} className="login-capability-item"><span>{icon}</span><strong>{title}</strong><small>{desc}</small></div>
                ))}
              </div>
            )}
          </div>

          <Card
            className={isExiting ? 'login-form-card is-exiting' : 'login-form-card'}
            variant="borderless"
            style={{
              borderRadius: isExternalMeetingEntry ? 18 : 30,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.72))',
              border: '1px solid rgba(15,23,42,0.05)',
              boxShadow: '0 24px 80px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.85)',
              backdropFilter: 'blur(24px)',
              position: 'relative',
              overflow: 'hidden',
            }}
            styles={{ body: { padding: isExternalMeetingEntry ? 18 : 32 } }}
          >
            <div className="login-card-sheen" />

            <div style={{ marginBottom: isExternalMeetingEntry ? 12 : 22, position: 'relative', zIndex: 1 }}>
              <Text style={{ display: 'block', color: '#94a3b8', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                {isIssueCollect ? 'Issue Collect Sign In' : isMobileRecorder ? 'Recorder Sign In' : 'WELCOME BACK'}
              </Text>
              <Title level={3} style={{ margin: 0, color: '#111827', letterSpacing: '-0.03em', fontWeight: 650 }}>
                {isIssueCollect ? '进入问题填报' : isMobileRecorder ? '进入会议录音' : '登录'}
              </Title>
              <Text style={{ color: '#6b7280', lineHeight: isExternalMeetingEntry ? 1.55 : 1.75, fontSize: isExternalMeetingEntry ? 12 : undefined }}>
                {isIssueCollect
                  ? '登录或登记后填写事项，内容会回到秘书端议题池。'
                  : isMobileRecorder
                    ? '登录或登记后进入录音。已有参会身份请使用首次登记时设置的密码。'
                  : '请输入你的账号与密码。首次使用请联系管理员开通账号。'}
              </Text>
            </div>

            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16, borderRadius: 14, position: 'relative', zIndex: 1 }} />}

            {isExternalMeetingEntry && (
              <Segmented
                block
                value={authMode}
                onChange={value => {
                  setAuthMode(value);
                  setError('');
                }}
                options={[
                  { label: '首次登记', value: 'register' },
                  { label: '已有账号', value: 'login' },
                ]}
                style={{ marginBottom: 18, position: 'relative', zIndex: 1 }}
              />
            )}

            <Form
              key={`${entry}-${authMode}`}
              layout="vertical"
              onFinish={handleSubmit}
              initialValues={formInitialValues}
              style={{ position: 'relative', zIndex: 1 }}
            >
              {isExternalMeetingEntry && authMode === 'register' && (
                <>
                  <Form.Item
                    label={<span style={{ color: '#374151', fontWeight: 500 }}>真实姓名</span>}
                    name="name"
                    rules={[{ required: true, message: '请输入真实姓名' }]}
                  >
                    <Input
                      className="login-field"
                      prefix={<IdcardOutlined style={{ color: '#94a3b8' }} />}
                      size="large"
                      placeholder="例：刘强"
                      autoComplete="name"
                      style={{ height: 48, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span style={{ color: '#374151', fontWeight: 500 }}>部门 / 单位</span>}
                    name="dept"
                    rules={[{ required: true, message: '请输入部门或单位' }]}
                  >
                    <Input
                      className="login-field"
                      prefix={<TeamOutlined style={{ color: '#94a3b8' }} />}
                      size="large"
                      placeholder="例：经营管理层 / 项目管理部"
                      style={{ height: 48, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                    />
                  </Form.Item>

                  {isMobileRecorder ? (
                    <Space size={12} style={{ width: '100%' }} align="start">
                      <Form.Item
                        label={<span style={{ color: '#374151', fontWeight: 500 }}>会议角色</span>}
                        name="meeting_role"
                        rules={[{ required: true, message: '请输入会议角色' }]}
                        style={{ flex: 1 }}
                      >
                        <Input
                          className="login-field"
                          size="large"
                          placeholder="例：主要负责人"
                          style={{ height: 48, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                        />
                      </Form.Item>
                      <Form.Item
                        label={<span style={{ color: '#374151', fontWeight: 500 }}>席位</span>}
                        name="meeting_seat"
                        rules={[{ required: true, message: '请输入席位' }]}
                        style={{ width: 132 }}
                      >
                        <Input
                          className="login-field"
                          size="large"
                          placeholder="A01"
                          style={{ height: 48, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                        />
                      </Form.Item>
                    </Space>
                  ) : (
                    <>
                      <Form.Item name="meeting_role" hidden><Input /></Form.Item>
                      <Form.Item name="meeting_seat" hidden><Input /></Form.Item>
                    </>
                  )}
                </>
              )}

              <Form.Item
                label={<span style={{ color: '#374151', fontWeight: 500 }}>账号</span>}
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input
                  className="login-field"
                  prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                  size="large"
                  placeholder={isExternalMeetingEntry ? '设置或输入账号' : '输入用户名'}
                  autoComplete="username"
                  style={{ height: isExternalMeetingEntry ? 48 : 52, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#374151', fontWeight: 500 }}>密码</span>}
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  className="login-field"
                  prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                  size="large"
                  placeholder={authMode === 'register' ? '设置 6 位以上密码' : '输入密码'}
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  style={{ height: isExternalMeetingEntry ? 48 : 52, borderRadius: 16, background: 'rgba(255,255,255,0.92)' }}
                />
              </Form.Item>

              {!isExternalMeetingEntry && (
                <div className="login-account-options">
                  <Checkbox checked={rememberAccount} onChange={event => setRememberAccount(event.target.checked)}>
                    记住账号
                  </Checkbox>
                  <button type="button" className="login-forgot-link" onClick={() => message.info('请联系系统管理员重置密码')}>忘记密码？</button>
                </div>
              )}

              <Button
                htmlType="submit"
                type="primary"
                size="large"
                block
                disabled={loading}
                className={isAnimatingButton ? 'login-launch-button is-launching' : 'login-launch-button'}
                style={{
                  height: 50,
                  width: isAnimatingButton ? 56 : '100%',
                  minWidth: isAnimatingButton ? 56 : '100%',
                  borderRadius: isAnimatingButton ? 999 : 16,
                  marginTop: 8,
                  background: '#0A65CC',
                  borderColor: '#0A65CC',
                  boxShadow: '0 14px 30px rgba(10,101,204,0.22)',
                  transition: 'width 820ms cubic-bezier(0.34, 1.56, 0.38, 1), min-width 820ms cubic-bezier(0.34, 1.56, 0.38, 1), border-radius 820ms cubic-bezier(0.34, 1.56, 0.38, 1), transform 260ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                  transform: launchPhase === 'collapsing' ? 'scale(0.965)' : launchPhase === 'spinning' ? 'scale(1.03)' : 'scale(1)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transform: isAnimatingButton ? 'scale(0.97)' : 'scale(1)',
                    transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                >
                  <span
                    style={{
                      opacity: isAnimatingButton ? 0 : 1,
                      transform: isAnimatingButton ? 'translateY(8px) scale(0.94)' : 'translateY(0) scale(1)',
                      transition: 'opacity 220ms cubic-bezier(0.32, 0, 0.67, 0), transform 340ms cubic-bezier(0.16, 1, 0.3, 1)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isExternalMeetingEntry ? submitText : '登录'}
                  </span>
                  <span
                    style={{
                      position: isAnimatingButton ? 'absolute' : 'static',
                      opacity: showSpinner ? 1 : 0,
                      transform: showSpinner ? 'scale(1)' : 'scale(0.76)',
                      transition: 'opacity 220ms ease, transform 320ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    <span className={showSpinner ? 'login-launch-spinner is-spinning' : 'login-launch-spinner'}>
                      <span className="login-launch-spinner-core" />
                    </span>
                  </span>
                </span>
              </Button>

              {!isExternalMeetingEntry && (
                <div className="login-alt-entry"><span>其他登录方式</span><button type="button" aria-label="安全认证登录"><SafetyCertificateOutlined /></button></div>
              )}

              <Text className="login-legal-copy" style={{ display: 'block', marginTop: 14, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                {isIssueCollect
                  ? '提交内容会写入当前会议的问题收集区，并进入 AI 议题梳理流程。'
                  : isMobileRecorder
                    ? '进入后系统会记录账号、角色、设备与录音状态，用于会后声纹分轨和审查溯源。'
                  : <>登录即表示你同意我们的 <a href="#user-agreement">《用户协议》</a> 和 <a href="#privacy-policy">《隐私政策》</a></>}
              </Text>
            </Form>
          </Card>
        </div>
      </div>

      <style>{`
        html.mobile-recorder-scroll,
        body.mobile-recorder-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          overscroll-behavior-y: contain;
        }

        body.mobile-recorder-scroll #root,
        #root.mobile-recorder-scroll {
          height: auto !important;
          min-height: 100dvh !important;
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }

        .login-minimal-shell::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.76), transparent 18%),
            radial-gradient(circle at calc(var(--mx) - 12%) calc(var(--my) + 8%), rgba(191,219,254,0.42), transparent 22%);
          pointer-events: none;
        }

        .login-minimal-shell:not(.is-mobile-recorder) {
          background:
            radial-gradient(circle at 24% 34%, rgba(224,236,252,.82), transparent 31%),
            radial-gradient(circle at 78% 15%, rgba(238,244,252,.92), transparent 34%),
            linear-gradient(135deg, #f9fbfe 0%, #f4f7fb 52%, #eef3f9 100%) !important;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-minimal-ambient-b {
          background: radial-gradient(circle, rgba(177,207,246,.46), rgba(216,232,252,.04) 72%);
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-hero-panel {
          max-width: 1540px !important;
          grid-template-columns: minmax(620px, 1fr) minmax(500px, 560px) !important;
          gap: 96px !important;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-copy-panel {
          position: relative;
          min-height: 760px;
          padding: 36px 28px 40px 24px !important;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-copy-panel::after {
          content: '';
          position: absolute;
          z-index: -1;
          left: -30px;
          right: 30px;
          bottom: -92px;
          height: 260px;
          border-radius: 50% 50% 12% 12% / 35% 35% 12% 12%;
          background:
            radial-gradient(ellipse at center, rgba(255,255,255,.95) 0 44%, rgba(211,222,236,.88) 45% 48%, transparent 49%),
            linear-gradient(180deg, rgba(255,255,255,0), rgba(208,220,235,.55));
          filter: drop-shadow(0 34px 38px rgba(60,86,118,.14));
          opacity: .84;
          pointer-events: none;
        }

        .login-brand-lockup {
          position: absolute;
          top: 18px;
          left: 24px;
          display: flex;
          align-items: center;
          gap: 13px;
          color: #17243a;
        }

        .login-brand-lockup > span {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          color: #fff;
          background: linear-gradient(145deg, #164c99, #0a2d67);
          box-shadow: 0 10px 24px rgba(17,65,129,.2);
          font-size: 20px;
        }

        .login-brand-lockup strong {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -.01em;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-copy-panel h1.ant-typography {
          margin: 0 0 22px !important;
          max-width: 720px;
          color: #0d1930 !important;
          font-size: clamp(56px, 4.7vw, 78px) !important;
          line-height: 1.32 !important;
          letter-spacing: -.055em !important;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-copy-panel h1.ant-typography::after {
          content: '';
          display: block;
          width: 42px;
          height: 4px;
          margin-top: 28px;
          border-radius: 999px;
          background: #4c83ff;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-copy-panel > .ant-typography {
          max-width: 610px !important;
          color: #536177 !important;
          font-size: 17px !important;
          line-height: 1.9 !important;
        }

        .login-capability-grid {
          width: min(700px, 100%);
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 18px;
          margin-top: 34px;
        }

        .login-capability-item {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr);
          gap: 2px 10px;
          min-width: 0;
        }

        .login-capability-item > span {
          width: 42px;
          height: 42px;
          grid-row: 1 / 3;
          display: grid;
          place-items: center;
          border-radius: 12px;
          color: #3978dd;
          background: rgba(255,255,255,.82);
          box-shadow: 0 9px 24px rgba(43,74,112,.08);
          font-size: 19px;
        }

        .login-capability-item:nth-child(2) > span { color: #39a877; background: rgba(238,251,245,.9); }
        .login-capability-item:nth-child(3) > span { color: #ef9a31; background: rgba(255,248,235,.92); }
        .login-capability-item:nth-child(4) > span { color: #7b61db; background: rgba(246,242,255,.92); }
        .login-capability-item strong { align-self: end; color: #253248; font-size: 13px; white-space: nowrap; }
        .login-capability-item small { color: #8793a5; font-size: 10px; line-height: 1.45; }

        .login-minimal-shell:not(.is-mobile-recorder) .login-form-card {
          width: 100%;
          border-radius: 40px !important;
          background: rgba(255,255,255,.9) !important;
          box-shadow: 0 32px 90px rgba(41,62,91,.13), inset 0 1px 0 #fff !important;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-form-card .ant-card-body {
          padding: 54px 58px 44px !important;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-form-card h3.ant-typography {
          font-size: 34px;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-form-card .ant-form-item {
          margin-bottom: 22px;
        }

        .login-minimal-shell:not(.is-mobile-recorder) .login-field {
          height: 58px !important;
          border-radius: 13px !important;
          font-size: 15px;
        }

        .login-forgot-link {
          padding: 0;
          border: 0;
          color: #4b83e8;
          background: transparent;
          cursor: pointer;
          font-size: 13px;
        }

        .login-alt-entry {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 16px;
          margin-top: 32px;
          color: #7b8799;
          font-size: 12px;
          text-align: center;
        }

        .login-alt-entry::before,
        .login-alt-entry::after {
          content: '';
          height: 1px;
          background: #e5e9ef;
        }

        .login-alt-entry button {
          grid-column: 1 / -1;
          justify-self: center;
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border: 1px solid #e0e6ee;
          border-radius: 50%;
          color: #31557f;
          background: #fff;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(34,57,84,.06);
          font-size: 19px;
        }

        .login-legal-copy { text-align: center; }
        .login-legal-copy a { color: #4c83e8; text-decoration: none; }

        .login-minimal-shell {
          transition: opacity 560ms ease, transform 820ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .login-minimal-shell.is-exiting {
          opacity: 0.94;
          transform: scale(1.01);
        }

        .login-minimal-ambient {
          position: absolute;
          border-radius: 999px;
          filter: blur(26px);
          pointer-events: none;
          opacity: 0.9;
        }

        .login-minimal-ambient-a {
          width: 420px;
          height: 420px;
          left: -90px;
          top: -80px;
          background: radial-gradient(circle, rgba(191,219,254,0.92), rgba(191,219,254,0.08) 70%);
          animation: loginMinimalFloatA 18s ease-in-out infinite;
        }

        .login-minimal-ambient-b {
          width: 360px;
          height: 360px;
          right: -80px;
          bottom: -70px;
          background: radial-gradient(circle, rgba(216,180,254,0.52), rgba(216,180,254,0.06) 72%);
          animation: loginMinimalFloatB 22s ease-in-out infinite;
        }

        .login-minimal-pointer-glow {
          position: absolute;
          left: calc(var(--mx) - 180px);
          top: calc(var(--my) - 180px);
          width: 360px;
          height: 360px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.68), rgba(255,255,255,0.08) 58%, transparent 72%);
          filter: blur(14px);
          pointer-events: none;
        }

        .login-minimal-noise {
          position: absolute;
          inset: 0;
          opacity: 0.18;
          background-image:
            linear-gradient(rgba(255,255,255,0.38) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.32) 1px, transparent 1px);
          background-size: 36px 36px;
          mask-image: radial-gradient(circle at center, rgba(0,0,0,0.42), transparent 86%);
          pointer-events: none;
        }

        @keyframes loginMinimalFloatA {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(24px, 20px, 0) scale(1.04); }
        }

        @keyframes loginMinimalFloatB {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-22px, -18px, 0) scale(0.98); }
        }

        @media (max-width: 960px) {
          .login-minimal-shell div[style*='grid-template-columns'] {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 640px) {
          .login-minimal-shell.is-mobile-recorder .login-hero-panel {
            gap: 18px !important;
          }

          .login-minimal-shell.is-mobile-recorder .login-copy-panel {
            padding: 8px 4px 0 !important;
          }

          .login-minimal-shell.is-mobile-recorder .login-copy-panel .ant-typography {
            margin-bottom: 10px !important;
          }

          .login-minimal-shell.is-mobile-recorder .login-form-card {
            border-radius: 18px !important;
          }

          .login-minimal-shell.is-mobile-recorder .ant-card-body {
            padding: 18px !important;
          }

          .login-minimal-shell.is-mobile-recorder .ant-form-item {
            margin-bottom: 12px !important;
          }

          .login-minimal-shell.is-mobile-recorder .ant-segmented {
            margin-bottom: 12px !important;
          }

          .login-minimal-shell.is-mobile-recorder .login-field {
            height: 42px !important;
            border-radius: 12px !important;
          }
        }

        .login-hero-panel {
          transition: transform 880ms cubic-bezier(0.22, 1, 0.36, 1), opacity 560ms ease, filter 560ms ease;
          transform-origin: center center;
        }

        .login-hero-panel.is-exiting {
          transform: translateY(-12px) scale(0.992);
          opacity: 0.9;
          filter: blur(2px);
        }

        .login-copy-panel {
          transition: transform 720ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease, filter 420ms ease;
        }

        .login-copy-panel.is-exiting {
          transform: translateX(-24px) translateY(-4px);
          opacity: 0;
          filter: blur(6px);
        }

        .login-form-card {
          transition: transform 680ms cubic-bezier(0.18, 0.88, 0.2, 1), opacity 520ms ease, box-shadow 520ms ease, filter 520ms ease;
          transform-origin: center center;
          will-change: transform, opacity, filter;
        }

        .login-form-card.is-exiting {
          transform: translateY(-20px) scale(1.045);
          opacity: 0;
          filter: blur(10px);
          box-shadow: 0 40px 110px rgba(15,23,42,0.06);
        }

        .login-card-sheen {
          position: absolute;
          inset: 0 auto auto 0;
          width: 100%;
          height: 120px;
          background: linear-gradient(180deg, rgba(255,255,255,0.58), rgba(255,255,255,0));
          pointer-events: none;
        }

        .login-field.ant-input-affix-wrapper,
        .login-field.ant-input-password {
          border: 1px solid rgba(148,163,184,0.22);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.92);
          transition: border-color 180ms ease, box-shadow 220ms ease, background 180ms ease, transform 180ms ease;
        }

        .login-field.ant-input-affix-wrapper:hover,
        .login-field.ant-input-password:hover {
          border-color: rgba(100,116,139,0.28);
          background: rgba(255,255,255,0.98) !important;
        }

        .login-field.ant-input-affix-wrapper:focus,
        .login-field.ant-input-affix-wrapper-focused,
        .login-field.ant-input-password:focus,
        .login-field.ant-input-password-focused {
          border-color: rgba(37,99,235,0.34) !important;
          box-shadow:
            0 0 0 4px rgba(59,130,246,0.10),
            inset 0 1px 0 rgba(255,255,255,0.96) !important;
          background: rgba(255,255,255,1) !important;
          transform: translateY(-1px);
        }

        .login-account-options {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: -2px 0 4px;
          color: #526176;
          font-size: 12px;
        }

        .login-account-options .ant-checkbox-wrapper {
          color: #526176;
          font-size: 12px;
        }

        .login-account-options .ant-checkbox-inner {
          border-radius: 5px;
        }

        .login-account-help {
          color: #9aa3b1;
          white-space: nowrap;
        }

        .login-launch-button:hover {
          transform: translateY(-1px) scale(1.002);
          box-shadow: 0 18px 34px rgba(17,24,39,0.18) !important;
        }

        .login-launch-button.is-launching:hover {
          transform: none;
        }

        .login-launch-spinner {
          width: 22px;
          height: 22px;
          display: inline-block;
          position: relative;
          border-radius: 50%;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.05),
            0 0 18px rgba(255,255,255,0.18);
          background:
            radial-gradient(circle at center, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 62%, transparent 68%);
        }

        .login-launch-spinner.is-spinning {
          animation: loginButtonSpinner 980ms cubic-bezier(0.55, 0.08, 0.32, 0.97) infinite;
        }

        .login-launch-spinner::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            conic-gradient(
              from 210deg,
              rgba(255,255,255,0.04) 0deg,
              rgba(255,255,255,0.08) 70deg,
              rgba(255,255,255,0.98) 138deg,
              rgba(255,255,255,0.14) 212deg,
              rgba(255,255,255,0.04) 360deg
            );
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
          box-shadow: inset 0 0 8px rgba(255,255,255,0.12);
        }

        .login-launch-spinner::after {
          content: '';
          position: absolute;
          inset: 3px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.14), rgba(255,255,255,0.02) 72%, transparent 76%);
          opacity: 0.9;
        }

        .login-launch-spinner-core {
          position: absolute;
          inset: 7px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,1), rgba(255,255,255,0.72) 38%, rgba(255,255,255,0.08) 78%, transparent 82%);
          box-shadow:
            0 0 10px rgba(255,255,255,0.65),
            0 0 20px rgba(255,255,255,0.22);
          animation: loginSpinnerPulse 920ms ease-in-out infinite;
        }

        @keyframes loginButtonSpinner {
          0% {
            transform: rotate(0deg) scale(0.9);
            opacity: 0.88;
          }
          45% {
            transform: rotate(182deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: rotate(360deg) scale(1);
            opacity: 1;
          }
        }

        @keyframes loginSpinnerPulse {
          0%, 100% {
            transform: scale(0.88);
            opacity: 0.82;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .login-minimal-shell,
          .login-hero-panel,
          .login-copy-panel,
          .login-form-card,
          .login-minimal-ambient,
          .login-launch-spinner.is-spinning {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
