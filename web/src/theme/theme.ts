'use client';

import { createTheme, alpha } from '@mui/material/styles';

// ── M3-inspired palette ──────────────────────────────────────────────
// Primary:   electric teal – fresh, financial, modern
// Secondary: rich violet   – fun, premium feel
// Tertiary:  golden amber  – warmth, highlights, tips
// Surfaces:  deep blue-grey tonal scale
// ─────────────────────────────────────────────────────────────────────

const palette = {
  primary:   { main: '#5EEAD4', light: '#99F6E4', dark: '#2DD4BF', contrastText: '#042F2E' },
  secondary: { main: '#A78BFA', light: '#C4B5FD', dark: '#8B5CF6', contrastText: '#1E1033' },
  tertiary:  { main: '#FBBF24', light: '#FDE68A', dark: '#F59E0B' },

  success: { main: '#34D399', dark: '#059669' },
  error:   { main: '#FB7185', dark: '#E11D48' },
  warning: { main: '#FBBF24', dark: '#D97706' },
  info:    { main: '#60A5FA', dark: '#2563EB' },

  // Tonal surface scale (M3 dark-theme approach: higher = lighter)
  bg:      '#0C0F16',
  surface: '#141720',
  surfaceContainerLow:     '#181C26',
  surfaceContainer:        '#1E2230',
  surfaceContainerHigh:    '#262B3A',
  surfaceContainerHighest: '#2F3545',

  outline:        'rgba(255,255,255,0.10)',
  outlineVariant: 'rgba(255,255,255,0.06)',
  textPrimary:    '#F0F4F8',
  textSecondary:  '#94A3B8',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:   palette.primary,
    secondary: palette.secondary,
    success:   palette.success,
    error:     palette.error,
    warning:   palette.warning,
    info:      palette.info,
    background: { default: palette.bg, paper: palette.surface },
    text:       { primary: palette.textPrimary, secondary: palette.textSecondary },
    divider: palette.outlineVariant,
  },

  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500, fontSize: '0.8rem', letterSpacing: '0.04em', textTransform: 'uppercase' as const },
    body2: { color: palette.textSecondary },
    caption: { color: palette.textSecondary, fontSize: '0.75rem' },
  },

  shape: { borderRadius: 16 },

  components: {
    // ── Surfaces ───────────────────────────────────────────────────
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: palette.bg },
        '::-webkit-scrollbar': { width: 6 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.10)', borderRadius: 3 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: palette.surfaceContainer,
          border: `1px solid ${palette.outlineVariant}`,
          borderRadius: 20,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          '&:hover': {
            borderColor: palette.outline,
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 20, '&:last-child': { paddingBottom: 20 } },
      },
    },

    // ── Buttons ────────────────────────────────────────────────────
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          borderRadius: 12,
          fontWeight: 600,
          padding: '8px 20px',
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        outlined: {
          borderColor: palette.outline,
          '&:hover': { borderColor: palette.primary.main, backgroundColor: alpha(palette.primary.main, 0.08) },
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: { boxShadow: `0 4px 20px ${alpha(palette.primary.main, 0.25)}` },
      },
    },

    // ── Inputs ─────────────────────────────────────────────────────
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 12,
            '& fieldset': { borderColor: palette.outline },
            '&:hover fieldset': { borderColor: palette.textSecondary },
            '&.Mui-focused fieldset': { borderColor: palette.primary.main },
          },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { backgroundColor: palette.surfaceContainerHigh, borderRadius: 12, border: `1px solid ${palette.outline}` },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { backgroundColor: palette.surfaceContainerHigh, borderRadius: 12, border: `1px solid ${palette.outline}` },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { backgroundColor: palette.surfaceContainerHigh, borderRadius: 20, border: `1px solid ${palette.outline}` },
      },
    },

    // ── Chips ──────────────────────────────────────────────────────
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 10, fontWeight: 500, fontSize: '0.8rem' },
        outlined: { borderColor: palette.outline },
      },
    },

    // ── Tables ─────────────────────────────────────────────────────
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: palette.outlineVariant, padding: '12px 16px' },
        head: { fontWeight: 600, color: palette.textSecondary, fontSize: '0.8rem', letterSpacing: '0.04em', textTransform: 'uppercase' as const },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s',
          '&:hover': { backgroundColor: alpha(palette.primary.main, 0.04) },
        },
      },
    },

    // ── Navigation ─────────────────────────────────────────────────
    MuiDrawer: {
      styleOverrides: {
        paper: { borderRight: 'none', backgroundColor: palette.surface },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          margin: '2px 8px',
          padding: '10px 16px',
          transition: 'background-color 0.15s',
          '&.Mui-selected': {
            backgroundColor: alpha(palette.primary.main, 0.12),
            '&:hover': { backgroundColor: alpha(palette.primary.main, 0.16) },
          },
        },
      },
    },

    // ── Tabs & Progress ────────────────────────────────────────────
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 8, height: 8, backgroundColor: palette.surfaceContainerHighest },
      },
    },
    MuiStepper: {
      styleOverrides: {
        root: { backgroundColor: 'transparent' },
      },
    },

    // ── Tooltip / Snackbar ─────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: palette.surfaceContainerHighest, borderRadius: 8, fontSize: '0.8rem' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 12 },
      },
    },
    MuiSnackbar: {
      defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } },
    },
  },
});

export default theme;

// Export palette tokens for use in components
export { palette };
