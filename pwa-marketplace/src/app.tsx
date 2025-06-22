import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Components
import AppGrid from './components/AppGrid';
import AppDetails from './components/AppDetails';
import CategoryFilter from './components/CategoryFilter';
import SearchBar from './components/SearchBar';
import ThemeSwitcher from './components/ThemeSwitcher';
import PasswordManager from './components/PasswordManager';
import SetupWizard from './components/SetupWizard';
import NotificationBadge from './components/NotificationBadge';

// Types
import { PWAApp, Category, UserSettings } from './types';

// Theme
import { createTheme } from './theme';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [apps, setApps] = useState<PWAApp[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState(0);

  useEffect(() => {
    // Check if setup is complete
    const checkSetup = async () => {
      try {
        const settings = await window.electron.store.get('userSettings');
        setIsSetupComplete(!!settings);
      } catch (error) {
        console.error('Error checking setup:', error);
      }
    };

    checkSetup();
  }, []);

  const handleInstall = async (app: PWAApp) => {
    try {
      await window.electron.mcp.send({
        type: 'install',
        payload: {
          manifestUrl: app.manifestUrl,
          permissions: app.permissions,
        },
      });
      setNotifications(notifications + 1);
    } catch (error) {
      console.error('Error installing app:', error);
    }
  };

  const handleUninstall = async (app: PWAApp) => {
    try {
      await window.electron.mcp.send({
        type: 'uninstall',
        payload: { id: app.id },
      });
      setNotifications(notifications + 1);
    } catch (error) {
      console.error('Error uninstalling app:', error);
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    window.electron.store.set('theme', newTheme);
  };

  const filteredApps = apps.filter((app) => {
    const matchesCategory = !selectedCategory || app.category === selectedCategory;
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <ThemeProvider theme={createTheme(theme)}>
      <CssBaseline />
      <Router>
        <div className="app">
          <header>
            <nav>
              <div className="logo">PWA Marketplace</div>
              <div className="nav-items">
                <a href="/" className="active">Marketplace</a>
                <a href="/password-manager">Password Manager</a>
                <a href="/settings">Settings</a>
              </div>
              <div className="header-actions">
                <NotificationBadge count={notifications} onClick={() => {}} />
                <ThemeSwitcher onThemeChange={handleThemeChange} />
              </div>
            </nav>
          </header>

          {!isSetupComplete ? (
            <SetupWizard onComplete={() => setIsSetupComplete(true)} />
          ) : (
            <Routes>
              <Route
                path="/"
                element={
                  <main>
                    <SearchBar onSearch={setSearchQuery} />
                    <CategoryFilter
                      categories={categories}
                      selectedCategory={selectedCategory}
                      onCategoryChange={setSelectedCategory}
                    />
                    <AppGrid
                      apps={filteredApps}
                      onInstall={handleInstall}
                      onUninstall={handleUninstall}
                    />
                  </main>
                }
              />
              <Route
                path="/app/:id"
                element={
                  <AppDetails
                    app={filteredApps[0]} // TODO: Get actual app by ID
                    onInstall={handleInstall}
                    onUninstall={handleUninstall}
                  />
                }
              />
              <Route
                path="/password-manager"
                element={
                  <PasswordManager
                    entries={[]}
                    onAddEntry={() => {}}
                    onUpdateEntry={() => {}}
                    onDeleteEntry={() => {}}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </div>
      </Router>
    </ThemeProvider>
  );
};

export default App;
