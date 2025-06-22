import { createTheme } from '@mui/material/styles';

export const createTheme = (theme: 'light' | 'dark') => {
  return createTheme({
    palette: {
      mode: theme,
      primary: {
        main: '#2196f3',
        dark: '#1976d2',
        light: '#64b5f6',
      },
      secondary: {
        main: '#4caf50',
        dark: '#388e3c',
        light: '#81c784',
      },
      error: {
        main: '#f44336',
        dark: '#d32f2f',
        light: '#ef9a9a',
      },
      warning: {
        main: '#ff9800',
        dark: '#f57c00',
        light: '#ffb74d',
      },
      background: {
        default: theme === 'light' ? '#ffffff' : '#121212',
        paper: theme === 'light' ? '#ffffff' : '#1e1e1e',
      },
      text: {
        primary: theme === 'light' ? '#333333' : '#ffffff',
        secondary: theme === 'light' ? '#666666' : '#b3b3b3',
      },
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        'Oxygen',
        'Ubuntu',
        'Cantarell',
        '"Open Sans"',
        'Helvetica Neue',
        'sans-serif',
      ].join(','),
      h1: {
        fontSize: '2.5rem',
        fontWeight: 600,
        lineHeight: 1.2,
      },
      h2: {
        fontSize: '2rem',
        fontWeight: 600,
        lineHeight: 1.3,
      },
      h3: {
        fontSize: '1.75rem',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      body1: {
        fontSize: '1rem',
        lineHeight: 1.6,
      },
      body2: {
        fontSize: '0.875rem',
        lineHeight: 1.5,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            padding: '8px 16px',
            textTransform: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
          },
        },
      },
    },
    shape: {
      borderRadius: 8,
    },
    spacing: 8,
  });
};
