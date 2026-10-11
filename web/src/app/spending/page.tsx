import FinancialPlanView from '@/components/planning/FinancialPlanView';

export const metadata = { title: 'Spending intelligence — FinAdviser' };

export default function SpendingPage() {
  return <FinancialPlanView initialSection="spending" />;
}
