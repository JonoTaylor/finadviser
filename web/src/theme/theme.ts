'use client';

import { alpha, createTheme } from '@mui/material/styles';

export const designTokens = {
  canvas: '#F5F7FA', surface: '#FFFFFF', border: '#E2E8F0',
  nav: '#0F172A', navText: '#CBD5E1', navMuted: '#94A3B8',
  accent: '#0F766E', accentSoft: '#F0FDFA',
  text: '#0F172A', secondary: '#475569', muted: '#5F6E83',
} as const;

// Compatibility exports keep existing views on the same restrained palette.
export const softTokens = {
  mint: { main: '#ECFDF5', deep: '#0F766E', ink: '#047857' },
  lemon: { main: '#FFFBEB', deep: '#B45309', ink: '#92400E' },
  lavender: { main: '#EFF6FF', deep: '#2563EB', ink: '#1D4ED8' },
  peach: { main: '#FEF2F2', deep: '#DC2626', ink: '#B91C1C' },
  cream: '#F8FAFC', stone: '#F1F5F9', fog: '#EFF6FF',
  ink: designTokens.text, ink2: designTokens.secondary, ink3: designTokens.muted, ink4: designTokens.muted,
  shadowPillow: '0 1px 2px rgba(15,23,42,0.04)', shadowPillowLift: '0 2px 6px rgba(15,23,42,0.06)',
  radius: { sm: 6, md: 8, lg: 10, xl: 12, '2xl': 12, '3xl': 16, pill: 999 },
} as const;

export const fontFamily = 'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const serifFamily = fontFamily;

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: designTokens.accent, dark: '#115E59', contrastText: '#FFFFFF' },
    secondary: { main: '#334155', contrastText: '#FFFFFF' },
    success: { main: '#047857', contrastText: '#FFFFFF' },
    warning: { main: '#B45309', contrastText: '#FFFFFF' },
    error: { main: '#B91C1C', contrastText: '#FFFFFF' },
    info: { main: '#1D4ED8', contrastText: '#FFFFFF' },
    background: { default: designTokens.canvas, paper: designTokens.surface },
    text: { primary: designTokens.text, secondary: designTokens.secondary, disabled: '#94A3B8' },
    divider: designTokens.border,
  },
  typography: {
    fontFamily,
    h1: { fontSize: '2.25rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.04em' },
    h2: { fontSize: '2rem', fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.035em' },
    h3: { fontSize: '1.875rem', fontWeight: 650, lineHeight: 1.3, letterSpacing: '-0.035em' },
    h4: { fontSize: '1.75rem', fontWeight: 650, lineHeight: 1.3, letterSpacing: '-0.03em' },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.45, letterSpacing: '-0.015em' },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5, letterSpacing: '-0.01em' },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 600 }, subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.65 }, body2: { fontSize: '0.875rem', lineHeight: 1.6 },
    caption: { fontSize: '0.75rem', lineHeight: 1.55, color: designTokens.muted },
    overline: { fontSize: '0.6875rem', fontWeight: 650, lineHeight: 1.8, letterSpacing: '0.08em' },
    button: { fontSize: '0.8125rem', fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: { styleOverrides: {
      body: { background: designTokens.canvas, color: designTokens.text, minHeight: '100vh', fontVariantNumeric: 'tabular-nums' },
      '::selection': { backgroundColor: '#CCFBF1', color: '#134E4A' },
      ':focus-visible': { outline: '2px solid #0D9488', outlineOffset: 3 },
      '::-webkit-scrollbar': { width: 7, height: 7 }, '::-webkit-scrollbar-track': { background: 'transparent' },
      '::-webkit-scrollbar-thumb': { background: '#CBD5E1', borderRadius: 8 },
    } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: designTokens.border } } },
    MuiCard: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: designTokens.surface, borderRadius: 12, border: '1px solid ' + designTokens.border, boxShadow: softTokens.shadowPillow } } },
    MuiCardContent: { styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 }, '@media (max-width:600px)': { padding: 16, '&:last-child': { paddingBottom: 16 } } } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: {
      root: { textTransform: 'none', borderRadius: 7, fontWeight: 600, minHeight: 38, padding: '8px 14px', lineHeight: 1.4, whiteSpace: 'nowrap' },
      sizeSmall: { minHeight: 32, padding: '5px 10px', fontSize: '0.75rem' }, sizeLarge: { minHeight: 44, padding: '10px 18px' },
      outlined: { borderColor: '#CBD5E1', color: '#334155', '&:hover': { borderColor: '#94A3B8', backgroundColor: '#F8FAFC' } },
      text: { '&:hover': { backgroundColor: alpha(designTokens.accent, 0.05) } },
    } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiFab: { styleOverrides: { root: { boxShadow: softTokens.shadowPillowLift } } },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
    MuiInputBase: { styleOverrides: { input: { '&::placeholder': { color: designTokens.muted, opacity: 1 } } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 7, backgroundColor: '#FFFFFF', fontSize: '0.875rem', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#CBD5E1' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#94A3B8' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: designTokens.accent, borderWidth: 1.5 } } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 0, fontSize: '0.75rem', lineHeight: 1.5 } } },
    MuiAutocomplete: { styleOverrides: { paper: { borderRadius: 8, border: '1px solid ' + designTokens.border, boxShadow: '0 8px 24px rgba(15,23,42,0.1)' } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 8, border: '1px solid ' + designTokens.border, boxShadow: '0 8px 24px rgba(15,23,42,0.1)' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 12, boxShadow: '0 24px 80px rgba(15,23,42,0.2)', '@media (max-width:600px)': { margin: 16, width: 'calc(100% - 32px)' } } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 600, padding: '20px 24px 16px', borderBottom: '1px solid ' + designTokens.border } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '20px 24px', '&:first-of-type': { paddingTop: 20 } } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px', borderTop: '1px solid ' + designTokens.border, gap: 6 } } },
    MuiChip: { styleOverrides: {
      root: { borderRadius: 5, fontWeight: 550, fontSize: '0.6875rem', height: 24 },
      colorSuccess: { backgroundColor: softTokens.mint.main, color: softTokens.mint.ink }, colorWarning: { backgroundColor: softTokens.lemon.main, color: softTokens.lemon.ink },
      colorError: { backgroundColor: softTokens.peach.main, color: softTokens.peach.ink }, colorInfo: { backgroundColor: softTokens.lavender.main, color: softTokens.lavender.ink },
      colorDefault: { backgroundColor: '#F1F5F9', color: '#475569' }, outlined: { borderColor: '#CBD5E1', backgroundColor: 'transparent' },
    } },
    MuiTableCell: { styleOverrides: {
      root: { borderColor: designTokens.border, padding: '12px 16px', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' },
      head: { fontWeight: 600, color: designTokens.muted, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.045em', backgroundColor: '#F8FAFC', whiteSpace: 'nowrap' },
      sizeSmall: { padding: '10px 14px' },
    } },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: '#F8FAFC' } } } },
    MuiTablePagination: { styleOverrides: { root: { borderTop: '1px solid ' + designTokens.border }, toolbar: { minHeight: 52 }, selectLabel: { fontSize: '0.75rem' }, displayedRows: { fontSize: '0.75rem' } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundColor: designTokens.nav, color: designTokens.navText, backgroundImage: 'none', borderRight: 'none' } } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 6, padding: '8px 12px', '&.Mui-selected': { backgroundColor: alpha(designTokens.accent, 0.1), color: designTokens.accent }, '&.Mui-selected:hover': { backgroundColor: alpha(designTokens.accent, 0.14) } } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 42 }, indicator: { height: 2, borderRadius: 2 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 42, padding: '10px 16px', minWidth: 0, fontSize: '0.8125rem', fontWeight: 550 } } },
    MuiAccordion: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', border: '1px solid ' + designTokens.border, '&:before': { display: 'none' }, '&:first-of-type': { borderTopLeftRadius: 8, borderTopRightRadius: 8 }, '&:last-of-type': { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 } } } },
    MuiAccordionSummary: { styleOverrides: { root: { minHeight: 48 }, content: { margin: '12px 0' } } },
    MuiLinearProgress: { styleOverrides: { root: { height: 5, borderRadius: 3, backgroundColor: '#E2E8F0' } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#0F172A', borderRadius: 6, fontSize: '0.75rem' }, arrow: { color: '#0F172A' } } },
    MuiAlert: { styleOverrides: {
      root: { borderRadius: 8, fontSize: '0.8125rem', border: '1px solid transparent', padding: '8px 12px', alignItems: 'flex-start' },
      standardSuccess: { backgroundColor: '#F0FDF4', color: '#166534', borderColor: '#BBF7D0' }, standardWarning: { backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' },
      standardError: { backgroundColor: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA' }, standardInfo: { backgroundColor: '#F8FAFC', color: '#475569', borderColor: '#E2E8F0' },
      icon: { paddingTop: 6, fontSize: 20 },
    } },
    MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: '#E2E8F0', borderRadius: 6 } } },
  },
});

export default theme;
