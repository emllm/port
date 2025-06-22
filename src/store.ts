import { configureStore } from '@reduxjs/toolkit';

// Add your reducers here
// import someReducer from './someSlice';

export const store = configureStore({
  reducer: {
    // some: someReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
