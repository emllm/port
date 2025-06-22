import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Provider } from 'react-redux';
import store from './store';
import AppGrid from '../components/AppGrid';
import AppDetails from '../components/AppDetails';
import CategoryFilter from '../components/CategoryFilter';
import SearchBar from '../components/SearchBar';
import ThemeSwitcher from '../components/ThemeSwitcher';
import NotificationBadge from '../components/NotificationBadge';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

function App() {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <div className="app-container">
            <header className="app-header">
              <h1>PWA Marketplace</h1>
              <div className="header-actions">
                <SearchBar />
                <ThemeSwitcher />
                <NotificationBadge />
              </div>
            </header>
            <main className="app-main">
              <CategoryFilter />
              <Routes>
                <Route path="/" element={<AppGrid />} />
                <Route path="/app/:id" element={<AppDetails />} />
              </Routes>
            </main>
          </div>
        </Router>
      </ThemeProvider>
    </Provider>
  );
}

export default App;
