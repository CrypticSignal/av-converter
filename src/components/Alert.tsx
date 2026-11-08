import React from 'react';

export type AlertSeverity = 'success' | 'info' | 'warning' | 'error';

const STYLES: Record<AlertSeverity, { box: string; icon: string; path: React.ReactNode }> = {
  success: {
    box: 'bg-emerald-500/10 ring-emerald-400/25 text-emerald-100',
    icon: 'text-emerald-400',
    path: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>,
  },
  info: {
    box: 'bg-sky-500/10 ring-sky-400/25 text-sky-100',
    icon: 'text-sky-400',
    path: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  },
  warning: {
    box: 'bg-amber-500/10 ring-amber-400/25 text-amber-100',
    icon: 'text-amber-400',
    path: <><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  },
  error: {
    box: 'bg-red-500/10 ring-red-400/25 text-red-100',
    icon: 'text-red-400',
    path: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  },
};

/** A message box with an icon, coloured by severity. data-severity lets scripts find errors. */
const Alert = ({ severity, className = '', children }: {
  severity: AlertSeverity; className?: string; children: React.ReactNode;
}) => {
  const style = STYLES[severity];
  return (
    <div role="alert" data-severity={severity}
      className={`flex gap-3 rounded-xl px-4 py-3 text-sm leading-relaxed text-left ring-1 ${style.box} ${className}`}>
      <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${style.icon}`} fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {style.path}
      </svg>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
};

export default Alert;
