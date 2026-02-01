import Anthropic from '@anthropic-ai/sdk';
import type { RawTransaction } from '@/lib/types';
import crypto from 'crypto';

const PDF_EXTRACTION_PROMPT = `You are a financial data extraction assistant. Extract all transactions from this bank statement text.

For each transaction, extract:
- date: in YYYY-MM-DD format (infer the year from context if not explicitly shown)
- description: the transaction description / payee name
- amount: as a signed number string (negative for debits/payments, positive for credits/deposits)
- reference: any reference number if visible, otherwise null

Return ONLY a JSON array of objects with these fields. No explanation, no markdown — just the JSON array.

Example output:
[
  {"date": "2024-03-15", "description": "TESCO STORES", "amount": "-45.20", "reference": null},
  {"date": "2024-03-16", "description": "SALARY PAYMENT", "amount": "2500.00", "reference": "REF123"}
]

If you cannot find any transactions, return an empty array [].

Bank statement text:
`;

async function extractTextFromPDF(fileBuffer: Buffer): Promise<string> {
  // Dynamic import — pdf-parse v1.x is a simple function(buffer) => { text }
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(fileBuffer);
  return result.text;
}

export async function parsePDF(fileBuffer: Buffer): Promise<RawTransaction[]> {
  const text = await extractTextFromPDF(fileBuffer);

  if (!text || text.trim().length < 50) {
    throw new Error('Scanned/image-only PDFs are not supported. Please use a text-based PDF or CSV export.');
  }

  // Use Claude to extract structured transactions
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for PDF parsing');
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: PDF_EXTRACTION_PROMPT + text.slice(0, 15000),
      },
    ],
  });

  // Parse the AI response
  const responseText = message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let parsed: Array<{
    date: string;
    description: string;
    amount: string;
    reference?: string | null;
  }>;

  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Try to extract JSON from response if wrapped in markdown
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error('Could not extract transactions from this PDF. The AI could not parse the statement format.');
      }
    } else {
      throw new Error('Could not extract transactions from this PDF. The AI could not parse the statement format.');
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('No transactions found in this PDF.');
  }

  // Convert to RawTransaction format
  return parsed.map((txn) => {
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${txn.date}|${txn.description}|${txn.amount}`)
      .digest('hex')
      .slice(0, 16);

    return {
      date: txn.date,
      description: txn.description,
      amount: txn.amount,
      reference: txn.reference ?? null,
      fingerprint,
      isDuplicate: false,
      suggestedCategoryId: null,
    };
  });
}
