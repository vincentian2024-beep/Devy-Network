# Lunaris Bridge

Standalone Discord wallet and Minecraft storefront for Devy Network.

Customer-facing messages are branded **Lunaris Bridge** and **Powered by Lunaris**.

## Included systems

- Private Discord wallet and recent transaction history
- GCash top-up forms with unique `LB-...` references
- Staff payment approval and emergency/manual credits
- Category and product menus
- Minecraft username linking
- Minecraft RCON command delivery
- Discord role delivery
- Duplicate-credit protection
- Order records and automatic pre-delivery refunds
- Manual-review state for uncertain external delivery results
- Staff audit-channel notifications
- Signed payment webhook for an authorized provider
- Railway `/health` endpoint
- Railway Volume persistence

## Files in GitHub

Keep all of these files in the repository root:

```text
.env.example
.gitignore
bridge-data.example.json
bridge.js
catalog.json
index.js
package-lock.json
package.json
railway.json
README.md
```

Do not upload `.env`, `node_modules`, or a live wallet database.

## Discord bot setup

1. Create an application at the Discord Developer Portal.
2. Open **Bot**, create the bot, and copy its token.
3. Enable **Message Content Intent** under **Bot → Privileged Gateway Intents**.
4. Invite it with the `bot` scope.
5. Give it:
   - View Channels
   - Send Messages
   - Embed Links
   - Manage Roles, only if products deliver Discord roles
6. Put the bot role above every product role it must assign.

## Railway setup

1. Connect this GitHub repository to a new Railway service.
2. Add the variables below under **Variables**.
3. Add a Railway Volume mounted at `/data`.
4. Keep `BRIDGE_DATA_FILE=/data/bridge.json`.
5. Generate a public domain under **Settings → Networking**.
6. Deploy.

Railway uses `railway.json`, installs from `package-lock.json`, runs `npm start`, and
checks `GET /health`.

## Required Railway variables

```text
DISCORD_TOKEN=your_bot_token
BRIDGE_ADMIN_ROLE_ID=your_staff_role_id
GCASH_RECEIVER_NUMBER=09XXXXXXXXX
PAYMENT_WEBHOOK_SECRET=a-long-random-secret
BRIDGE_DATA_FILE=/data/bridge.json
```

Optional variables:

```text
BRIDGE_AUDIT_CHANNEL_ID=
BRIDGE_COLOR=7C3AED
MINECRAFT_SERVER_ADDRESS=play.example.net
PAYMENT_INSTRUCTIONS=Send the exact amount and keep your receipt.
RCON_HOST=
RCON_PORT=25575
RCON_PASSWORD=
```

Do not create a `PORT` variable. Railway provides it.

## Commands

All commands use the `?` prefix.

Customers:

```text
?help
?wallet
?store
?link MinecraftUsername
```

Staff:

```text
?bridgepanel topup
?bridgepanel store
?approve LB-1234ABCD RECEIPT-ID
?credit @member 500 reason
```

## Products

Edit `catalog.json` in GitHub. Prices are integer centavos:

```text
4900 = ₱49.00
19900 = ₱199.00
```

Minecraft delivery:

```json
{
  "type": "minecraft_command",
  "command": "lp user {minecraft} parent add vip"
}
```

Discord role delivery:

```json
{
  "type": "discord_role",
  "roleId": "123456789012345678"
}
```

The bot validates the catalog during startup and reports configuration errors in Railway
logs.

## Minecraft RCON

Enable RCON in `server.properties`:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=use-a-long-random-password
```

Set `RCON_HOST`, `RCON_PORT`, and `RCON_PASSWORD` in Railway. Restrict RCON network
access to the bridge service. Never expose RCON publicly without firewall restrictions.

## GCash limitation

A Discord bot cannot safely inspect a personal GCash account. Until you have an
authorized merchant/payment-provider integration, staff must verify the receipt and use
`?approve`.

The automatic endpoint is:

```text
POST /webhooks/payments
X-Lunaris-Signature: sha256=<HMAC-SHA256 of the raw body>
```

Example body:

```json
{
  "event": "payment.completed",
  "paymentReference": "LB-1234ABCD",
  "providerReference": "provider-event-123",
  "amountCentavos": 50000
}
```

Never store GCash passwords, PINs, or OTPs in GitHub or Railway.
