export interface ColumnMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
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
