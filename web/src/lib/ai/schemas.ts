import { z } from 'zod';

export const categoryBreakdownSchema = z.object({
  category: z.string(),
  amount: z.number(),
  percentage: z.number(),
  trend: z.string().default(''),
});

export const spendingAnalysisSchema = z.object({
  period: z.string(),
  totalSpending: z.number(),
  totalIncome: z.number(),
  savingsRate: z.number(),
  categories: z.array(categoryBreakdownSchema).default([]),
  topIncreases: z.array(z.string()).default([]),
  savingsOpportunities: z.array(z.string()).default([]),
  unusualExpenses: z.array(z.string()).default([]),
  summary: z.string().default(''),
});

export const budgetRecommendationSchema = z.object({
  category: z.string(),
  currentSpending: z.number(),
  recommendedBudget: z.number(),
  classification: z.string().default(''),
});

export const budgetAnalysisSchema = z.object({
  monthlyIncome: z.number(),
  needsPct: z.number().default(0),
  wantsPct: z.number().default(0),
  savingsPct: z.number().default(0),
  recommendations: z.array(budgetRecommendationSchema).default([]),
  savingsTips: z.array(z.string()).default([]),
  summary: z.string().default(''),
});

export const chatResponseSchema = z.object({
  message: z.string(),
  followUpSuggestions: z.array(z.string()).default([]),
});

export const batchCategorizationSchema = z.object({
  categorized: z.record(z.string(), z.string()).default({}),
  uncategorized: z.array(z.string()).default([]),
  confidenceNotes: z.string().default(''),
});
