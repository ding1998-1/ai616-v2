import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Spin } from 'antd';
import { renderAsync } from 'docx-preview';
import { getStoredToken } from '../lib/auth';

export default function DocxPreviewModal({ open, savedName, title, onClose }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !savedName) return undefined;

    let cancelled = false;
    const loadPreview = async () => {
      setLoading(true);
      setError('');
      try {
        const token = getStoredToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`/api/doc/download/${encodeURIComponent(savedName)}`, { headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        await renderAsync(blob, containerRef.current, containerRef.current, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: false,
          renderChanges: false,
          useBase64URL: true,
          experimental: true,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'DOCX 预览加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [open, savedName]);

  return (
    <Modal
      open={open}
      title={title || 'DOCX 预览'}
      onCancel={onClose}
      footer={null}
      width={1080}
      styles={{ body: { paddingTop: 12 } }}
    >
      <div style={{ minHeight: 520, position: 'relative' }}>
        {error && (
          <Alert
            type="error"
            showIcon
            message="无法打开 DOCX 预览"
            description={error}
            style={{ marginBottom: 12 }}
          />
        )}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120 }}>
            <Spin />
          </div>
        )}
        <div
          className="docx-preview-shell"
          style={{
            maxHeight: 680,
            overflow: 'auto',
            background: '#eef2f7',
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div ref={containerRef} />
        </div>
      </div>

      <style>{`
        .docx-preview-shell .docx-wrapper {
          padding: 0;
          background: transparent;
        }
        .docx-preview-shell .docx-wrapper > section.docx {
          margin: 0 auto 18px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
        }
      `}</style>
    </Modal>
  );
}
