'use client';

import { useState } from 'react';
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
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, alpha } from '@mui/material/styles';
import { glassCard } from '@/theme/theme';

const DRAWER_WIDTH = 260;

const navItems = [
  { label: 'Dashboard',    href: '/',              icon: <DashboardRoundedIcon /> },
  { label: 'Transactions', href: '/transactions',  icon: <ReceiptLongRoundedIcon /> },
  { label: 'Import',       href: '/import',        icon: <FileUploadRoundedIcon /> },
  { label: 'Properties',   href: '/properties',    icon: <HomeWorkRoundedIcon /> },
  { label: 'AI Chat',      href: '/chat',          icon: <AutoAwesomeRoundedIcon /> },
  { label: 'Settings',     href: '/settings',      icon: <TuneRoundedIcon /> },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', py: 1.5 }}>
      {/* ── Brand ────────────────────────────────────── */}
      <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            boxShadow: `0 2px 12px -2px ${alpha(theme.palette.primary.main, 0.3)}`,
          }}
        >
          <ShowChartRoundedIcon sx={{ fontSize: 20, color: '#fff' }} />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'text.primary' }}>
            FinAdviser
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1 }}>
            Personal Finance
          </Typography>
        </Box>
      </Box>

      {/* ── Navigation ───────────────────────────────── */}
      <List sx={{ flex: 1, px: 1.5, pt: 1 }}>
        {navItems.map((item) => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
          return (
            <ListItem key={item.href} disablePadding sx={{ mb: 0.25 }}>
              <ListItemButton
                component={Link}
                href={item.href}
                selected={isActive}
                onClick={() => isMobile && setMobileOpen(false)}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: isActive ? 'primary.main' : 'text.secondary',
                    transition: 'color 0.15s',
                    ...(isActive && {
                      filter: `drop-shadow(0 0 6px ${alpha(theme.palette.primary.main, 0.4)})`,
                    }),
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'text.primary' : 'text.secondary',
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* ── Footer ───────────────────────────────────── */}
      <Box sx={{ px: 2.5, py: 1.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.4 }}>
          v0.1.0
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {isMobile && (
        <IconButton
          onClick={() => setMobileOpen(true)}
          sx={{
            position: 'fixed',
            top: 12,
            left: 12,
            zIndex: 1300,
            ...glassCard,
            '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.95) },
          }}
        >
          <MenuRoundedIcon />
        </IconButton>
      )}

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: `1px solid rgba(184,169,232,0.04)`,
            ...(isMobile && glassCard),
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3, md: 4 },
          pt: isMobile ? 7 : undefined,
          width: isMobile ? '100%' : `calc(100% - ${DRAWER_WIDTH}px)`,
          maxWidth: 1400,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
