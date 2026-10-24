import { z } from 'zod';
import { specialistIds } from './catalog';

export const specialistPrioritySchema = z.enum(['high', 'medium', 'low']);
const detail = z.string().trim().min(1).max(1800);
export const specialistReportSchema = z.object({
  summary: detail,
  findings: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    detail,
    priority: specialistPrioritySchema,
    evidenceIds: z.array(z.string().max(80)).max(8),
  }).strict()).max(6),
  gaps: z.array(z.object({ field: z.string().trim().min(1).max(160), why: detail }).strict()).max(8),
  actions: z.array(z.object({ title: z.string().trim().min(1).max(160), reason: detail, priority: specialistPrioritySchema }).strict()).max(6),
  assumptions: z.array(z.string().trim().min(1).max(600)).max(8),
  warnings: z.array(z.string().trim().min(1).max(600)).max(8),
}).strict();
export type SpecialistReport = z.infer<typeof specialistReportSchema>;

export const specialistEvidenceSchema = z.object({
  id: z.string().max(80),
  tool: z.string().max(100),
  observedAt: z.iso.datetime(),
  status: z.enum(['available', 'unavailable']),
  truncated: z.boolean().default(false),
  parameters: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean(), z.null()]))
    .refine(value => Object.keys(value).length <= 4),
}).strict();
export type SpecialistEvidence = z.infer<typeof specialistEvidenceSchema>;

export const specialistResultSchema = z.object({
  specialistId: z.enum(specialistIds),
  name: z.string().max(120),
  status: z.enum(['complete', 'partial', 'unavailable', 'cancelled']),
  report: specialistReportSchema.nullable(),
  sources: z.array(specialistEvidenceSchema).max(8),
  durationMs: z.number().int().nonnegative(),
  modelId: z.string().max(200),
  promptVersion: z.literal('1'),
  scope: z.literal('read_only'),
  message: z.string().max(600).nullable(),
}).strict();
export type SpecialistResult = z.infer<typeof specialistResultSchema>;

export const adviserMessageMetadataSchema = z.object({
  version: z.literal(1),
  specialistMode: z.enum(['team', ...specialistIds]),
  specialistResults: z.array(specialistResultSchema).max(7),
  status: z.enum(['complete', 'interrupted']),
}).strict();
export type AdviserMessageMetadata = z.infer<typeof adviserMessageMetadataSchema>;

export type SpecialistEvent =
  | { type: 'specialist-start'; specialistId: typeof specialistIds[number]; label: string }
  | { type: 'specialist-result'; result: SpecialistResult };
