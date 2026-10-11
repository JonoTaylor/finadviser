'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import ExploreRoundedIcon from '@mui/icons-material/ExploreRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import PieChartRoundedIcon from '@mui/icons-material/PieChartRounded';
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { designTokens } from '@/theme/theme';
import LogoutButton from '@/components/auth/LogoutButton';
import { accountItems, activeNavigationItem, navigationContext, navigationGroups } from './navigation';

const DRAWER_WIDTH = 248;
const navigationColour = { background: designTokens.nav, text: designTokens.navText, muted: designTokens.navMuted, accent: '#5EEAD4' };
const icons: Record<string, ReactNode> = {
  '/': <DashboardRoundedIcon />,
  '/review': <ChecklistRoundedIcon />,
  '/plan': <ExploreRoundedIcon />,
  '/spending': <ShowChartRoundedIcon />,
  '/transactions': <ReceiptLongRoundedIcon />,
  '/goals': <FlagRoundedIcon />,
  '/debts': <CreditCardRoundedIcon />,
  '/properties': <HomeWorkRoundedIcon />,
  '/investments': <TrendingUpRoundedIcon />,
  '/portfolio': <PieChartRoundedIcon />,
  '/pensions': <SavingsRoundedIcon />,
  '/import': <FileUploadRoundedIcon />,
  '/documents': <FolderRoundedIcon />,
  '/chat': <AutoAwesomeRoundedIcon />,
  '/profile': <PersonOutlineRoundedIcon />,
  '/settings': <TuneRoundedIcon />,
};

export default function Sidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [today, setToday] = useState('');
  const activeItem = activeNavigationItem(pathname);
  const context = navigationContext(pathname);

  useEffect(() => {
    const update = () => setToday(new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
    }).format(new Date()));
    update();
    const interval = window.setInterval(update, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  if (pathname === '/login') return <>{children}</>;

  const navigationRow = (item: { label: string; href: string }) => {
    const selected = activeItem?.href === item.href;
    return (
      <ListItem key={item.href} disablePadding sx={{ mb: 0.25 }}>
        <ListItemButton
          component={Link}
          href={item.href}
          selected={selected}
          aria-current={selected ? 'page' : undefined}
          onClick={() => setMobileOpen(false)}
          sx={{
            minHeight: 38, m: 0, px: 1.5, py: 0.5, borderRadius: '7px', color: navigationColour.text,
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)', color: '#FFFFFF' },
            '&.Mui-selected': {
              backgroundColor: 'rgba(45, 212, 191, 0.12)', color: navigationColour.accent,
              '&:hover': { backgroundColor: 'rgba(45, 212, 191, 0.16)' },
            },
            '&.Mui-focusVisible': { outline: '2px solid #5EEAD4', outlineOffset: -2 },
          }}
        >
          <ListItemIcon sx={{ minWidth: 31, color: 'inherit', '& svg': { fontSize: 19 } }}>
            {icons[item.href]}
          </ListItemIcon>
          <ListItemText
            primary={item.label}
            primaryTypographyProps={{ fontSize: '0.8125rem', fontWeight: selected ? 600 : 450, lineHeight: 1.35 }}
          />
        </ListItemButton>
      </ListItem>
    );
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', color: navigationColour.text }}>
      <Box sx={{ height: 88, px: 2.75, display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
        <Box component={Link} href="/" aria-label="FinAdviser dashboard" onClick={() => setMobileOpen(false)} sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, color: 'inherit', textDecoration: 'none',
          borderRadius: 1, '&:focus-visible': { outline: '2px solid #5EEAD4', outlineOffset: 5 },
        }}>
          <Box sx={{
            width: 33, height: 33, borderRadius: '8px', backgroundColor: designTokens.accent, color: designTokens.surface,
            display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <ShowChartRoundedIcon sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: '#FFFFFF', fontSize: '1.0625rem', fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.4 }}>
              FinAdviser
            </Typography>
            <Typography sx={{ color: navigationColour.muted, fontSize: '0.6875rem', lineHeight: 1.5 }}>
              Your financial workspace
            </Typography>
          </Box>
        </Box>
        {isMobile && (
          <IconButton aria-label="Close navigation" onClick={() => setMobileOpen(false)} sx={{ ml: 'auto', mr: -1.5, color: navigationColour.muted }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box component="nav" id="main-navigation" aria-label="Main navigation" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, pb: 1.5,
        scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent',
      }}>
        {navigationGroups.map((group) => (
          <Box key={group.label} sx={{ mb: 1.5 }}>
            <Typography sx={{
              px: 1.5, pt: 0.5, pb: 0.75, color: navigationColour.muted,
              fontSize: '0.625rem', fontWeight: 650, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              {group.label}
            </Typography>
            <List disablePadding>{group.items.map(navigationRow)}</List>
          </Box>
        ))}
      </Box>

      <Box component="nav" aria-label="Account navigation" sx={{ px: 1.5, pt: 1.25, pb: 1.5, borderTop: '1px solid #263247', flexShrink: 0 }}>
        <List disablePadding>{accountItems.map(navigationRow)}</List>
        <Box sx={{ px: 0.5, pt: 0.5, '& .MuiButton-root': {
          color: navigationColour.muted, width: '100%', justifyContent: 'flex-start', px: 1,
          fontSize: '0.75rem', fontWeight: 450, borderRadius: '7px',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.06)', color: '#FFFFFF' },
        } }}>
          <LogoutButton />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', backgroundColor: designTokens.canvas }}>
      <Box component="a" href="#main-content" sx={{
        position: 'fixed', left: 12, top: 12, zIndex: 1500, transform: 'translateY(-200%)',
        backgroundColor: designTokens.surface, color: designTokens.text, px: 2, py: 1, borderRadius: 1,
        fontSize: '0.875rem', fontWeight: 600, boxShadow: 2,
        '&:focus': { transform: 'translateY(0)', outline: '2px solid #0F766E' },
      }}>
        Skip to content
      </Box>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: isMobile ? 0 : DRAWER_WIDTH, flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
            backgroundColor: navigationColour.background, border: 0, borderRadius: 0,
            height: '100dvh', boxShadow: 'none', backgroundImage: 'none', backdropFilter: 'none',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : `calc(100% - ${DRAWER_WIDTH}px)` }}>
        <Box component="header" sx={{
          height: 64, position: 'sticky', top: 0, zIndex: theme.zIndex.appBar,
          backgroundColor: designTokens.surface, borderBottom: `1px solid ${designTokens.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
          px: { xs: 2, sm: 3, md: 4, xl: 5 },
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            {isMobile && (
              <IconButton aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="main-navigation" onClick={() => setMobileOpen(true)} edge="start" sx={{ color: designTokens.secondary }}>
                <MenuRoundedIcon fontSize="small" />
              </IconButton>
            )}
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, color: designTokens.muted, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
              {context.section}
            </Typography>
            <ChevronRightRoundedIcon sx={{ display: { xs: 'none', sm: 'block' }, color: '#CBD5E1', fontSize: 16 }} />
            <Typography noWrap sx={{ color: '#334155', fontSize: '0.8125rem', fontWeight: 600 }}>
              {context.title}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, color: designTokens.muted, fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
              {today}
            </Typography>
            <Tooltip title="Reporting currency: British pounds">
              <Box sx={{ color: designTokens.secondary, backgroundColor: '#F8FAFC', border: `1px solid ${designTokens.border}`,
                borderRadius: '6px', px: 1, py: 0.375, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.025em',
              }}>
                GBP
              </Box>
            </Tooltip>
          </Box>
        </Box>
        <Box component="main" id="main-content" tabIndex={-1} sx={{
          p: { xs: 2, sm: 3, md: 4, xl: 5 }, width: '100%', maxWidth: 1500, mx: 'auto', outline: 'none',
        }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
