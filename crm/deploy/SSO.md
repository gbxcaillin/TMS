# Turning on Sign in with Microsoft (step by step)

The Integrations page shows **Microsoft sign-in: not configured** until the two `SSO_` variables are set on the VPS.
The CRM reuses the same Entra app registration that already connects mailboxes and SharePoint, so the only Azure
change is one extra redirect URI. Allow 15 minutes.

## Part A: Azure (in a browser, on any computer)

1. Go to **https://entra.microsoft.com** and sign in with your BD admin account (the one that set up Microsoft 365).
2. In the left menu click **Identity**, then **Applications**, then **App registrations**. If the menu is collapsed,
   click the three-line button at the top left first.
3. Click the **All applications** tab. Find the app the CRM uses. Its **Application (client) ID** column matches the
   `MS_CLIENT_ID` value in `/root/crm/.env.production` on the VPS (Part B, step 2 shows you that value). Click the app's name.
4. On the app's **Overview** page, note the **Application (client) ID** and the **Directory (tenant) ID**. Each has a copy
   icon to its right.
5. In the app's left menu, under **Manage**, click **Authentication**.
6. Under **Platform configurations**:
   - If a **Web** section is already there (it will list `https://portal.brightday.com.au/api/v1/mail/connect/callback`), click
     **Add URI** inside that section.
   - If there is no Web section, click **Add a platform**, choose **Web**.
7. In the new redirect URI box type exactly:
   ```
   https://portal.brightday.com.au/api/v1/auth/microsoft/callback
   ```
   Leave **Front-channel logout URL** empty and leave both **Implicit grant** boxes unticked.
8. Click **Configure** (new platform) or **Save** (existing platform) at the bottom. The Web section should now list
   both callback URIs.
9. Client secret. Under **Manage** click **Certificates & secrets**, then the **Client secrets** tab.
   - If you still have the secret's value (it is the `MS_CLIENT_SECRET` line in the env file), you can reuse it and skip
     to Part B.
   - Otherwise click **New client secret**. Description: `CRM sign-in`. Expires: **24 months**. Click **Add**.
     Copy the **Value** column straight away using its copy icon (it is hidden after you leave the page). Do not copy
     the Secret ID. Put the expiry date in your calendar.
10. Optional check. Under **Manage** click **API permissions**. You should see Microsoft Graph delegated permissions
    including `User.Read` (or `openid`, `profile`, `email`) alongside the mail ones. If any row's **Status** is blank,
    click **Grant admin consent for BD** and confirm **Yes**.

## Part B: the VPS (terminal)

1. Open a terminal and connect:
   ```
   ssh root@103.249.237.175
   ```
2. See what is set today:
   ```
   grep -n "MS_CLIENT_ID\|MS_CLIENT_SECRET\|MS_TENANT_ID\|SSO_" /root/crm/.env.production
   ```
   `MS_CLIENT_ID` is the app from Part A step 3. `SSO_CLIENT_ID` and `SSO_CLIENT_SECRET` will be empty.
3. Edit the file:
   ```
   nano /root/crm/.env.production
   ```
   Use the arrow keys to reach the `SSO_CLIENT_ID=` line and paste the Application (client) ID after the `=`, with no
   spaces or quotes. On the `SSO_CLIENT_SECRET=` line paste the secret value. Leave `SSO_TENANT=` empty (the CRM
   uses `MS_TENANT_ID`). Leave `SSO_AUTO_PROVISION=` empty unless you want anyone in the tenant to get an account on the default access level
   automatically on first sign-in, in which case set it to `1` and make sure `SSO_DOMAIN=brightday.com.au`.
   Save with **Ctrl+O**, **Enter**, then exit with **Ctrl+X**.
4. Restart the CRM so it reads the new variables:
   ```
   cd /root/familyoffice && docker compose up -d crm && docker compose logs --tail=20 crm
   ```
   The last lines should include `[boot] Brightday Portal on :3000`.

## Part C: check it

1. In the CRM open **Integrations**. The server card should now read **Microsoft sign-in: connected**, and the
   Microsoft 365 card's Sign-in row says single sign-on is on.
2. Sign out (bottom of the rail, or More then Sign out on a phone). The login page now shows **Sign in with Microsoft**.
3. Click it. Microsoft shows the tenant sign-in, applies your MFA and conditional access policies, and returns you to the
   dashboard. The first person to sign in may see a consent screen listing `openid`, `profile` and `email`; an admin
   accepts it once for the whole tenant.
4. Each person's CRM account email must match their Microsoft email. If it does not, the login page shows
   **No Pipeline account for name@brightday.com.au. Ask an admin to invite you.** Fix it under Settings, Team by inviting
   them with the matching address, or turn on auto-provisioning in Part B step 3.

## If something fails

| What you see | Cause | Fix |
| --- | --- | --- |
| Microsoft error `AADSTS50011` (reply URL does not match) | The redirect URI in Part A step 7 is not exactly right | Re-check spelling, `https`, no trailing slash |
| Login page: `Microsoft sign-in failed: ... AADSTS7000215` (invalid client secret) | The Secret ID was pasted instead of the Value, or the secret expired | Make a new secret (Part A step 9) and paste its Value |
| Login page: `Microsoft sign-in failed: Wrong tenant` | `MS_TENANT_ID` (or `SSO_TENANT`) does not match the Directory (tenant) ID | Compare with Part A step 4 |
| Chip still says not configured after restart | The env file was not saved, or the container was not recreated | Repeat Part B steps 3 and 4; `docker compose exec crm env \| grep SSO_` should show both values |
| Password login disappears | `security.passwordLogin` was switched off under Settings, Security | Turn it back on, or use Microsoft sign-in |
