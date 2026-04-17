CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('contains', 'startswith', 'exact', 'regex');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('user', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."savings_goal_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tip_type" AS ENUM('tip', 'warning', 'insight');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"parent_id" integer,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tips" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"tip_type" "tip_type" DEFAULT 'tip' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "book_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"journal_entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"monthly_limit" text NOT NULL,
	"effective_from" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_category_id_unique" UNIQUE("category_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_parent_id_key" UNIQUE("name","parent_id")
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"category_id" integer NOT NULL,
	"match_type" "match_type" DEFAULT 'contains' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" "rule_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"snapshot_date" text NOT NULL,
	"equity_amount" numeric(14, 2) NOT NULL,
	"equity_percentage" numeric(8, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_allocation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"allocation_pct" numeric(8, 4) NOT NULL,
	"expense_type" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_property_owner_type_key" UNIQUE("property_id","owner_id","expense_type")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"bank_config" text NOT NULL,
	"account_id" integer NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"category_id" integer,
	"import_batch_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortgage_rate_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"mortgage_id" integer NOT NULL,
	"rate" numeric(6, 4) NOT NULL,
	"effective_date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortgages" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"lender" text NOT NULL,
	"original_amount" numeric(14, 2) NOT NULL,
	"start_date" text NOT NULL,
	"term_months" integer NOT NULL,
	"liability_account_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "owners_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"purchase_date" text,
	"purchase_price" numeric(14, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "properties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "property_ownership" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"capital_account_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_property_owner_key" UNIQUE("property_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "property_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_property_id" integer NOT NULL,
	"to_property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"journal_entry_id" integer NOT NULL,
	"transfer_date" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_valuations" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"valuation" numeric(14, 2) NOT NULL,
	"valuation_date" text NOT NULL,
	"source" text DEFAULT 'manual',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_amount" text NOT NULL,
	"current_amount" text DEFAULT '0' NOT NULL,
	"target_date" text,
	"account_id" integer,
	"status" "savings_goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_fingerprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"account_id" integer NOT NULL,
	"journal_entry_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fingerprints_fp_account_key" UNIQUE("fingerprint","account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocation_rules" ADD CONSTRAINT "expense_allocation_rules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_allocation_rules" ADD CONSTRAINT "expense_allocation_rules_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_rate_history" ADD CONSTRAINT "mortgage_rate_history_mortgage_id_mortgages_id_fk" FOREIGN KEY ("mortgage_id") REFERENCES "public"."mortgages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgages" ADD CONSTRAINT "mortgages_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgages" ADD CONSTRAINT "mortgages_liability_account_id_accounts_id_fk" FOREIGN KEY ("liability_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership" ADD CONSTRAINT "property_ownership_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership" ADD CONSTRAINT "property_ownership_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership" ADD CONSTRAINT "property_ownership_capital_account_id_accounts_id_fk" FOREIGN KEY ("capital_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_transfers" ADD CONSTRAINT "property_transfers_from_property_id_properties_id_fk" FOREIGN KEY ("from_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_transfers" ADD CONSTRAINT "property_transfers_to_property_id_properties_id_fk" FOREIGN KEY ("to_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_transfers" ADD CONSTRAINT "property_transfers_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_transfers" ADD CONSTRAINT "property_transfers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_valuations" ADD CONSTRAINT "property_valuations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fingerprints" ADD CONSTRAINT "transaction_fingerprints_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fingerprints" ADD CONSTRAINT "transaction_fingerprints_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;