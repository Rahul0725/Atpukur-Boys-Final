# Firebase Auth Migration

You have switched to using **Firebase** for Google Authentication.

## REQUIRED: Database Update

Because Supabase Auth is no longer managing users, you must update your database schema to allow Firebase User IDs (which are strings) instead of Supabase UUIDs.

**Run this SQL in your Supabase SQL Editor:**

```sql
-- 1. Remove Foreign Key Constraints (that link to Supabase Auth)
alter table messages drop constraint if exists messages_sender_id_fkey;
alter table messages drop constraint if exists messages_receiver_id_fkey;
alter table users drop constraint if exists users_id_fkey;

-- 2. Change ID columns to TEXT (to support Firebase UIDs)
alter table users alter column id type text;
alter table messages alter column sender_id type text;
alter table messages alter column receiver_id type text;

-- 3. (Optional) Re-add Foreign Keys purely between public tables
-- This ensures messages still link to valid users in your public users table
alter table messages add constraint messages_sender_id_fkey foreign key (sender_id) references users(id) on delete cascade;
alter table messages add constraint messages_receiver_id_fkey foreign key (receiver_id) references users(id) on delete cascade;
```

## Why is this needed?
Supabase tables were originally set up to strictly reference `auth.users` (Supabase's internal auth table). Since Firebase users don't exist in that table, we need to relax these constraints and store the Firebase UID directly in your public `users` table.
