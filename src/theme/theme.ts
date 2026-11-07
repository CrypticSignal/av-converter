import { createTheme } from '@mui/material/styles';

/** The app's dark theme: deep navy surfaces with a violet → cyan accent. */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#8b5cf6', light: '#a78bfa', dark: '#6d28d9', contrastText: '#ffffff' },
    secondary: { main: '#22d3ee' },
    background: { default: '#070a13', paper: '#0f1424' },
    text: { primary: '#e6e9f2', secondary: '#9aa3b8' },
    divider: 'rgba(255,255,255,0.08)',
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0.2 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 22 },
      },
      variants: [
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            backgroundImage: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #06b6d4 100%)',
            boxShadow: '0 8px 24px -8px rgba(139,92,246,0.6)',
            transition: 'transform .15s ease, box-shadow .2s ease, filter .2s ease',
            '&:hover': {
              filter: 'brightness(1.1)',
              transform: 'translateY(-1px)',
              boxShadow: '0 12px 32px -8px rgba(139,92,246,0.75)',
            },
            '&.Mui-disabled': { backgroundImage: 'none' },
          },
        },
      ],
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255,255,255,0.03)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.12)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(167,139,250,0.6)' },
        },
      },
    },
    MuiNativeSelect: { styleOverrides: { select: { '& option': { backgroundColor: '#0f1424' } } } },
    MuiSlider: {
      styleOverrides: {
        track: { border: 'none', backgroundImage: 'linear-gradient(90deg, #8b5cf6, #22d3ee)' },
        thumb: { boxShadow: '0 0 0 4px rgba(139,92,246,0.25)' },
        mark: { opacity: 0.35 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
        bar: { borderRadius: 999, backgroundImage: 'linear-gradient(90deg, #8b5cf6, #22d3ee)' },
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12, textAlign: 'left' } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
});

export default theme;
