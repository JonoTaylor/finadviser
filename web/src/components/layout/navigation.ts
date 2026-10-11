export const navigationGroups = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/' },
      { label: 'My next steps', href: '/review' },
      { label: 'Financial plan', href: '/plan' },
    ],
  },
  {
    label: 'Daily money',
    items: [
      { label: 'Spending', href: '/spending' },
      { label: 'Transactions', href: '/transactions' },
      { label: 'Savings goals', href: '/goals' },
      { label: 'Debt planner', href: '/debts' },
    ],
  },
  {
    label: 'Wealth',
    items: [
      { label: 'Properties', href: '/properties' },
      { label: 'Investments', href: '/investments' },
      { label: 'Holdings & fees', href: '/portfolio' },
      { label: 'Pensions', href: '/pensions' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Import', href: '/import' },
      { label: 'Documents', href: '/documents' },
      { label: 'AI adviser', href: '/chat' },
    ],
  },
] as const;

export const accountItems = [
  { label: 'My context', href: '/profile' },
  { label: 'Settings', href: '/settings' },
] as const;

type NavigationItem = { label: string; href: string };

/** Match complete path segments, so /plan never selects /planning. */
export function activeNavigationItem(
  pathname: string,
  items: readonly NavigationItem[] = [
    ...navigationGroups.flatMap<NavigationItem>((group) => group.items),
    ...accountItems,
  ],
): NavigationItem | undefined {
  return items
    .filter((item) => item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`))
    .reduce<NavigationItem | undefined>(
      (selected, item) => !selected || item.href.length > selected.href.length ? item : selected,
      undefined,
    );
}

export function navigationContext(pathname: string): { section: string; title: string } {
  const selected = activeNavigationItem(pathname);
  if (!selected) return { section: 'Workspace', title: 'FinAdviser' };
  const group = navigationGroups.find((entry) => entry.items.some((item) => item.href === selected.href));
  const nestedTitles: Record<string, string> = {
    '/properties/operations': 'Rent & property tasks',
    '/pensions/records': 'Pension records',
  };
  return { section: group?.label ?? 'Your workspace', title: nestedTitles[pathname] ?? selected.label };
}
