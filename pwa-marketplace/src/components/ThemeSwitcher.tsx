import React, { useState, useEffect } from 'react';

interface ThemeSwitcherProps {
  onThemeChange: (theme: string) => void;
}

const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ onThemeChange }) => {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    onThemeChange(newTheme);
  };

  return (
    <button
      onClick={toggleTheme}
      className="theme-switcher"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
};

export default ThemeSwitcher;
