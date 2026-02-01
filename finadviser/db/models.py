"""Pydantic data models for all database entities."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class AccountType(str, Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class MatchType(str, Enum):
    CONTAINS = "contains"
    STARTSWITH = "startswith"
    EXACT = "exact"
    REGEX = "regex"


class RuleSource(str, Enum):
    USER = "user"
    AI = "ai"
    SYSTEM = "system"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


# --- Core financial entities ---


class Account(BaseModel):
    id: int | None = None
    name: str
    account_type: AccountType
    parent_id: int | None = None
    description: str | None = None
    is_system: bool = False
    created_at: datetime | None = None


class Category(BaseModel):
    id: int | None = None
    name: str
    parent_id: int | None = None
    is_system: bool = False
    created_at: datetime | None = None


class CategorizationRule(BaseModel):
    id: int | None = None
    pattern: str
    category_id: int
    match_type: MatchType = MatchType.CONTAINS
    priority: int = 0
    source: RuleSource = RuleSource.USER
    created_at: datetime | None = None


class JournalEntry(BaseModel):
    id: int | None = None
    date: date
    description: str
    reference: str | None = None
    category_id: int | None = None
    import_batch_id: int | None = None
    created_at: datetime | None = None


class BookEntry(BaseModel):
    id: int | None = None
    journal_entry_id: int
    account_id: int
    amount: Decimal
    created_at: datetime | None = None


class ImportBatch(BaseModel):
    id: int | None = None
    filename: str
    bank_config: str
    account_id: int
    row_count: int = 0
    imported_count: int = 0
    duplicate_count: int = 0
    imported_at: datetime | None = None


class TransactionFingerprint(BaseModel):
    id: int | None = None
    fingerprint: str
    account_id: int
    journal_entry_id: int
    created_at: datetime | None = None


# --- Property entities ---


class Property(BaseModel):
    id: int | None = None
    name: str
    address: str | None = None
    purchase_date: date | None = None
    purchase_price: Decimal | None = None
    created_at: datetime | None = None


class Owner(BaseModel):
    id: int | None = None
    name: str
    created_at: datetime | None = None


class PropertyOwnership(BaseModel):
    id: int | None = None
    property_id: int
    owner_id: int
    capital_account_id: int
    created_at: datetime | None = None


class Mortgage(BaseModel):
    id: int | None = None
    property_id: int
    lender: str
    original_amount: Decimal
    start_date: date
    term_months: int
    liability_account_id: int
    created_at: datetime | None = None


class MortgageRateHistory(BaseModel):
    id: int | None = None
    mortgage_id: int
    rate: float
    effective_date: date
    created_at: datetime | None = None


class PropertyValuation(BaseModel):
    id: int | None = None
    property_id: int
    valuation: Decimal
    valuation_date: date
    source: str = "manual"
    created_at: datetime | None = None


class EquitySnapshot(BaseModel):
    id: int | None = None
    property_id: int
    owner_id: int
    snapshot_date: date
    equity_amount: Decimal
    equity_percentage: float
    created_at: datetime | None = None


class PropertyTransfer(BaseModel):
    id: int | None = None
    from_property_id: int
    to_property_id: int
    owner_id: int
    amount: Decimal
    journal_entry_id: int
    transfer_date: date
    description: str | None = None
    created_at: datetime | None = None


class ExpenseAllocationRule(BaseModel):
    id: int | None = None
    property_id: int
    owner_id: int
    allocation_pct: float
    expense_type: str = "all"
    created_at: datetime | None = None


# --- AI entities ---


class AIConversation(BaseModel):
    id: int | None = None
    title: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AIMessage(BaseModel):
    id: int | None = None
    conversation_id: int
    role: MessageRole
    content: str
    created_at: datetime | None = None


# --- Transient models (not stored directly) ---


class RawTransaction(BaseModel):
    """A parsed but not yet imported transaction from CSV."""

    date: date
    description: str
    amount: Decimal
    reference: str | None = None
    fingerprint: str = ""
    is_duplicate: bool = False
    suggested_category_id: int | None = None


class ImportResult(BaseModel):
    """Result of an import operation."""

    batch_id: int
    imported_count: int = 0
    duplicate_count: int = 0
    total_count: int = 0


class AccountBalance(BaseModel):
    """Derived account balance from view."""

    account_id: int
    account_name: str
    account_type: AccountType
    balance: Decimal


class OwnerEquity(BaseModel):
    """Derived owner equity for a property."""

    property_id: int
    property_name: str
    owner_id: int
    owner_name: str
    capital_balance: Decimal
    equity_percentage: float = 0.0
    market_equity: Decimal = Field(default=Decimal("0"))
