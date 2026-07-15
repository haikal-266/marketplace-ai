-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "listed_price" TEXT,
    "location" TEXT,
    "seller" TEXT,
    "seller_url" TEXT,
    "condition" TEXT,
    "delivery" TEXT,
    "url" TEXT NOT NULL,
    "image_url" TEXT,
    "posted_at" TEXT,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actual_price_amount" INTEGER,
    "actual_price_raw" TEXT,
    "actual_price_source" TEXT,
    "is_price_fake" BOOLEAN NOT NULL DEFAULT false,
    "is_barter" BOOLEAN NOT NULL DEFAULT false,
    "is_trade_in" BOOLEAN NOT NULL DEFAULT false,
    "is_nett" BOOLEAN NOT NULL DEFAULT false,
    "detected_keywords" JSONB,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "normalized_title" TEXT,
    "normalized_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_terms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dictionary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_synonyms" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL,
    "category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'plain',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listings_url_key" ON "listings"("url");

-- CreateIndex
CREATE INDEX "listings_location_idx" ON "listings"("location");

-- CreateIndex
CREATE INDEX "listings_scraped_at_idx" ON "listings"("scraped_at");

-- CreateIndex
CREATE INDEX "listings_actual_price_amount_idx" ON "listings"("actual_price_amount");

-- CreateIndex
CREATE INDEX "listings_is_price_fake_idx" ON "listings"("is_price_fake");

-- CreateIndex
CREATE INDEX "listings_confidence_score_idx" ON "listings"("confidence_score");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_terms_term_key" ON "dictionary_terms"("term");

-- CreateIndex
CREATE INDEX "dictionary_terms_category_idx" ON "dictionary_terms"("category");

-- CreateIndex
CREATE INDEX "dictionary_terms_is_active_idx" ON "dictionary_terms"("is_active");

-- CreateIndex
CREATE INDEX "product_synonyms_canonical_name_idx" ON "product_synonyms"("canonical_name");

-- CreateIndex
CREATE INDEX "product_synonyms_category_idx" ON "product_synonyms"("category");

-- ─── Custom Full-Text Search and Trigram Indices ─────────────────────────────

-- Add search_vector tsvector column to listings table
ALTER TABLE "listings" ADD COLUMN "search_vector" tsvector;

-- Create FTS GIN index
CREATE INDEX "idx_listings_search_vector" ON "listings" USING GIN("search_vector");

-- Create Trigram GIN index for title and description
CREATE INDEX "idx_listings_title_trgm" ON "listings" USING GIN("normalized_title" gin_trgm_ops);
CREATE INDEX "idx_listings_description_trgm" ON "listings" USING GIN("normalized_description" gin_trgm_ops);

-- Create stored trigger function to auto-update search_vector
CREATE OR REPLACE FUNCTION listings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.normalized_title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.normalized_description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.location, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind trigger to listings table
CREATE TRIGGER listings_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listings_search_vector_update();
