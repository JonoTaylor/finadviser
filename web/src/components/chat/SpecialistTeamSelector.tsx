'use client';

import { useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Stack, Typography,
} from '@mui/material';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { SPECIALISTS, type AdviserMode, type SpecialistId } from '@/lib/ai/specialists/catalog';

const ICONS = {
  tax: AccountBalanceOutlinedIcon, spending: ShoppingCartOutlinedIcon, wealth: TrendingUpOutlinedIcon,
  pensions: SavingsOutlinedIcon, property: HomeWorkOutlinedIcon, debt: CreditCardOutlinedIcon, data: FactCheckOutlinedIcon,
};

export function SpecialistIcon({ specialistId }: { specialistId: SpecialistId | 'team' }) {
  const Icon = specialistId === 'team' ? GroupsOutlinedIcon : ICONS[specialistId];
  return <Icon fontSize="small" />;
}

export function adviserModeName(mode: AdviserMode): string {
  return mode === 'team' ? 'Financial adviser' : SPECIALISTS.find(specialist => specialist.id === mode)?.name ?? 'Specialist';
}

export default function SpecialistTeamSelector({ value, disabled, onChange, onAsk }: {
  value: AdviserMode; disabled: boolean; onChange: (mode: AdviserMode) => void;
  onAsk: (mode: AdviserMode, question: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const specialist = SPECIALISTS.find(item => item.id === value);
  return <>
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.5 }}>
      <FormControl size="small" sx={{ minWidth: { xs: 0, sm: 230 }, flex: { xs: 1, sm: '0 0 auto' } }}>
        <InputLabel id="adviser-mode-label">Who should lead?</InputLabel>
        <Select labelId="adviser-mode-label" label="Who should lead?" value={value} disabled={disabled}
          onChange={event => onChange(event.target.value as AdviserMode)}>
          <MenuItem value="team">Financial adviser · team</MenuItem>
          {SPECIALISTS.map(item => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, flex: 1, lineHeight: 1.5 }}>
        {specialist?.description ?? 'Your adviser brings the relevant specialists together into one financial plan.'}
      </Typography>
      <Button size="small" startIcon={<GroupsOutlinedIcon />} onClick={() => setOpen(true)} sx={{ flexShrink: 0 }}>
        Meet your team
      </Button>
    </Stack>

    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle>Your financial planning team</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose a focus, or let your financial adviser bring in the right specialists. They use your recorded information and highlight what still needs confirming.
        </Typography>
        <Card variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}><CardContent>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}><GroupsOutlinedIcon color="primary" /><Typography variant="subtitle1" fontWeight={600}>Financial adviser</Typography><Chip label="Coordinates your team" size="small" variant="outlined" /></Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Connect spending, tax, pensions, property and investing decisions into one ordered plan. Changes to records stay with your adviser and the actions you request.</Typography>
          <Button disabled={disabled} size="small" variant={value === 'team' ? 'contained' : 'outlined'} onClick={() => { onChange('team'); setOpen(false); }}>Use financial adviser</Button>
        </CardContent></Card>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
          {SPECIALISTS.map(item => <Card key={item.id} variant="outlined" sx={{ minWidth: 0, borderColor: value === item.id ? 'primary.main' : 'divider' }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}><Box sx={{ color: 'primary.main', display: 'flex' }}><SpecialistIcon specialistId={item.id} /></Box><Typography variant="subtitle2">{item.name}</Typography></Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{item.description}</Typography>
              <Button size="small" disabled={disabled} variant={value === item.id ? 'contained' : 'outlined'} onClick={() => { onChange(item.id); setOpen(false); }}>Choose {item.name}</Button>
              {item.exampleQuestions.slice(0, 1).map(question => <Button key={question} size="small" disabled={disabled} onClick={() => { setOpen(false); onAsk(item.id, question); }} sx={{ mt: 1, textAlign: 'left', justifyContent: 'flex-start', display: 'block', lineHeight: 1.5 }}>{question}</Button>)}
            </CardContent>
          </Card>)}
        </Box>
        <Button onClick={() => setOpen(false)} sx={{ mt: 2 }}>Close</Button>
      </DialogContent>
    </Dialog>
  </>;
}
