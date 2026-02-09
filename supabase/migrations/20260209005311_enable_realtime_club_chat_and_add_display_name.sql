/*
  # Enable Realtime for Club Chat and Add Display Name

  1. Changes
    - Enable realtime publication for `club_chat_messages` table
    - Add `display_name` column to `club_chat_messages` for denormalized author display
    - Add index on `created_at` for efficient message pagination

  2. Security
    - No RLS changes (policies already exist)

  3. Notes
    - Realtime enables Supabase subscription for live chat updates
    - display_name is denormalized at write time to avoid JOINs on read
*/

ALTER PUBLICATION supabase_realtime ADD TABLE club_chat_messages;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_chat_messages' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE club_chat_messages ADD COLUMN display_name text DEFAULT '';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_club_chat_messages_created_at
  ON club_chat_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_club_chat_reactions_message_id
  ON club_chat_reactions (message_id);
