import React from 'react';
import { PWAApp } from '../types';

interface AppDetailsProps {
  app: PWAApp;
  onInstall: (app: PWAApp) => void;
  onUninstall: (app: PWAApp) => void;
}

const AppDetails: React.FC<AppDetailsProps> = ({ app, onInstall, onUninstall }) => {
  return (
    <div className="app-details">
      <div className="app-header">
        <img src={app.icon} alt={app.name} className="app-icon-large" />
        <h2>{app.name}</h2>
      </div>
      
      <div className="app-info">
        <p className="description">{app.description}</p>
        
        <div className="app-meta">
          <div className="version">Version: {app.version}</div>
          <div className="author">Author: {app.author}</div>
          <div className="category">Category: {app.category}</div>
        </div>
      </div>

      <div className="permissions">
        <h3>Required Permissions</h3>
        <ul>
          {app.permissions.map((perm, index) => (
            <li key={index}>{perm}</li>
          ))}
        </ul>
      </div>

      <div className="actions">
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

      <div className="reviews">
        <h3>Reviews</h3>
        {/* TODO: Implement reviews component */}
      </div>
    </div>
  );
};

export default AppDetails;
