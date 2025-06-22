import React from 'react';
import { PWAApp } from '../types';

interface AppGridProps {
  apps: PWAApp[];
  onInstall: (app: PWAApp) => void;
  onUninstall: (app: PWAApp) => void;
}

const AppGrid: React.FC<AppGridProps> = ({ apps, onInstall, onUninstall }) => {
  return (
    <div className="app-grid">
      {apps.map((app) => (
        <div key={app.id} className="app-card">
          <img src={app.icon} alt={app.name} className="app-icon" />
          <h3>{app.name}</h3>
          <p>{app.description}</p>
          <div className="app-actions">
            {app.installed ? (
              <button onClick={() => onUninstall(app)} className="uninstall-btn">
                Uninstall
              </button>
            ) : (
              <button onClick={() => onInstall(app)} className="install-btn">
                Install
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AppGrid;
