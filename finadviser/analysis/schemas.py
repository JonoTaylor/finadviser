"""Pydantic response models for structured AI outputs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CategoryBreakdown(BaseModel):
    category: str
    amount: float
    percentage: float
    trend: str = ""  # "up", "down", "stable"


class SpendingAnalysis(BaseModel):
    """Structured spending analysis response."""

    period: str
    total_spending: float
    total_income: float
    savings_rate: float
    categories: list[CategoryBreakdown] = Field(default_factory=list)
    top_increases: list[str] = Field(default_factory=list)
    savings_opportunities: list[str] = Field(default_factory=list)
    unusual_expenses: list[str] = Field(default_factory=list)
    summary: str = ""


class BudgetRecommendation(BaseModel):
    category: str
    current_spending: float
    recommended_budget: float
    classification: str = ""  # "need", "want", "savings"


class BudgetAnalysis(BaseModel):
    """Structured budget recommendation response."""

    monthly_income: float
    needs_pct: float = 0
    wants_pct: float = 0
    savings_pct: float = 0
    recommendations: list[BudgetRecommendation] = Field(default_factory=list)
    savings_tips: list[str] = Field(default_factory=list)
    summary: str = ""


class OwnerEquityDetail(BaseModel):
    owner_name: str
    capital_contributions: float
    equity_percentage: float
    market_equity: float


class PropertyEquityReport(BaseModel):
    """Structured property equity report response."""

    property_name: str
    current_valuation: float
    mortgage_balance: float
    total_equity: float
    owners: list[OwnerEquityDetail] = Field(default_factory=list)
    equity_change_summary: str = ""
    mortgage_progress_pct: float = 0
    summary: str = ""


class ChatResponse(BaseModel):
    """Generic chat response."""

    message: str
    follow_up_suggestions: list[str] = Field(default_factory=list)


class BatchCategorizationResult(BaseModel):
    """Result of batch AI categorization."""

    categorized: dict[str, str] = Field(default_factory=dict)
    uncategorized: list[str] = Field(default_factory=list)
    confidence_notes: str = ""
