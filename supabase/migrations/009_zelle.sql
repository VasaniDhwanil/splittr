-- Splittr Migration 009: Zelle recipient + QR screenshot
--
-- Zelle has no deep link, so the app stores the recipient (normalized email
-- or +1 US phone) and, on profiles, an optional screenshot of the user's
-- "My Zelle QR code" from their bank app. Payers copy the recipient into
-- their bank app or scan the QR at the table.
--
-- The QR images live in a PRIVATE bucket with no storage policies: only the
-- API (service role) reads and writes it, and hands out short-lived signed
-- URLs on profile/bill GET.

ALTER TABLE bills ADD COLUMN IF NOT EXISTS zelle_handle TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zelle_handle TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zelle_qr_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('zelle-qr', 'zelle-qr', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
