/*
  # Enable Realtime for Alpha Scan Thoughts

  ## Purpose
  Enable Supabase Realtime subscriptions for the alpha_scan_thoughts table so users can see
  Alpha's thinking process stream in real-time as thoughts are emitted during scanning.

  ## Changes
  1. Add alpha_scan_thoughts table to supabase_realtime publication

  ## Impact
  - Frontend can now subscribe to INSERT events on alpha_scan_thoughts
  - Users will see live updates as Alpha analyzes markets and makes decisions
  - Critical for transparency in AI decision-making
*/

-- Enable realtime for alpha_scan_thoughts table
ALTER PUBLICATION supabase_realtime ADD TABLE alpha_scan_thoughts;
