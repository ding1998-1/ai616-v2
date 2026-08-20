import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Segmented, Space, Tag, Typography, message } from 'antd';
import { IdcardOutlined, LockOutlined, MobileOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { setStoredToken } from '../lib/auth';

const { Title, Text } = Typography;

export default function LoginPage({ onLogin, entry = 'app' }) {
  const isMobileRecorder = entry === 'mobile-recorder';
  const isIssueCollect = entry === 'issue-collect';
  const isExternalMeetingEntry = isMobileRecorder || isIssueCollect;
  const [loading, setLoading] = useState(false);
  const [launchPhase, setLaunchPhase] = useState('idle');
  const [error, setError] = useState('');
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
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    setLaunchPhase('exiting');
    await new Promise((resolve) => window.setTimeout(resolve, 680));
    onLogin?.(data.user);
  };

  const handleLogin = async (values) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: values.username, password: values.password }),
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
    : { username: isExternalMeetingEntry ? '' : 'admin', password: '' };

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
            <Tag
              bordered={false}
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
              {isIssueCollect ? '问题收集入口' : isMobileRecorder ? '会议录音入口' : 'Secure Internal Workspace'}
            </Tag>
            {!isMobileRecorder && <div
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
                  合规系统
                  <br />
                  更安静地工作。
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
                : '登录后进入“三重一大”审查、合同比对、规则管理与知识联动工作台。背景会轻微跟随鼠标变化，但不会干扰表单操作。'}
            </Text>

            {!isMobileRecorder && <Space wrap size={10} style={{ marginTop: 26 }}>
              {(isMobileRecorder ? ['账号实名', '角色绑定', '录音转写', '留痕归档'] : ['三重一大', '合同审查', '规则 PDF', '知识联动']).map((item) => (
                <Tag
                  key={item}
                  bordered={false}
                  style={{
                    borderRadius: 999,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.62)',
                    color: '#334155',
                    boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.14)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {item}
                </Tag>
              ))}
            </Space>}
          </div>

          <Card
            className={isExiting ? 'login-form-card is-exiting' : 'login-form-card'}
            bordered={false}
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
                {isIssueCollect ? 'Issue Collect Sign In' : isMobileRecorder ? 'Recorder Sign In' : 'Sign In'}
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
                  background: '#111827',
                  borderColor: '#111827',
                  boxShadow: '0 14px 30px rgba(17,24,39,0.16)',
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
                    {submitText}
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

              <Text style={{ display: 'block', marginTop: 14, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                {isIssueCollect
                  ? '提交内容会写入当前会议的问题收集区，并进入 AI 议题梳理流程。'
                  : isMobileRecorder
                    ? '进入后系统会记录账号、角色、设备与录音状态，用于会后声纹分轨和审查溯源。'
                  : '登录即表示进入内部受控工作区，所有审查行为将进入系统留痕。'}
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
      `}</style>
    </div>
  );
}
