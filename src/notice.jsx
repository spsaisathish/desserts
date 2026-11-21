import React from 'react';

const styles = {
  error: { icon: '!', label: 'Needs attention' },
  success: { icon: '✓', label: 'Confirmed' },
  warning: { icon: '!', label: 'Order update' },
};

export function Notice({ children, kind = 'error', title = styles[kind].label }) {
  if (!children) return null;
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {styles[kind].icon}
      </span>
      <div>
        <strong>{title}</strong>
        <div className="notice-text">{children}</div>
      </div>
    </div>
  );
}
