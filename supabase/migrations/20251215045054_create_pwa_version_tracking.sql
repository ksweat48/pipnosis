/*
  # PWA Version Tracking System

  1. New Tables
    - `app_versions`
      - `id` (uuid, primary key)
      - `version` (text, unique) - Semantic version string (e.g., "2.5.3")
      - `build_time` (timestamptz) - When this version was built
      - `is_active` (boolean) - Whether this is the current active version
      - `release_notes` (text, optional) - Human-readable notes about this release
      - `created_at` (timestamptz) - When version record was created

  2. Security
    - Enable RLS on `app_versions` table
    - Add policy for authenticated users to read versions (needed for update checks)
    - Only service role can write (handled via Netlify functions)

  3. Performance
    - Index on is_active and created_at for fast version lookups
*/

-- Create app versions table
CREATE TABLE IF NOT EXISTS app_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  build_time TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  release_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read versions (needed for update checks)
CREATE POLICY "Authenticated users can read app versions"
  ON app_versions FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert/update versions
CREATE POLICY "Service role can manage versions"
  ON app_versions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for fast version lookups
CREATE INDEX IF NOT EXISTS idx_app_versions_active 
  ON app_versions(is_active, created_at DESC);

-- Insert initial version
INSERT INTO app_versions (version, build_time, is_active, release_notes)
VALUES ('1.0.0', now(), true, 'Initial PWA version tracking')
ON CONFLICT (version) DO NOTHING;