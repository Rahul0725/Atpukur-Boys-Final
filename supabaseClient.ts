import { createClient } from '@supabase/supabase-js';

// Configuration for Project: rdwbzeepcsfhlaemvvfe
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rdwbzeepcsfhlaemvvfe.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkd2J6ZWVwY3NmaGxhZW12dmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTU0NDMsImV4cCI6MjA4NjA5MTQ0M30.frVSkg3o9oFgfrFRrRM6QDfQBvqF-e3zow6QVifejmE';

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
 *   id uuid references auth.users on delete cascade primary key,
 *   username text unique not null,
 *   full_name text,
 *   avatar_url text,
 *   role text default 'user',
 *   can_send boolean default true,
 *   is_online boolean default false,
 *   last_seen timestamptz default now(),
 *   created_at timestamptz default now()
 * );
 * 
 * -- 2.1 Trigger to create user on signup
 * create or replace function public.handle_new_user()
 * returns trigger as $$
 * begin
 *   insert into public.users (id, username, full_name, avatar_url)
 *   values (
 *     new.id,
 *     coalesce(new.raw_user_meta_data->>'user_name', split_part(new.email, '@', 1)),
 *     new.raw_user_meta_data->>'full_name',
 *     new.raw_user_meta_data->>'avatar_url'
 *   );
 *   return new;
 * end;
 * $$ language plpgsql security definer;
 * 
 * drop trigger if exists on_auth_user_created on auth.users;
 * create trigger on_auth_user_created
 *   after insert on auth.users
 *   for each row execute procedure public.handle_new_user();
 * 
 * -- 2.2 Update existing users table if it already exists
 * -- alter table users add column if not exists full_name text;
 * -- alter table users add column if not exists avatar_url text;
 * -- alter table users drop constraint if exists users_pkey cascade;
 * -- alter table users add primary key (id);
 * -- alter table users add constraint users_id_fkey foreign key (id) references auth.users(id) on delete cascade;
 * 
 * -- 2.3 FIREBASE MIGRATION (REQUIRED FOR FIREBASE AUTH)
 * -- If you are switching to Firebase Auth, you must remove the foreign key constraint to auth.users
 * -- and allow the ID column to accept Firebase UIDs (strings).
 * 
 * -- alter table messages drop constraint if exists messages_sender_id_fkey;
 * -- alter table messages drop constraint if exists messages_receiver_id_fkey;
 * -- alter table users drop constraint if exists users_id_fkey;
 * -- alter table users alter column id type text; 
 * -- alter table messages alter column sender_id type text;
 * -- alter table messages alter column receiver_id type text;
 * 
 * -- 3. Create Messages Table (WITH CASCADE DELETE FOR USER MANAGEMENT)
 * create table if not exists messages (
 *   id uuid default gen_random_uuid() primary key,
 *   created_at timestamptz default now(),
 *   sender_id uuid references users(id) on delete cascade,
 *   receiver_id uuid references users(id) on delete cascade,
 *   username text not null,
 *   message text not null
 * );
 * 
 * -- IF TABLE EXISTS BUT USER DELETION FAILS, RUN THIS:
 * -- alter table messages drop constraint if exists messages_sender_id_fkey;
 * -- alter table messages drop constraint if exists messages_receiver_id_fkey;
 * -- alter table messages add constraint messages_sender_id_fkey foreign key (sender_id) references users(id) on delete cascade;
 * -- alter table messages add constraint messages_receiver_id_fkey foreign key (receiver_id) references users(id) on delete cascade;
 * 
 * -- 4. Enable Row Level Security (Public Access for this Demo)
 * alter table users enable row level security;
 * alter table messages enable row level security;
 * 
 * create policy "Public users access" on users for all using (true);
 * create policy "Public messages access" on messages for all using (true);
 */