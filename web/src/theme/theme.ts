'use client';

import { createTheme, alpha } from '@mui/material/styles';

// ── Soft Surfaces v2 ────────────────────────────────────────────────
// Light pastel canvas + white "pillow" cards + Instrument Serif italic
// display numerals. CTAs are dark ink, not gold; accents come from a
// fixed mint / lemon / lavender / peach palette.
//
// MUI's `palette.*` is mapped to the v2 tokens that have natural
// equivalents (success=mint, warning=lemon, error=peach, secondary=
// lavender). `palette.info.main` is also lavender.deep so contained
// "info" CTAs have enough contrast for white text — the softer
// `softTokens.fog` tint that the spec calls "info" is applied via
// the explicit `MuiAlert.standardInfo` and `MuiChip.colorInfo`
// component overrides instead. Everything else lives on `softTokens`,
// exported alongside this theme for use via `sx`.
// ─────────────────────────────────────────────────────────────────────

export const softTokens = {
  mint:     { main: '#C8EAB8', deep: '#9FCC8C', ink: '#1F5E2D' },
  lemon:    { main: '#F2EE8F', deep: '#DFD867', ink: '#6B5A0B' },
  lavender: { main: '#D9CFF5', deep: '#B8A9E8', ink: '#3A2B7A' },
  peach:    { main: '#F5C4A8', deep: '#E8A589', ink: '#8B3A1A' },

  cream: '#F7F3E7',
  stone: '#ECE9DF',
  fog:   '#ECE7F5',

  ink:  '#1A1730',
  ink2: '#4A4566',
  ink3: '#6E6886',
  ink4: '#9A95B0',

  // Shadow strings keep their literal rgba — the multi-layer recipe is
  // composed once here and consumed as a string. Converting to alpha()
  // would require template-literal interpolation per layer with no
  // runtime benefit.
  shadowPillow: '0 24px 56px -24px rgba(26,23,48,0.22), 0 4px 12px -2px rgba(26,23,48,0.08), 0 0 0 1px rgba(26,23,48,0.04)',
  shadowPillowLift: '0 32px 72px -24px rgba(26,23,48,0.28), 0 6px 16px -2px rgba(26,23,48,0.10), 0 0 0 1px rgba(26,23,48,0.04)',

  radius: { sm: 14, md: 16, lg: 20, xl: 24, '2xl': 28, '3xl': 32, pill: 999 },
} as const;

// Used via sx={{ fontFamily: serifFamily, fontStyle: 'italic' }} for
// hero numerals + display headings. Not added as a custom typography
// variant because that requires module augmentation for one helper.
export const serifFamily = 'var(--font-instrument-serif), "Instrument Serif", "Times New Roman", serif';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary:    { main: softTokens.ink,           contrastText: '#FFFFFF' },
    secondary:  { main: softTokens.lavender.deep, contrastText: softTokens.lavender.ink },
    success:    { main: softTokens.mint.deep,     contrastText: softTokens.mint.ink },
    warning:    { main: softTokens.lemon.deep,    contrastText: softTokens.lemon.ink },
    error:      { main: softTokens.peach.deep,    contrastText: softTokens.peach.ink },
    info:       { main: softTokens.lavender.deep, contrastText: softTokens.lavender.ink },
    background: { default: '#FAF6EC',             paper: '#FFFFFF' },
    text:       { primary: softTokens.ink, secondary: softTokens.ink2, disabled: softTokens.ink4 },
    divider:    alpha(softTokens.ink, 0.06),
  },

  typography: {
    fontFamily: 'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    h3: { fontWeight: 600, letterSpacing: '-0.02em' },
    h4: { fontWeight: 600, letterSpacing: '-0.02em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500, fontSize: '0.85rem', color: softTokens.ink3 },
    body2: { color: softTokens.ink2 },
    caption: { color: softTokens.ink3, fontSize: '0.78rem' },
  },

  shape: { borderRadius: softTokens.radius.md },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: 'var(--gradient-page-soft)',
          backgroundAttachment: 'fixed',
          color: softTokens.ink,
          minHeight: '100vh',
        },
        '::-webkit-scrollbar': { width: 8, height: 8 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: alpha(softTokens.ink, 0.18), borderRadius: softTokens.radius.pill },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', backgroundColor: '#fff' },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#fff',
          borderRadius: softTokens.radius['2xl'],
          boxShadow: softTokens.shadowPillow,
          border: 'none',
          transition: 'box-shadow 0.2s ease',
          '&:hover': { boxShadow: softTokens.shadowPillowLift },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 24, '&:last-child': { paddingBottom: 24 } },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          borderRadius: softTokens.radius.pill,
          fontWeight: 600,
          padding: '10px 22px',
          boxShadow: 'none',
          lineHeight: 1.2,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        containedPrimary: {
          backgroundColor: softTokens.ink,
          color: '#FFFFFF',
          '&:hover': { backgroundColor: '#2A2548' },
          '&:active': { backgroundColor: '#0F0D1F' },
        },
        containedSuccess: {
          backgroundColor: softTokens.mint.deep,
          color: softTokens.mint.ink,
          '&:hover': { backgroundColor: softTokens.mint.main },
        },
        outlined: {
          borderColor: alpha(softTokens.ink, 0.12),
          color: softTokens.ink,
          '&:hover': { borderColor: alpha(softTokens.ink, 0.24), backgroundColor: alpha(softTokens.ink, 0.04) },
        },
        text: {
          color: softTokens.ink,
          '&:hover': { backgroundColor: alpha(softTokens.ink, 0.04) },
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: { boxShadow: softTokens.shadowPillow },
      },
    },

    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: softTokens.radius.sm,
            backgroundColor: '#fff',
            '& fieldset': { borderColor: alpha(softTokens.ink, 0.12) },
            '&:hover fieldset': { borderColor: alpha(softTokens.ink, 0.24) },
            '&.Mui-focused fieldset': { borderColor: softTokens.ink, borderWidth: 1.5 },
          },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          backgroundColor: '#fff',
          borderRadius: softTokens.radius.md,
          boxShadow: softTokens.shadowPillow,
          border: 'none',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: '#fff',
          borderRadius: softTokens.radius.md,
          boxShadow: softTokens.shadowPillow,
          border: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#fff',
          borderRadius: softTokens.radius.xl,
          boxShadow: softTokens.shadowPillow,
          border: 'none',
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: softTokens.radius.pill,
          fontWeight: 500,
          fontSize: '0.78rem',
          height: 26,
        },
        colorSuccess: { backgroundColor: softTokens.mint.main, color: softTokens.mint.ink },
        colorWarning: { backgroundColor: softTokens.lemon.main, color: softTokens.lemon.ink },
        colorError:   { backgroundColor: softTokens.peach.main, color: softTokens.peach.ink },
        colorInfo:    { backgroundColor: softTokens.fog,        color: softTokens.lavender.ink },
        colorDefault: { backgroundColor: softTokens.stone,      color: softTokens.ink },
        outlined: { borderColor: alpha(softTokens.ink, 0.12), backgroundColor: 'transparent' },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: alpha(softTokens.ink, 0.06), padding: '14px 16px', color: softTokens.ink },
        head: { fontWeight: 600, color: softTokens.ink3, fontSize: '0.78rem' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s',
          '&:hover': { backgroundColor: alpha(softTokens.ink, 0.03) },
        },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(255,253,247,0.55)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRight: `1px solid ${alpha(softTokens.ink, 0.04)}`,
          backgroundImage: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: softTokens.radius.sm,
          margin: '2px 8px',
          padding: '10px 14px',
          color: softTokens.ink2,
          transition: 'background-color 0.15s, color 0.15s',
          '&:hover': { backgroundColor: alpha(softTokens.ink, 0.06) },
          '&.Mui-selected': {
            backgroundColor: softTokens.ink,
            color: '#FFFFFF',
            '&:hover': { backgroundColor: softTokens.ink },
          },
        },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: softTokens.radius.pill,
          height: 8,
          backgroundColor: softTokens.stone,
        },
      },
    },
    MuiStepper: {
      styleOverrides: {
        root: { backgroundColor: 'transparent' },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: softTokens.ink,
          color: '#FFFFFF',
          borderRadius: 10,
          fontSize: '0.78rem',
        },
        arrow: { color: softTokens.ink },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: softTokens.radius.md },
        standardSuccess: { backgroundColor: softTokens.mint.main, color: softTokens.mint.ink },
        standardWarning: { backgroundColor: softTokens.lemon.main, color: softTokens.lemon.ink },
        standardError:   { backgroundColor: softTokens.peach.main, color: softTokens.peach.ink },
        standardInfo:    { backgroundColor: softTokens.fog,        color: softTokens.lavender.ink },
      },
    },
    MuiSnackbar: {
      defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } },
    },
  },
});

export default theme;
