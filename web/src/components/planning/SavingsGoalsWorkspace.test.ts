import { describe, expect, it } from 'vitest';
import { savingsGoalPlan } from './SavingsGoalsWorkspace';
import { londonTodayIso } from '@/lib/dates/today';

const goal = { targetAmount: '1000.00', currentAmount: '100.00', targetDate: '2026-12-11', status: 'active' as const };

describe('savings goal contribution planning', () => {
  it('distinguishes saved money from remaining equal contributions, starting now', () => {
    const plan = savingsGoalPlan(goal, '2026-10-11');
    expect(plan.remaining.toFixed(2)).toBe('900.00');
    expect(plan.progress).toBe(10);
    expect(plan.contributions).toBe(3);
    expect(plan.monthlyContribution?.toFixed(2)).toBe('300.00');
  });

  it('rounds a penny shortfall up, rather than planning less than the target', () => {
    const plan = savingsGoalPlan({ ...goal, targetAmount: '1.00', currentAmount: '0.00' }, '2026-10-11');
    expect(plan.monthlyContribution?.toFixed(2)).toBe('0.34');
    expect(plan.monthlyContribution!.times(plan.contributions!).gte(plan.remaining)).toBe(true);
  });

  it('does not invent a date or monthly contribution for an undated goal', () => {
    const plan = savingsGoalPlan({ ...goal, targetDate: null }, '2026-10-11');
    expect(plan.timing).toBe('undated');
    expect(plan.monthlyContribution).toBeNull();
    expect(plan.contributions).toBeNull();
  });

  it('treats a target today as an immediate shortfall, without dividing by zero', () => {
    const plan = savingsGoalPlan({ ...goal, targetDate: '2026-10-11' }, '2026-10-11');
    expect(plan.timing).toBe('today');
    expect(plan.remaining.toFixed(2)).toBe('900.00');
    expect(plan.monthlyContribution).toBeNull();
  });

  it('makes overdue targets explicit and leaves monthly planning unavailable', () => {
    const plan = savingsGoalPlan({ ...goal, targetDate: '2026-10-10' }, '2026-10-11');
    expect(plan.timing).toBe('overdue');
    expect(plan.monthlyContribution).toBeNull();
  });

  it('keeps end-of-month contributions on the last valid day', () => {
    const february = savingsGoalPlan({ ...goal, targetDate: '2026-02-28' }, '2026-01-31');
    expect(february.contributions).toBe(2);
    const march = savingsGoalPlan({ ...goal, targetDate: '2026-03-30' }, '2026-01-31');
    expect(march.contributions).toBe(2);
    const leapDay = savingsGoalPlan({ ...goal, targetDate: '2028-02-29' }, '2028-01-31');
    expect(leapDay.contributions).toBe(2);
  });

  it('uses just one immediate contribution when the deadline is before next month’s date', () => {
    const plan = savingsGoalPlan({ ...goal, targetDate: '2026-11-10' }, '2026-10-11');
    expect(plan.contributions).toBe(1);
    expect(plan.monthlyContribution?.toFixed(2)).toBe('900.00');
  });

  it('caps displayed progress and has no negative remaining balance for overfunded goals', () => {
    const plan = savingsGoalPlan({ ...goal, currentAmount: '1200.00' }, '2026-10-11');
    expect(plan.progress).toBe(100);
    expect(plan.remaining.toFixed(2)).toBe('0.00');
    expect(plan.timing).toBe('reached');
    expect(plan.monthlyContribution).toBeNull();
  });

  it.each(['completed', 'cancelled'] as const)('pauses monthly planning for %s goals', status => {
    const plan = savingsGoalPlan({ ...goal, status }, '2026-10-11');
    expect(plan.timing).toBe('inactive');
    expect(plan.monthlyContribution).toBeNull();
    expect(plan.remaining.toFixed(2)).toBe('900.00');
  });

  it('uses the London date at a British summer time midnight boundary', () => {
    const today = londonTodayIso(new Date('2026-06-30T23:30:00Z'));
    const plan = savingsGoalPlan({ ...goal, targetDate: '2026-07-01' }, today);
    expect(today).toBe('2026-07-01');
    expect(plan.timing).toBe('today');
  });
});
