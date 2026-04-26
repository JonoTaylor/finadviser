import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { resolveModelId } from '@/lib/ai/model';
import type { RentFrequency } from '@/lib/repos/tenancy.repo';
import { schema } from '@/lib/db';

/**
 * AI extraction of tenancy fields from a UK AST agreement PDF. Returns
 * a *preview* the user must confirm before we persist a tenancy row —
 * the extractor is best-effort and can miss / mislabel fields, so the
 * UI gives the user a chance to correct each value before commit.
 */

// Single source of truth: the rent_frequency enum on the schema.
const VALID_FREQUENCIES = schema.rentFrequencyEnum.enumValues;

export interface ExtractedTenancy {
  tenantName: string | null;
  startDate: string | null;
  endDate: string | null;
  rentAmount: string | null;
  rentFrequency: RentFrequency | null;
  depositAmount: string | null;
  propertyAddress: string | null;
  notes: string | null;
}

const TENANCY_EXTRACTION_PROMPT = `You are extracting structured fields from a UK Assured Shorthold Tenancy (AST) agreement.

Return ONLY a JSON object — no markdown, no commentary. The object MUST have exactly these keys:
{
  "tenantName": string | null,           // all named tenants, joined with " & " (e.g. "Alice Smith & Bob Jones")
  "startDate": string | null,            // YYYY-MM-DD; the tenancy commencement / start date
  "endDate": string | null,              // YYYY-MM-DD; the fixed-term end date if any, otherwise null
  "rentAmount": string | null,           // numeric only, in GBP, no currency symbol or commas (e.g. "1450.00")
  "rentFrequency": "monthly" | "weekly" | "four_weekly" | "quarterly" | "annual" | null,
  "depositAmount": string | null,        // numeric only, GBP, no symbol (e.g. "2100.00")
  "propertyAddress": string | null,      // the full address of the let property
  "notes": string | null                 // anything important the user might want recorded (break clauses, special terms). Null if nothing notable.
}

Rules:
- If a field is genuinely not present, return null — do NOT guess.
- Dates must be ISO YYYY-MM-DD. Convert "5th April 2024" → "2024-04-05".
- "rentAmount" is the periodic rent (per the rentFrequency), not annualised.
- "tenantName" must be the tenant(s), not the landlord/agent.
- Output JSON only.

Tenancy agreement text:
`;

async function extractTextFromPDF(fileBuffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(fileBuffer);
  return result.text;
}

function coerceFrequency(value: unknown): RentFrequency | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase().replace(/[\s-]/g, '_') as RentFrequency;
  return VALID_FREQUENCIES.includes(lower) ? lower : null;
}

function coerceAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : null;
  if (typeof value === 'string') {
    // Strip currency symbols, commas, whitespace.
    const cleaned = value.replace(/[£$,\s]/g, '');
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num.toFixed(2) : null;
  }
  return null;
}

function coerceDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Accept YYYY-MM-DD only (the prompt asks for it). Be lenient if AI
  // sneaks in dates with slashes — convert obvious cases, else null.
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;
  const slashed = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`;
  return null;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function parseTenancyPDF(fileBuffer: Buffer): Promise<ExtractedTenancy> {
  const text = await extractTextFromPDF(fileBuffer);

  if (!text || text.trim().length < 100) {
    throw new Error('Scanned/image-only PDFs are not supported. Please use a text-based PDF.');
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is required for tenancy PDF parsing');
  }

  const { modelId } = await resolveModelId();
  const { text: responseText } = await generateText({
    model: gateway(modelId),
    prompt: TENANCY_EXTRACTION_PROMPT + text.slice(0, 30000),
    maxOutputTokens: 1024,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract tenancy fields from this PDF. The AI did not return parseable JSON.');
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Could not extract tenancy fields from this PDF. The AI did not return parseable JSON.');
    }
  }

  return {
    tenantName: coerceString(parsed.tenantName),
    startDate: coerceDate(parsed.startDate),
    endDate: coerceDate(parsed.endDate),
    rentAmount: coerceAmount(parsed.rentAmount),
    rentFrequency: coerceFrequency(parsed.rentFrequency),
    depositAmount: coerceAmount(parsed.depositAmount),
    propertyAddress: coerceString(parsed.propertyAddress),
    notes: coerceString(parsed.notes),
  };
}
