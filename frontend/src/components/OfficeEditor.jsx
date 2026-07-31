import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Modal, Spin, message as antMessage, Button, Space, Badge, Tag, Alert, Tooltip, Divider, Switch } from 'antd';
import { authFetch } from '../lib/auth';
import {
  FileTextOutlined,
  CloseOutlined,
  AimOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  SaveOutlined,
  UndoOutlined,
  RedoOutlined,
  PrinterOutlined,
  SearchOutlined,
  EditOutlined,
  CommentOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons';

const OFFICE_TABS = ['开始', '插入', '布局', '审阅', '视图'];
const PAGE_PARAGRAPH_SPAN = 12;
const RIBBON_GROUPS = [
  { title: '剪贴板', buttons: [{ icon: <SaveOutlined />, label: '保存' }, { icon: <UndoOutlined />, label: '撤销' }, { icon: <RedoOutlined />, label: '恢复' }] },
  { title: '查找', buttons: [{ icon: <SearchOutlined />, label: '定位' }, { icon: <PrinterOutlined />, label: '打印' }] },
  { title: '审阅', buttons: [{ icon: <AimOutlined />, label: '问题导航' }, { icon: <CheckCircleOutlined />, label: '已校验' }] },
];

function normalizeText(value = '') {
  return String(value).replace(/\s+/g, '').replace(/\u200b/g, '').trim();
}

function decorateParagraph(node, issue) {
  const isResolved = issue?.status === 'resolved';
  const color = isResolved
    ? { bg: 'rgba(34,197,94,0.10)', border: '#22c55e' }
    : issue?.severity === 'high'
      ? { bg: 'rgba(239,68,68,0.12)', border: '#ef4444' }
      : issue?.severity === 'low'
        ? { bg: 'rgba(34,197,94,0.08)', border: '#22c55e' }
        : { bg: 'rgba(245,158,11,0.10)', border: '#f59e0b' };

  node.style.background = color.bg;
  node.style.borderLeft = `4px solid ${color.border}`;
  node.style.padding = '10px 12px';
  node.style.borderRadius = '10px';
  node.style.marginLeft = '-12px';
  node.style.marginRight = '-12px';
}

function clearParagraphDecorations(node) {
  if (!node) return;
  node.style.background = '';
  node.style.borderLeft = '';
  node.style.padding = '';
  node.style.borderRadius = '';
  node.style.marginLeft = '';
  node.style.marginRight = '';
  node.style.opacity = '';
  node.style.filter = '';
  node.style.position = '';
  node.style.outline = '';
  node.removeAttribute('data-review-comment-label');
  node.removeAttribute('title');
}

function buildPageOutline(paragraphs = [], issues = []) {
  if (!paragraphs.length) {
    return [{
      pageNumber: 1,
      startPara: 0,
      endPara: 0,
      issueCount: 0,
      preview: '空白页',
      miniLines: ['......', '......', '......', '......'],
    }];
  }

  const pages = [];
  for (let start = 0; start < paragraphs.length; start += PAGE_PARAGRAPH_SPAN) {
    const slice = paragraphs.slice(start, start + PAGE_PARAGRAPH_SPAN);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const issueCount = issues.filter(issue => (
      issue?.para_index != null &&
      issue.para_index >= first.para_index &&
      issue.para_index <= last.para_index
    )).length;

    pages.push({
      pageNumber: pages.length + 1,
      startPara: first.para_index,
      endPara: last.para_index,
      issueCount,
      preview: (first.text || '空白页').replace(/\s+/g, ' ').slice(0, 28),
      miniLines: slice.slice(0, 4).map(item => (item.text || '').replace(/\s+/g, ' ').slice(0, 22) || '......'),
    });
  }

  return pages;
}

function collectPreviewParagraphNodes(container) {
  if (!container) return [];
  const selectors = [
    '.docx p',
    '.docx li',
    '.docx h1',
    '.docx h2',
    '.docx h3',
    '.docx h4',
    '.docx h5',
    '.docx h6',
  ].join(',');

  return Array.from(container.querySelectorAll(selectors)).filter(node => {
    const text = normalizeText(node.textContent || '');
    if (!text) return false;
    if (node.closest('header, footer')) return false;
    return true;
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStructuredFallback(container, paragraphs = []) {
  if (!container) return;
  const sections = [];

  for (let start = 0; start < paragraphs.length; start += PAGE_PARAGRAPH_SPAN) {
    const slice = paragraphs.slice(start, start + PAGE_PARAGRAPH_SPAN);
    const html = slice.map(item => (
      `<p data-para-index="${item.para_index}" style="margin: 0 0 16px; color: #111827; line-height: 1.95; font-size: 15px;">${escapeHtml(item.text || item.text_preview || '')}</p>`
    )).join('');

    sections.push(`
      <section class="docx">
        ${html || '<p style="color:#94a3b8;">空白页</p>'}
      </section>
    `);
  }

  container.innerHTML = `<div class="docx-wrapper">${sections.join('')}</div>`;
}

function buildDocDownloadUrl(savedName = '') {
  if (!savedName) return '';
  return `/api/doc/download/${encodeURIComponent(savedName)}`;
}

function scoreParagraphMatch(sourceText, candidateText) {
  if (!sourceText || !candidateText) return 0;
  if (sourceText === candidateText) return 1000;

  const sourcePrefix = sourceText.slice(0, Math.min(22, sourceText.length));
  const candidatePrefix = candidateText.slice(0, Math.min(22, candidateText.length));

  if (candidateText.includes(sourcePrefix) || sourceText.includes(candidatePrefix)) {
    return 840 - Math.abs(sourceText.length - candidateText.length);
  }

  let sameHead = 0;
  while (
    sameHead < sourceText.length &&
    sameHead < candidateText.length &&
    sourceText[sameHead] === candidateText[sameHead]
  ) {
    sameHead += 1;
  }

  return sameHead >= 10 ? (700 + sameHead - Math.abs(sourceText.length - candidateText.length)) : 0;
}

function buildParagraphNodeMap(paragraphs, container) {
  const candidates = collectPreviewParagraphNodes(container);
  const map = new Map();
  const taggedMap = new Map(
    candidates
      .map(node => [Number(node.dataset.paraIndex), node])
      .filter(([paraIndex]) => Number.isFinite(paraIndex)),
  );
  let cursor = 0;

  paragraphs.forEach(paragraph => {
    if (taggedMap.has(paragraph.para_index)) {
      map.set(paragraph.para_index, taggedMap.get(paragraph.para_index));
      return;
    }

    const sourceText = normalizeText(paragraph.text || paragraph.text_preview || '');
    if (!sourceText) return;

    let bestIndex = -1;
    let bestScore = 0;

    for (let index = cursor; index < candidates.length; index += 1) {
      const candidateText = normalizeText(candidates[index].textContent || '');
      const score = scoreParagraphMatch(sourceText, candidateText);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
        if (score >= 980) break;
      }

      if (index - cursor > 28 && bestScore >= 780) break;
      if (index - cursor > 60 && bestScore === 0) break;
    }

    if (bestIndex >= 0 && bestScore >= 620) {
      const node = candidates[bestIndex];
      node.dataset.paraIndex = String(paragraph.para_index);
      map.set(paragraph.para_index, node);
      cursor = bestIndex + 1;
    }
  });

  return map;
}

async function waitForPreviewContainer(previewRef, timeoutMs = 2500) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (previewRef.current) return previewRef.current;
    await new Promise(resolve => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  }
  return previewRef.current;
}

export default function OfficeEditor({
  open,
  savedName,
  issues,
  initialParagraphs = [],
  onClose,
  onSave,
  isEmbedded = false,
  targetParaIndex = null,
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isDocReady, setIsDocReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('已保存');
  const [paragraphCount, setParagraphCount] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [paragraphs, setParagraphs] = useState([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [issueCursor, setIssueCursor] = useState(0);
  const [activeTab, setActiveTab] = useState('审阅');
  const [editedParagraphs, setEditedParagraphs] = useState({});
  const [exporting, setExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [previewMode, setPreviewMode] = useState('docx');
  const [reviewSettings, setReviewSettings] = useState({
    trackChanges: true,
    comments: true,
    focusRiskOnly: false,
    issuePagesOnly: false,
  });

  const shellRef = useRef(null);
  const previewRef = useRef(null);
  const scrollRef = useRef(null);
  const loadedNameRef = useRef(null);
  const paragraphNodeMapRef = useRef(new Map());
  const renderSessionRef = useRef(0);

  const friendlyName = useMemo(() => {
    if (!savedName) return '';
    const parts = decodeURIComponent(savedName).split('_');
    return parts.length > 1 ? parts.slice(1).join('_') : savedName;
  }, [savedName]);

  const issueParagraphs = useMemo(
    () => Array.from(new Set((issues || []).map(item => item?.para_index).filter(item => item != null))).sort((a, b) => a - b),
    [issues],
  );

  const pageOutline = useMemo(
    () => buildPageOutline(paragraphs, issues || []),
    [paragraphs, issues],
  );

  const visiblePageOutline = useMemo(
    () => (reviewSettings.issuePagesOnly ? pageOutline.filter(page => page.issueCount > 0) : pageOutline),
    [pageOutline, reviewSettings.issuePagesOnly],
  );

  const activeVisiblePageIndex = useMemo(
    () => visiblePageOutline.findIndex(page => page.pageNumber - 1 === activePageIndex),
    [visiblePageOutline, activePageIndex],
  );

  const applyPreviewState = () => {
    const map = paragraphNodeMapRef.current;
    const touchedNodes = new Set(map.values());

    touchedNodes.forEach(node => {
      clearParagraphDecorations(node);
    });

    map.forEach((node, paraIndex) => {
      const editedText = editedParagraphs[paraIndex];
      if (editedText && node.dataset.editedText !== editedText) {
        node.textContent = editedText;
        node.dataset.editedText = editedText;
      }

      const issue = (issues || []).find(item => item?.para_index === paraIndex);
      if (issue && reviewSettings.trackChanges) {
        decorateParagraph(node, issue);
      }
      if (issue && reviewSettings.comments) {
        node.style.position = 'relative';
        node.setAttribute('data-review-comment-label', issue.category || '批注');
        node.setAttribute('title', issue.reason || issue.rule || issue.issueDesc || '审阅意见');
      }
      if (reviewSettings.focusRiskOnly && !issue) {
        node.style.opacity = '0.38';
        node.style.filter = 'grayscale(0.15)';
      }
    });
  };

  const syncParagraphNodes = () => {
    if (!previewRef.current || !paragraphs.length) return;
    paragraphNodeMapRef.current = buildParagraphNodeMap(paragraphs, previewRef.current);
    applyPreviewState();
  };

  const locateParagraph = (paraIndex, options = {}) => {
    if (paraIndex == null) return;
    const node = paragraphNodeMapRef.current.get(paraIndex);
    if (!node) return;
    const scrollContainer = scrollRef.current;

    const action = options.action || 'locate';
    if (action === 'replace' && options.replaceText?.trim()) {
      const nextText = options.replaceText.trim();
      setEditedParagraphs(prev => ({ ...prev, [paraIndex]: nextText }));
      node.textContent = nextText;
      node.dataset.editedText = nextText;
      setSaveStatus('已应用建议');
    }

    if (scrollContainer) {
      const nodeRect = node.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const nextTop = scrollContainer.scrollTop + (nodeRect.top - containerRect.top) - (containerRect.height / 2) + (nodeRect.height / 2);
      scrollContainer.scrollTo({
        top: Math.max(nextTop, 0),
        behavior: 'smooth',
      });
    }
    node.style.background = action === 'replace' ? 'rgba(34,197,94,0.16)' : 'rgba(59,130,246,0.14)';
    node.style.outline = action === 'replace'
      ? '2px solid rgba(34,197,94,0.55)'
      : '2px solid rgba(59,130,246,0.45)';

    const matchedIssueCursor = issueParagraphs.findIndex(item => item === paraIndex);
    if (matchedIssueCursor >= 0) {
      setIssueCursor(matchedIssueCursor);
    }

    window.setTimeout(() => {
      node.style.outline = '';
      applyPreviewState();
    }, 1800);
  };

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!open || !savedName) {
      if (!open) {
        setIsDocReady(false);
        setLoadError(null);
        setParagraphCount(0);
        setParagraphs([]);
        setEditedParagraphs({});
        setPreviewMode('docx');
        setSaveStatus('已保存');
        setActivePageIndex(0);
        setIssueCursor(0);
        setActiveTab('审阅');
        setReviewSettings({
          trackChanges: true,
          comments: true,
          focusRiskOnly: false,
          issuePagesOnly: false,
        });
        loadedNameRef.current = null;
        paragraphNodeMapRef.current = new Map();
      }
      return;
    }

    if (loadedNameRef.current !== savedName) {
      void (async () => {
        setLoading(true);
        setLoadError(null);
        setIsDocReady(false);
        setEditedParagraphs({});
        setParagraphs([]);
        paragraphNodeMapRef.current = new Map();
        renderSessionRef.current += 1;
        const renderToken = renderSessionRef.current;

        try {
          const fileExt = (savedName.split('?')[0].split('.').pop() || 'docx').toLowerCase();
          const fileUrl = buildDocDownloadUrl(savedName);
          let nextParagraphs = [];

          if (fileExt === 'docx') {
            nextParagraphs = Array.isArray(initialParagraphs) && initialParagraphs.length
              ? initialParagraphs
              : [];

            if (!nextParagraphs.length) {
              const structureResp = await authFetch('/api/contract/map_doc_structure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ saved_name: savedName }),
              });
              if (!structureResp.ok) throw new Error(`结构解析失败：HTTP ${structureResp.status}`);
              const structureData = await structureResp.json();
              nextParagraphs = structureData.paragraphs || [];
            }

            setParagraphs(nextParagraphs);
            setParagraphCount(nextParagraphs.length);

            const fileResp = await authFetch(fileUrl);
            if (!fileResp.ok) throw new Error(`获取文档内容失败：${fileResp.status}`);
            const blob = await fileResp.blob();

            const previewContainer = await waitForPreviewContainer(previewRef);
            if (!previewContainer) throw new Error('预览容器未就绪');
            previewContainer.innerHTML = '';

            if (isEmbedded) {
              renderStructuredFallback(previewContainer, nextParagraphs);
              setPreviewMode('fallback');
            } else {
            let fallbackActivated = false;
            try {
              await renderAsync(blob, previewContainer, previewContainer, {
                className: 'docx',
                inWrapper: true,
                breakPages: true,
                ignoreWidth: false,
                ignoreHeight: false,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
                renderEndnotes: true,
                renderComments: false,
                renderChanges: false,
                useBase64URL: true,
                experimental: true,
              });

              const previewNodes = collectPreviewParagraphNodes(previewContainer);
              const hasVisiblePreview = previewNodes.length > 0 || normalizeText(previewContainer.textContent || '').length > 24;
              if (!hasVisiblePreview && nextParagraphs.length) {
                renderStructuredFallback(previewContainer, nextParagraphs);
                setPreviewMode('fallback');
                fallbackActivated = true;
                antMessage.warning({ content: '当前文档已切换为兼容预览', duration: 2 });
              }
            } catch (renderError) {
              if (!nextParagraphs.length) {
                throw renderError;
              }
              renderStructuredFallback(previewContainer, nextParagraphs);
              setPreviewMode('fallback');
              fallbackActivated = true;
              antMessage.warning({ content: '当前文档高保真渲染失败，已切换为兼容预览', duration: 2.4 });
            }

            if (!fallbackActivated) {
              setPreviewMode('docx');
            }
            }
          } else {
            const fileResp = await authFetch(fileUrl);
            if (!fileResp.ok) throw new Error(`获取文档内容失败：${fileResp.status}`);
            const text = await fileResp.text();
            setParagraphCount(text.split('\n').filter(Boolean).length);
            setParagraphs(text.split('\n').filter(Boolean).map((line, index) => ({
              para_index: index,
              text: line,
            })));

            const previewContainer = await waitForPreviewContainer(previewRef);
            if (previewContainer) {
              previewContainer.innerHTML = `
                <div class="docx-wrapper">
                  <section class="docx">
                    <pre style="white-space: pre-wrap; line-height: 1.95; font-size: 15px; color: #111827; margin: 0;">${text}</pre>
                  </section>
                </div>
              `;
            }
            setPreviewMode('text');
          }

          if (renderToken !== renderSessionRef.current) return;

          loadedNameRef.current = savedName;
          setLoadedAt(new Date());
          setIsDocReady(true);
          setSaveStatus('已保存');
          antMessage.success({ content: '文档预览加载成功', duration: 2 });
        } catch (err) {
          antMessage.error(`无法打开文档预览：${err.message}`);
          setLoadError(err.message);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [open, savedName, issues, initialParagraphs, reloadTick]);

  useEffect(() => {
    if (!isDocReady || !previewRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      syncParagraphNodes();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isDocReady, paragraphs, issues, reviewSettings, editedParagraphs]);

  useEffect(() => {
    if (!isDocReady || targetParaIndex?.paraIndex == null) return undefined;
    const timer = window.setTimeout(() => {
      locateParagraph(targetParaIndex.paraIndex, targetParaIndex);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isDocReady, targetParaIndex, issueParagraphs]);

  useEffect(() => {
    if (!issueParagraphs.length) {
      setIssueCursor(0);
      return;
    }

    if (targetParaIndex?.paraIndex != null) {
      const nextCursor = issueParagraphs.findIndex(item => item === targetParaIndex.paraIndex);
      if (nextCursor >= 0) {
        setIssueCursor(nextCursor);
        return;
      }
    }

    setIssueCursor(cursor => Math.min(cursor, issueParagraphs.length - 1));
  }, [issueParagraphs, targetParaIndex]);

  useEffect(() => {
    if (!isDocReady || !scrollRef.current || !pageOutline.length) return undefined;
    const container = scrollRef.current;

    const syncActivePage = () => {
      const scrollTop = container.scrollTop;
      let nextIndex = 0;

      pageOutline.forEach((page, index) => {
        const node = paragraphNodeMapRef.current.get(page.startPara);
        if (node && node.offsetTop - 180 <= scrollTop) {
          nextIndex = index;
        }
      });

      setActivePageIndex(nextIndex);
    };

    syncActivePage();
    container.addEventListener('scroll', syncActivePage, { passive: true });
    return () => container.removeEventListener('scroll', syncActivePage);
  }, [isDocReady, pageOutline]);

  const handleSave = async () => {
    const changedCount = Object.keys(editedParagraphs).length;
    if (!changedCount) {
      antMessage.info('当前没有可导出的修改内容');
      return;
    }

    try {
      setExporting(true);
      await onSave?.(editedParagraphs);
      setSaveStatus('已导出审查版');
    } finally {
      setExporting(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === shellRef.current) {
        await document.exitFullscreen();
      } else if (shellRef.current?.requestFullscreen) {
        await shellRef.current.requestFullscreen();
      }
    } catch (_) {
      antMessage.warning('当前浏览器不支持此全屏操作');
    }
  };

  const jumpToPage = (page) => {
    if (!page) return;
    setActivePageIndex(Math.max(page.pageNumber - 1, 0));
    locateParagraph(page.startPara, { action: 'locate' });
  };

  const jumpIssue = (direction) => {
    if (!issueParagraphs.length) return;
    const nextCursor = Math.min(Math.max(issueCursor + direction, 0), issueParagraphs.length - 1);
    setIssueCursor(nextCursor);
    locateParagraph(issueParagraphs[nextCursor], { action: 'locate' });
  };

  const toggleReviewSetting = (key) => {
    setReviewSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const ribbonGroups = activeTab === '审阅'
    ? [
        {
          title: '修订',
          buttons: [
            {
              key: 'trackChanges',
              icon: <EditOutlined />,
              label: reviewSettings.trackChanges ? '修订开启' : '修订关闭',
              active: reviewSettings.trackChanges,
              onClick: () => toggleReviewSetting('trackChanges'),
            },
          ],
        },
        {
          title: '批注',
          buttons: [
            {
              key: 'comments',
              icon: <CommentOutlined />,
              label: reviewSettings.comments ? '批注开启' : '批注关闭',
              active: reviewSettings.comments,
              onClick: () => toggleReviewSetting('comments'),
            },
          ],
        },
        {
          title: '风险聚焦',
          buttons: [
            {
              key: 'focusRiskOnly',
              icon: reviewSettings.focusRiskOnly ? <EyeOutlined /> : <EyeInvisibleOutlined />,
              label: reviewSettings.focusRiskOnly ? '仅看风险条款' : '显示全部条款',
              active: reviewSettings.focusRiskOnly,
              onClick: () => toggleReviewSetting('focusRiskOnly'),
            },
          ],
        },
      ]
    : RIBBON_GROUPS.map(group => ({
        ...group,
        buttons: group.buttons.map(button => ({
          key: button.label,
          icon: button.icon,
          label: button.label,
          onClick: undefined,
          active: false,
        })),
      }));

  const statusText = loadedAt ? `${loadedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 已载入` : '等待加载';
  const compactReviewMode = isEmbedded;

  const editorArea = (
    <div
      ref={shellRef}
      className={`office-editor-shell${compactReviewMode ? ' office-editor-shell-compact' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: compactReviewMode ? 'var(--ui-bg-panel)' : 'var(--ui-bg-page)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .office-editor-shell .docx-wrapper {
          background: transparent !important;
          padding: 0 !important;
        }
        .office-editor-shell .docx-wrapper > section.docx {
          min-height: 1180px !important;
          padding: 86px 96px !important;
          background: var(--ui-bg-panel) !important;
          box-shadow: var(--ui-shadow-panel) !important;
          border: 1px solid var(--ui-border-2) !important;
          margin: 0 auto 32px !important;
          width: min(1320px, calc(100% - 36px)) !important;
          outline: none !important;
          border-radius: 0 0 14px 14px !important;
          color: var(--ui-text-1) !important;
        }
        .office-editor-shell .docx-wrapper > section.docx p,
        .office-editor-shell .docx-wrapper > section.docx li {
          line-height: 1.95 !important;
        }
        .office-editor-shell .docx-ruler {
          height: 32px;
          background:
            linear-gradient(90deg, rgba(134,144,156,0.22) 0, rgba(134,144,156,0.22) 1px, transparent 1px, transparent 52px);
          background-size: 52px 100%;
          border: 1px solid #d6dbe4;
          border-bottom: none;
          border-radius: 14px 14px 0 0;
          margin: 0 auto;
          width: min(1320px, calc(100% - 36px));
        }
        .office-editor-shell [data-review-comment-label]::after {
          content: attr(data-review-comment-label);
          position: absolute;
          top: 10px;
          right: -78px;
          font-size: 11px;
          line-height: 1;
          padding: 5px 8px;
          border-radius: 999px;
          color: #1d4ed8;
          background: #dbeafe;
          border: 1px solid #bfdbfe;
          box-shadow: 0 6px 16px rgba(59,130,246,0.12);
          white-space: nowrap;
        }
        .office-editor-shell-compact .docx-wrapper > section.docx {
          min-height: 1160px !important;
          padding: 78px 92px !important;
          box-shadow: none !important;
          border: none !important;
          margin: 0 auto 24px !important;
          width: min(1040px, calc(100% - 56px)) !important;
          border-radius: 0 !important;
        }
        .office-editor-shell-compact .docx-wrapper > section.docx p,
        .office-editor-shell-compact .docx-wrapper > section.docx li {
          font-size: 16px !important;
          line-height: 2.05 !important;
        }
      `}</style>

      {!compactReviewMode && (
        <>
          <div style={{ background: 'var(--ui-bg-panel)', color: 'var(--ui-text-1)', padding: '12px 18px 8px', borderBottom: '1px solid var(--ui-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Space size={10}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg,#6d5efc,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileTextOutlined style={{ color: '#fff' }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{friendlyName || '未命名文档'}</span>
                <Tag color="blue" style={{ margin: 0 }}>{saveStatus}</Tag>
                {isDocReady && <Tag color="default" style={{ margin: 0 }}>{paragraphCount} 段</Tag>}
                <Tag color="default" style={{ margin: 0 }}>
                  {previewMode === 'fallback' ? 'DOCX 兼容预览' : previewMode === 'text' ? '文本预览' : 'DOCX 高保真预览'}
                </Tag>
                <Tag color="default" style={{ margin: 0 }}>A4 纵向</Tag>
              </Space>
              <Space size={8}>
                <Tooltip title={isFullscreen ? '退出全屏预览' : '全屏预览'}>
                  <Button
                    size="small"
                    type="text"
                    icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                    onClick={toggleFullscreen}
                  />
                </Tooltip>
                <Tooltip title="重新加载文档">
                  <Button
                    size="small"
                    type="text"
                    icon={<SyncOutlined />}
                    onClick={() => {
                      loadedNameRef.current = null;
                      renderSessionRef.current += 1;
                      setIsDocReady(false);
                      setReloadTick(value => value + 1);
                    }}
                    disabled={!savedName || loading}
                  />
                </Tooltip>
                <Tooltip title="关闭">
                  <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { loadedNameRef.current = null; onClose?.(); }} />
                </Tooltip>
              </Space>
            </div>

            <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 14 }}>
              {OFFICE_TABS.map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '0 0 6px',
                    border: 'none',
                    background: 'transparent',
                    borderBottom: activeTab === tab ? '2px solid #3370ff' : '2px solid transparent',
                    color: activeTab === tab ? '#2457f5' : '#667085',
                    fontWeight: activeTab === tab ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--ui-fill-1)', borderBottom: '1px solid var(--ui-border-2)', padding: '8px 14px 10px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {ribbonGroups.map(group => (
              <div key={group.title} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 14, borderRight: '1px solid #e5e7eb' }}>
                <Space size={4}>
                  {group.buttons.map(button => (
                    <Button
                      key={button.key || button.label}
                      size="small"
                      icon={button.icon}
                      onClick={button.onClick}
                      type={button.active ? 'primary' : 'default'}
                      ghost={button.active}
                    >
                      {button.label}
                    </Button>
                  ))}
                </Space>
                <span style={{ fontSize: 11, color: 'var(--ui-text-3)' }}>{group.title}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {compactReviewMode && (
        <div
          style={{
            height: 52,
            flexShrink: 0,
            background: '#ffffff',
            borderBottom: '1px solid #eef2f7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <Space size={8}>
            <Tooltip title="放大">
              <Button size="small" type="text" icon={<span style={{ fontSize: 18, lineHeight: 1 }}>+</span>} />
            </Tooltip>
            <Tooltip title="缩小">
              <Button size="small" type="text" icon={<span style={{ fontSize: 18, lineHeight: 1 }}>-</span>} />
            </Tooltip>
            <Tooltip title="适应页面">
              <Button size="small" type="text" icon={<AimOutlined />} />
            </Tooltip>
            <Tooltip title="批注">
              <Button size="small" type="text" icon={<CommentOutlined />} />
            </Tooltip>
          </Space>
          <Space size={6}>
            <Button size="small" type="text" disabled={activeVisiblePageIndex <= 0} onClick={() => jumpToPage(visiblePageOutline[Math.max(activeVisiblePageIndex - 1, 0)])}>
              ‹
            </Button>
            <span
              style={{
                minWidth: 46,
                height: 26,
                borderRadius: 6,
                border: '1px solid #d8dee8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#111827',
                fontSize: 13,
                background: '#fff',
              }}
            >
              {Math.max(activeVisiblePageIndex + 1, 1)}
            </span>
            <span style={{ color: '#98a2b3', fontSize: 13 }}>/ {Math.max(visiblePageOutline.length, 1)}</span>
            <Button size="small" type="text" disabled={activeVisiblePageIndex >= visiblePageOutline.length - 1} onClick={() => jumpToPage(visiblePageOutline[Math.min(activeVisiblePageIndex + 1, visiblePageOutline.length - 1)])}>
              ›
            </Button>
          </Space>
        </div>
      )}

      {!compactReviewMode && (
        <div
          style={{
            background: 'var(--ui-primary-soft)',
            borderBottom: '1px solid #dbe5f0',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Tag color="blue" icon={<AimOutlined />} style={{ margin: 0 }}>审阅模式</Tag>
            <Tag color={issues?.length ? 'orange' : 'success'} style={{ margin: 0 }}>
              风险条款 {issues?.length || 0}
            </Tag>
            <Tag color="default" style={{ margin: 0 }}>
              当前页 {Math.max(activeVisiblePageIndex + 1, 1)} / {Math.max(visiblePageOutline.length, 1)}
            </Tag>
            {issueParagraphs.length > 0 && (
              <Tag color="processing" style={{ margin: 0 }}>
                当前问题 {Math.min(issueCursor + 1, issueParagraphs.length)} / {issueParagraphs.length}
              </Tag>
            )}
            {Object.keys(editedParagraphs).length > 0 && (
              <Tag color="success" style={{ margin: 0 }}>
                已修改 {Object.keys(editedParagraphs).length} 处
              </Tag>
            )}
          </div>
          <Space size={8} wrap>
            <Button size="small" icon={<AimOutlined />} disabled={!issueParagraphs.length} onClick={() => locateParagraph(issueParagraphs[issueCursor] ?? issueParagraphs[0], { action: 'locate' })}>
              定位当前问题
            </Button>
            <Button size="small" icon={<UndoOutlined />} disabled={!issueParagraphs.length || issueCursor <= 0} onClick={() => jumpIssue(-1)}>
              上一问题
            </Button>
            <Button size="small" icon={<RedoOutlined />} disabled={!issueParagraphs.length || issueCursor >= issueParagraphs.length - 1} onClick={() => jumpIssue(1)}>
              下一问题
            </Button>
          </Space>
        </div>
      )}

      {!compactReviewMode && (issues?.length ?? 0) > 0 && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge count={issues.length} overflowCount={99}>
            <Tag color="orange" icon={<AimOutlined />} style={{ margin: 0 }}>审查问题导航</Tag>
          </Badge>
          <span style={{ fontSize: 12, color: '#9a3412' }}>
            {previewMode === 'fallback'
              ? '当前为兼容预览模式，已保留定位、高亮、批注和段落级替换能力。'
              : '当前为高保真预览模式，支持定位、高亮、批注和按建议做段落级替换。'}
          </span>
        </div>
      )}

      {loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(238,242,247,0.88)', gap: 16 }}>
          <Spin size="large" />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--ui-text-1)', fontSize: 16, fontWeight: 600 }}>正在准备左侧合同预览</div>
            <div style={{ color: 'var(--ui-text-3)', fontSize: 13, marginTop: 6 }}>系统会保留段落定位、高亮和跳转能力；审查结果请看右侧。</div>
          </div>
        </div>
      )}

      {loadError && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
          <Alert type="error" message="文档预览加载失败" description={loadError} style={{ maxWidth: 520 }} showIcon />
          <Button
            onClick={() => {
              loadedNameRef.current = null;
              setIsDocReady(false);
              setReloadTick(value => value + 1);
            }}
            type="primary"
          >
            重新加载
          </Button>
        </div>
      )}

      {!loadError && ((open && savedName) || loading || isDocReady) && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: compactReviewMode ? 'minmax(0, 1fr)' : '220px minmax(0, 1fr)',
          }}
        >
          {!compactReviewMode && (
            <div
              style={{
                borderRight: '1px solid #d6dbe4',
                background: '#f7f9fc',
                padding: '16px 14px',
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ui-text-1)' }}>页缩略导航</div>
                  <div style={{ fontSize: 12, color: '#667085', marginTop: 3 }}>按页查看结构与风险分布</div>
                </div>
                <Tag color="default" style={{ margin: 0 }}>{visiblePageOutline.length || 1} 页</Tag>
              </div>

              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: '#ffffff',
                  border: '1px solid #d8e0ea',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-text-1)' }}>只看有问题的页</div>
                  <div style={{ fontSize: 11, color: '#667085', marginTop: 3 }}>快速定位有风险内容</div>
                </div>
                <Switch size="small" checked={reviewSettings.issuePagesOnly} onChange={() => toggleReviewSetting('issuePagesOnly')} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!visiblePageOutline.length && (
                  <div
                    style={{
                      padding: '16px 14px',
                      borderRadius: 16,
                      background: '#ffffff',
                      border: '1px dashed #d8e0ea',
                      color: '#667085',
                      lineHeight: 1.7,
                      fontSize: 12,
                    }}
                  >
                    当前筛选下没有命中页面，可以关闭“只看有问题的页”查看全文。
                  </div>
                )}

                {visiblePageOutline.map(page => {
                  const pageIndex = page.pageNumber - 1;
                  const isActive = pageIndex === activePageIndex;
                  return (
                    <button
                      key={`${page.pageNumber}-${page.startPara}`}
                      type="button"
                      onClick={() => jumpToPage(page)}
                      style={{
                        textAlign: 'left',
                        border: isActive ? '1px solid #3b82f6' : '1px solid #d8e0ea',
                        background: isActive ? '#eff6ff' : '#ffffff',
                        borderRadius: 18,
                        padding: 10,
                        cursor: 'pointer',
                        boxShadow: isActive ? '0 10px 24px rgba(59,130,246,0.14)' : '0 6px 16px rgba(15,23,42,0.04)',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '0.72',
                          borderRadius: 12,
                          background: '#ffffff',
                          border: '1px solid #d6dbe4',
                          padding: '12px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {page.miniLines.map((line, lineIndex) => (
                          <div
                            key={`${page.pageNumber}-${lineIndex}`}
                            style={{
                              height: 6,
                              width: `${Math.max(42, 86 - (lineIndex * 10))}%`,
                              borderRadius: 999,
                              background: lineIndex === 0 ? '#cbd5e1' : '#e2e8f0',
                            }}
                          />
                        ))}
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--ui-text-3)' }}>P.{page.pageNumber}</span>
                          <span style={{ fontSize: 11, color: page.issueCount ? '#c2410c' : '#94a3b8' }}>
                            {page.issueCount ? `${page.issueCount} 问题` : '正常'}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: '#111827' }}>
                        第 {page.pageNumber} 页
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: '#667085', lineHeight: 1.6 }}>
                        {page.preview}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                        第 {page.startPara + 1} - {page.endPara + 1} 段
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
            {!compactReviewMode && <div style={{ padding: '20px 18px 0', background: 'transparent' }}>
              <div className="docx-ruler" />
            </div>}
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                padding: compactReviewMode ? '0 0 24px' : '0 0 32px',
                background: compactReviewMode ? '#fff' : 'transparent',
              }}
            >
              <div style={{ minHeight: '100%', paddingTop: compactReviewMode ? 14 : 22 }}>
                <div ref={previewRef} />
              </div>
            </div>
          </div>
        </div>
      )}

      {!compactReviewMode && (
        <div style={{ height: 38, background: 'var(--ui-bg-sidebar)', color: 'rgba(255,255,255,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', fontSize: 12 }}>
          <Space split={<Divider type="vertical" style={{ borderColor: 'rgba(255,255,255,0.18)' }} />}>
            <span>{statusText}</span>
            <span>{paragraphCount} 段落</span>
            <span>{issues?.length || 0} 个问题点</span>
            <span>DOCX 预览视图</span>
          </Space>
          <Space>
            <Tag color="default" style={{ margin: 0, background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.12)', color: '#e5e7eb' }}>
              {previewMode === 'fallback' ? '兼容预览' : previewMode === 'text' ? '文本预览' : '高保真'}
            </Tag>
            <Button size="small" icon={<SaveOutlined />} type="primary" onClick={handleSave} loading={exporting} disabled={!isDocReady}>导出审查版</Button>
          </Space>
        </div>
      )}
    </div>
  );

  if (isEmbedded) return editorArea;

  return (
    <Modal
      open={open}
      onCancel={() => { loadedNameRef.current = null; onClose?.(); }}
      title={
        <Space>
          <FileTextOutlined />
          <span>合同文档审阅预览</span>
          {friendlyName && <span style={{ fontSize: 13, color: '#888', fontWeight: 400 }}>— {friendlyName}</span>}
          {(issues?.length ?? 0) > 0 && (
            <Badge count={issues.length} overflowCount={99}>
              <Tag color="blue" icon={<AimOutlined />} style={{ margin: 0 }}>审核问题导航</Tag>
            </Badge>
          )}
          {isDocReady && <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>已就绪</Tag>}
        </Space>
      }
      footer={[
        <Button
          key="refresh"
          icon={<SyncOutlined />}
          onClick={() => {
            loadedNameRef.current = null;
            setIsDocReady(false);
            setReloadTick(value => value + 1);
          }}
          disabled={!savedName || loading}
        >
          重新加载
        </Button>,
        <Button key="save" type="primary" onClick={handleSave} loading={exporting} disabled={!isDocReady}>
          导出审查版
        </Button>,
        <Button key="close" type="default" danger icon={<CloseOutlined />} onClick={() => { loadedNameRef.current = null; onClose?.(); }}>
          关闭
        </Button>,
      ]}
      width={Math.min(1480, window.innerWidth - 40)}
      style={{ top: 10 }}
      styles={{ body: { padding: 0, height: 'calc(100vh - 180px)', minHeight: 700, overflow: 'hidden' } }}
      destroyOnHidden
    >
      {editorArea}
    </Modal>
  );
}
