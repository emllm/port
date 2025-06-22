export interface PWAApp {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  author: string;
  category: string;
  permissions: string[];
  installed: boolean;
  manifestUrl: string;
  repository: string;
  verified: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
  apps: string[];
}

export interface PasswordEntry {
  id: string;
  name: string;
  password: string;
  notes: string;
  lastUsed: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPMessage {
  type: string;
  payload: any;
  timestamp: number;
}

export interface StorageItem {
  key: string;
  value: any;
  type: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
  read: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark';
  language: string;
  notifications: boolean;
  autoUpdate: boolean;
  storagePath: string;
}

export interface GitHubConfig {
  token: string;
  username: string;
  repositories: string[];
  lastSync: string;
}

export interface MarketplaceState {
  apps: PWAApp[];
  categories: Category[];
  selectedCategory: string;
  searchQuery: string;
  loading: boolean;
  error: string | null;
}

export interface PasswordManagerState {
  entries: PasswordEntry[];
  searchQuery: string;
  showPassword: boolean;
  editingEntry: string | null;
}

export interface SetupWizardState {
  currentStep: number;
  formData: {
    username: string;
    password: string;
    githubToken: string;
    storagePath: string;
  };
}
