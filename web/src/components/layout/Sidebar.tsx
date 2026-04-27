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
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { softTokens, serifFamily } from '@/theme/theme';
import LogoutButton from '@/components/auth/LogoutButton';

const DRAWER_WIDTH = 240;

const navItems = [
  { label: 'Dashboard',    href: '/',              icon: <DashboardRoundedIcon /> },
  { label: 'Transactions', href: '/transactions',  icon: <ReceiptLongRoundedIcon /> },
  { label: 'Import',       href: '/import',        icon: <FileUploadRoundedIcon /> },
  { label: 'Properties',   href: '/properties',    icon: <HomeWorkRoundedIcon /> },
  { label: 'Investments',  href: '/investments',   icon: <TrendingUpRoundedIcon /> },
  { label: 'Documents',    href: '/documents',     icon: <FolderRoundedIcon /> },
  { label: 'AI Chat',      href: '/chat',          icon: <AutoAwesomeRoundedIcon /> },
  { label: 'Settings',     href: '/settings',      icon: <TuneRoundedIcon /> },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', py: 1.5 }}>
      <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: softTokens.lavender.main,
          }}
        >
          <ShowChartRoundedIcon sx={{ fontSize: 20, color: softTokens.ink }} />
        </Box>
        <Box>
          <Typography
            sx={{
              fontFamily: serifFamily,
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: '1.25rem',
              lineHeight: 1.1,
              color: softTokens.ink,
            }}
          >
            FinAdviser
          </Typography>
          <Typography variant="caption" sx={{ color: softTokens.ink3, lineHeight: 1 }}>
            Personal Finance
          </Typography>
        </Box>
      </Box>

      <List sx={{ flex: 1, px: 1, pt: 1 }}>
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
                    minWidth: 36,
                    color: isActive ? softTokens.mint.deep : softTokens.ink3,
                    transition: 'color 0.15s',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 500,
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" sx={{ color: softTokens.ink4 }}>
          v0.1.0
        </Typography>
        <LogoutButton />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {isMobile && (
        <IconButton
          onClick={() => setMobileOpen(true)}
          sx={{
            position: 'fixed',
            top: 12,
            left: 12,
            zIndex: 1300,
            backgroundColor: 'background.paper',
            boxShadow: softTokens.shadowPillow,
            borderRadius: softTokens.radius.pill,
            '&:hover': { backgroundColor: 'background.paper' },
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
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3, md: 5 },
          pt: isMobile ? 7 : undefined,
          width: isMobile ? '100%' : `calc(100% - ${DRAWER_WIDTH}px)`,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
