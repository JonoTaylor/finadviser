'use client';

import { createTheme, alpha } from '@mui/material/styles';

// ── Warm Premium Dark Palette ──────────────────────────────────────
// Primary:   indigo — warm, premium fintech feel
// Secondary: pink   — playful warmth, contrast
// Tertiary:  orange — personality, highlights
// Surfaces:  warm charcoal tonal scale
// ─────────────────────────────────────────────────────────────────────

const palette = {
  primary:   { main: '#818CF8', light: '#A5B4FC', dark: '#6366F1', contrastText: '#1E1B4B' },
  secondary: { main: '#F472B6', light: '#F9A8D4', dark: '#EC4899', contrastText: '#4A0D2B' },
  tertiary:  { main: '#FB923C', light: '#FDBA74', dark: '#F97316' },

  success: { main: '#4ADE80', dark: '#16A34A' },
  error:   { main: '#FB7185', dark: '#E11D48' },
  warning: { main: '#FBBF24', dark: '#D97706' },
  info:    { main: '#60A5FA', dark: '#2563EB' },

  // Warm tonal surface scale
  bg:      '#0E0E12',
  surface: '#141418',
  surfaceContainerLow:     '#18181F',
  surfaceContainer:        '#1E1E28',
  surfaceContainerHigh:    '#282833',
  surfaceContainerHighest: '#323242',

  outline:        'rgba(255,255,255,0.10)',
  outlineVariant: 'rgba(255,255,255,0.06)',
  textPrimary:    '#F0F0F8',
  textSecondary:  '#9694A8',
};

// ── Visual Effect Utilities ──────────────────────────────────────────
export const glassCard = {
  backgroundColor: alpha(palette.surfaceContainer, 0.55),
  backdropFilter: 'blur(20px) saturate(180%)',
  border: `1px solid ${alpha('#fff', 0.08)}`,
};

export const glowShadow = {
  primary: `0 4px 24px -4px ${alpha(palette.primary.main, 0.2)}`,
  success: `0 4px 24px -4px ${alpha(palette.success.main, 0.2)}`,
  error:   `0 4px 24px -4px ${alpha(palette.error.main, 0.2)}`,
  secondary: `0 4px 24px -4px ${alpha(palette.secondary.main, 0.2)}`,
};

export const gradientText = (from: string, to: string) => ({
  background: `linear-gradient(135deg, ${from}, ${to})`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
});

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
        body: {
          backgroundColor: palette.bg,
          backgroundImage: `
            radial-gradient(ellipse 80% 60% at 10% 90%, ${alpha(palette.primary.main, 0.06)} 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 90% 10%, ${alpha(palette.secondary.main, 0.05)} 0%, transparent 60%)
          `,
          backgroundAttachment: 'fixed',
        },
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
          ...glassCard,
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
          background: `linear-gradient(135deg, ${palette.primary.main}, ${palette.primary.dark})`,
          boxShadow: glowShadow.primary,
          '&:hover': {
            background: `linear-gradient(135deg, ${palette.primary.light}, ${palette.primary.main})`,
            boxShadow: glowShadow.primary,
          },
        },
        outlined: {
          borderColor: palette.outline,
          '&:hover': { borderColor: palette.primary.main, backgroundColor: alpha(palette.primary.main, 0.08) },
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: { boxShadow: glowShadow.primary },
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
