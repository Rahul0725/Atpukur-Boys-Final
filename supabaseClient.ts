import { createClient } from '@supabase/supabase-js';

// Configuration for Project: rdwbzeepcsfhlaemvvfe
const SUPABASE_URL = 'https://rdwbzeepcsfhlaemvvfe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkd2J6ZWVwY3NmaGxhZW12dmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTU0NDMsImV4cCI6MjA4NjA5MTQ0M30.frVSkg3o9oFgfrFRrRM6QDfQBvqF-e3zow6QVifejmE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const checkSupabaseConfig = () => {
  return true;
};