import { createClient } from '@supabase/supabase-js';

// Configuration for Project: rdwbzeepcsfhlaemvvfe
const SUPABASE_URL = 'https://rdwbzeepcsfhlaemvvfe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkd2J6ZWVwY3NmaGxhZW12dmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTU0NDMsImV4cCI6MjA4NjA5MTQ0M30.frVSkg3o9oFgfrFRrRM6QDfQBvqF-e3zow6QVifejmE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const checkSupabaseConfig = () => {
  return true;
};

/**
 * REQUIRED SQL SETUP FOR APP FUNCTIONALITY
 * Run this in your Supabase SQL Editor to ensure all features work.
 * 
 * -- 1. Enable Realtime for tables
 * begin;
 *   drop publication if exists supabase_realtime;
 *   create publication supabase_realtime;
 * commit;
 * alter publication supabase_realtime add table messages;
 * alter publication supabase_realtime add table users;
 * 
 * -- 2. Create Users Table
 * create table if not exists users (
 *   id uuid default gen_random_uuid() primary key,
 *   username text unique not null,
 *   role text default 'user',
 *   can_send boolean default true,
 *   is_online boolean default false,
 *   last_seen timestamptz default now(),
 *   created_at timestamptz default now()
 * );
 * 
 * -- 3. Create Messages Table
 * create table if not exists messages (
 *   id uuid default gen_random_uuid() primary key,
 *   created_at timestamptz default now(),
 *   sender_id uuid references users(id),
 *   receiver_id uuid references users(id), -- null for group/global
 *   username text not null,
 *   message text not null
 * );
 * 
 * -- 4. Enable Row Level Security (Public Access for this Demo)
 * alter table users enable row level security;
 * alter table messages enable row level security;
 * 
 * create policy "Public users access" on users for all using (true);
 * create policy "Public messages access" on messages for all using (true);
 */