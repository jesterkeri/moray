'use client';

import { useEffect } from 'react';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="h-title" style={{ fontSize: 16 }}>
            {title}
          </span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
