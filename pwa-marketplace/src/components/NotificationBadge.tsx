import React from 'react';

interface NotificationBadgeProps {
  count: number;
  onClick: () => void;
}

const NotificationBadge: React.FC<NotificationBadgeProps> = ({ count, onClick }) => {
  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="notification-badge"
      aria-label={`View ${count} notifications`}
    >
      <span className="badge-count">{count}</span>
    </button>
  );
};

export default NotificationBadge;
