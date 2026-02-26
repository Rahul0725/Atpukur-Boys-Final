# Supabase Google Authentication Setup

The error `Unsupported provider: provider is not enabled` means Google Authentication is not enabled in your Supabase project.

## How to Fix

1.  **Go to your Supabase Dashboard**
    *   Open your project: `rdwbzeepcsfhlaemvvfe` (or the one matching your URL)
    *   Navigate to **Authentication** > **Providers**.

2.  **Enable Google**
    *   Click on **Google**.
    *   Toggle **Enable Sign in with Google**.

3.  **Configure Client ID and Secret**
    *   You need a Google Cloud Project to get these.
    *   Go to [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project or select an existing one.
    *   Go to **APIs & Services** > **Credentials**.
    *   Create **OAuth Client ID**.
    *   Application Type: **Web application**.
    *   **Authorized JavaScript origins**: `https://rdwbzeepcsfhlaemvvfe.supabase.co` (Your Supabase URL)
    *   **Authorized redirect URIs**: `https://rdwbzeepcsfhlaemvvfe.supabase.co/auth/v1/callback`
    *   Copy the **Client ID** and **Client Secret** into the Supabase Google Provider settings.

4.  **Save**
    *   Click **Save** in Supabase.

Once enabled, the "Authenticate via Google" button in the app will work.

## Alternative
If you cannot set up Google Auth right now, you can use the "Anonymous Login" (if enabled) or implement Email/Password login.
