import { configureStore } from '@reduxjs/toolkit';
import appReducer from './features/app/appSlice';
import userReducer from './features/user/userSlice';
import settingsReducer from './features/settings/settingsSlice';

export const store = configureStore({
  reducer: {
    app: appReducer,
    user: userReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
