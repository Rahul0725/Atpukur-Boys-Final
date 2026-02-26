# Missing Columns Error

The error `Could not find the 'avatar_url' column` means your database table `users` is missing some required columns.

## How to Fix

Run this SQL in your Supabase SQL Editor:

```sql
-- Add missing columns for user profiles
alter table users add column if not exists avatar_url text;
alter table users add column if not exists full_name text;

-- Ensure the ID column is text (for Firebase UIDs)
alter table users alter column id type text;
```

After running this, try logging in again.
