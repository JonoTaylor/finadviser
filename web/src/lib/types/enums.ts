export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum MatchType {
  CONTAINS = 'contains',
  STARTSWITH = 'startswith',
  EXACT = 'exact',
  REGEX = 'regex',
}

export enum RuleSource {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}
