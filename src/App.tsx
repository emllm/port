import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppGrid from './components/AppGrid';
import AppDetails from './components/AppDetails';
import CategoryFilter from './components/CategoryFilter';
import SearchBar from './components/SearchBar';
import ThemeSwitcher from './components/ThemeSwitcher';
import NotificationBadge from './components/NotificationBadge';

const mockApps = [
  {
    id: '1',
    name: 'Weather App',
    description: 'A modern weather application with real-time updates',
    icon: '/weather-icon.png',
    category: 'Utilities',
    screenshots: ['/weather-1.png', '/weather-2.png'],
    rating: 4.5,
    installs: 12345
  },
  // Add more mock apps as needed
];

const App: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const filteredApps = mockApps.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === '' || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">PWA Marketplace</h1>
            </div>
            <div className="flex items-center space-x-4">
              <SearchBar onSearch={setSearchQuery} />
              <NotificationBadge count={5} />
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <CategoryFilter
            categories={['Utilities', 'Social', 'Productivity', 'Entertainment']}
            onCategorySelect={setSelectedCategory}
          />
        </div>

        <Routes>
          <Route path="/" element={
            <AppGrid apps={filteredApps} />
          } />
          <Route path="/app/:id" element={
            <AppDetails app={mockApps[0]} />
          } />
        </Routes>
      </main>
    </div>
  );
};

export default App;
