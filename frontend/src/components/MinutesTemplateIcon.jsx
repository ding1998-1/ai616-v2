import React from 'react';

export default function MinutesTemplateIcon({ type, size = 24 }) {
  const document = <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v5h4" />;
  const drawings = {
    standard: <>{document}<path d="M8 12h7M8 15h7M8 18h4" /></>,
    enterprise: <><path d="m3 9 9-6 9 6H3ZM5 9v10M10 9v10M14 9v10M19 9v10M3 21h18" /><path d="M6 6h12" opacity=".4" /></>,
    major: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    party: <><path d="M5 21V3m0 1h14v12H5" /><path d="m12 6 1.1 2.2 2.4.4-1.8 1.7.4 2.4-2.1-1.1-2.1 1.1.4-2.4-1.8-1.7 2.4-.4Z" strokeWidth="1.35" /></>,
    board: <><rect x="5" y="10" width="14" height="8" rx="3" /><circle cx="8" cy="5" r="2" /><circle cx="16" cy="5" r="2" /><path d="M2 12v4M22 12v4M8 21h8M8 14h8" /></>,
    project: <><circle cx="5" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><path d="M5 7v10M11 3h9v5h-9zM11 11h6v4h-6zM11 19h9" /></>,
    engineering: <><path d="M3 21h18M5 21V7l7-4v18M12 9h7v12M8 8v1M8 12v1M8 16v1M15 12h1M15 16h1" /></>,
    audit: <><path d="M6 21H5V3h10l4 4v4M15 3v5h4M8 7h3M8 11h5" /><circle cx="14" cy="17" r="4" /><path d="m17 20 3 3m-8-6 1.3 1.3L16 16" /></>,
    concise: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {drawings[type] || drawings.standard}
    </svg>
  );
}
