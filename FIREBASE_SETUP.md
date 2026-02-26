# Firebase Authorization Error: `auth/unauthorized-domain`

This error happens because your app is running on a new domain (the AI Studio preview URL) that Firebase doesn't recognize yet.

## How to Fix

1.  **Copy your current domain**:
    *   Look at the error message in the app, or copy the domain from your browser's address bar (e.g., `ais-dev-xyz.run.app`).
    *   Do **not** include `https://` or trailing slashes. Just the domain (e.g., `ais-dev-huqszsrwyp5mvzxlmouezj-285677388652.asia-east1.run.app`).

2.  **Go to Firebase Console**:
    *   Open [https://console.firebase.google.com/](https://console.firebase.google.com/)
    *   Select your project: `atpukur-guys`

3.  **Add Authorized Domain**:
    *   Go to **Authentication** > **Settings** > **Authorized domains**.
    *   Click **Add domain**.
    *   Paste the domain you copied in Step 1.
    *   Click **Add**.

4.  **Retry Login**:
    *   Go back to the app and try logging in again. It should work immediately.
