-- Allow text-only posts (making photo_path optional)
ALTER TABLE public.posts ALTER COLUMN photo_path DROP NOT NULL;

-- Enable Supabase Realtime for feed updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;