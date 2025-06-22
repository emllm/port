import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AppState {
  selectedApp: string | null;
  categoryFilter: string;
  searchQuery: string;
  apps: any[];
  loading: boolean;
  error: string | null;
}

const initialState: AppState = {
  selectedApp: null,
  categoryFilter: 'all',
  searchQuery: '',
  apps: [],
  loading: false,
  error: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    selectApp: (state, action: PayloadAction<string>) => {
      state.selectedApp = action.payload;
    },
    setCategoryFilter: (state, action: PayloadAction<string>) => {
      state.categoryFilter = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    fetchAppsStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    fetchAppsSuccess: (state, action: PayloadAction<any[]>) => {
      state.loading = false;
      state.apps = action.payload;
    },
    fetchAppsFailure: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

export const {
  selectApp,
  setCategoryFilter,
  setSearchQuery,
  fetchAppsStart,
  fetchAppsSuccess,
  fetchAppsFailure,
} = appSlice.actions;

export default appSlice.reducer;
