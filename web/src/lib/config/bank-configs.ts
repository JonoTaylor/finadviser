export interface ColumnMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;

  // Optional extras for rich exports (Monzo). Every field below is
  // optional — banks that don't have these columns simply omit them
  // and the parser writes nothing into transaction_metadata.
  externalId?: string;       // e.g. Monzo "Transaction ID"
  time?: string;             // e.g. Monzo "Time"
  type?: string;             // e.g. Monzo "Type"
  merchantName?: string;     // e.g. Monzo "Name"
  merchantEmoji?: string;    // e.g. Monzo "Emoji"
  bankCategory?: string;     // e.g. Monzo "Category"
  currency?: string;
  localAmount?: string;
  localCurrency?: string;
  notes?: string;            // e.g. Monzo "Notes and #tags"
  address?: string;
  receiptUrl?: string;       // e.g. Monzo "Receipt"
  // Some banks split debits and credits into two columns under
  // different names. These act as aliases for `debit` / `credit`
  // (Monzo uses "Money Out" / "Money In").
  moneyOut?: string;
  moneyIn?: string;
}

export interface BankConfig {
  name: string;
  description: string;
  dateFormat: string;
  columns: ColumnMapping;
  skipRows: number;
  encoding: string;
  delimiter: string;
  signConvention: 'standard' | 'inverted';
  amountMultiplier: number;
}

export const bankConfigs: Record<string, BankConfig> = {
  'generic-csv': {
    name: 'generic-csv',
    description: 'Generic CSV (Date, Description, Amount)',
    dateFormat: 'DD/MM/YYYY',
    columns: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
    },
    skipRows: 0,
    encoding: 'utf-8',
    delimiter: ',',
    signConvention: 'standard',
    amountMultiplier: 1.0,
  },
  'uk-bank-standard': {
    name: 'uk-bank-standard',
    description: 'UK Bank - Standard Format',
    dateFormat: 'DD/MM/YYYY',
    columns: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
    },
    skipRows: 0,
    encoding: 'utf-8',
    delimiter: ',',
    signConvention: 'standard',
    amountMultiplier: 1.0,
  },
  'uk-bank-debit-credit': {
    name: 'uk-bank-debit-credit',
    description: 'UK Bank - Debit/Credit Split',
    dateFormat: 'DD/MM/YYYY',
    columns: {
      date: 'Date',
      description: 'Description',
      debit: 'Debit',
      credit: 'Credit',
    },
    skipRows: 0,
    encoding: 'utf-8',
    delimiter: ',',
    signConvention: 'standard',
    amountMultiplier: 1.0,
  },
  'monzo': {
    name: 'monzo',
    description: 'Monzo (full export — captures merchant, type, notes, currency, etc.)',
    dateFormat: 'DD/MM/YYYY',
    columns: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      reference: 'Notes and #tags',
      externalId: 'Transaction ID',
      time: 'Time',
      type: 'Type',
      merchantName: 'Name',
      merchantEmoji: 'Emoji',
      bankCategory: 'Category',
      currency: 'Currency',
      localAmount: 'Local amount',
      localCurrency: 'Local currency',
      notes: 'Notes and #tags',
      address: 'Address',
      receiptUrl: 'Receipt',
    },
    skipRows: 0,
    encoding: 'utf-8',
    delimiter: ',',
    signConvention: 'standard',
    amountMultiplier: 1.0,
  },
  'us-bank-standard': {
    name: 'us-bank-standard',
    description: 'US Bank - Standard Format',
    dateFormat: 'MM/DD/YYYY',
    columns: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
    },
    skipRows: 0,
    encoding: 'utf-8',
    delimiter: ',',
    signConvention: 'standard',
    amountMultiplier: 1.0,
  },
};

export function getBankConfig(name: string): BankConfig | undefined {
  return bankConfigs[name];
}

export function getAllBankConfigs(): Record<string, BankConfig> {
  return bankConfigs;
}
