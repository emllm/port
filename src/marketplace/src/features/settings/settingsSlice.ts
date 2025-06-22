import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SettingsState {
  theme: 'light' | 'dark';
  language: string;
  notifications: boolean;
  autoUpdate: boolean;
  lastUpdateCheck: number;
}

const initialState: SettingsState = {
  theme: 'light',
  language: 'en',
  notifications: true,
  autoUpdate: true,
  lastUpdateCheck: 0,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
    },
    setLanguage: (state, action: PayloadAction<string>) => {
      state.language = action.payload;
    },
    toggleNotifications: (state) => {
      state.notifications = !state.notifications;
    },
    toggleAutoUpdate: (state) => {
      state.autoUpdate = !state.autoUpdate;
    },
    updateLastCheck: (state) => {
      state.lastUpdateCheck = Date.now();
    },
  },
});

export const {
  toggleTheme,
  setLanguage,
  toggleNotifications,
  toggleAutoUpdate,
  updateLastCheck,
} = settingsSlice.actions;

export default settingsSlice.reducer;
