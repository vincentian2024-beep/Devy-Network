# Lunaris Bridge for Lunaris Craft

Professional Discord wallet and Minecraft storefront branded:

- **Server:** Lunaris Craft
- **System:** Lunaris Bridge
- **Footer:** Powered by Devy Network

## Main features

- `?` prefix commands controlled by `index.js`
- Private wallet and store DMs
- Ephemeral button and menu responses visible only to the person who clicked
- Ranks and Keys categories only
- Persistent staff product management
- GCash top-up form with automated DM screenshot intake
- Automatic payment-review DM to user `806032916353515560` with screenshot proof
- GCash-style receipt embeds for approved, denied, and submitted payments
- Checkout asks for Java or Bedrock and the exact IGN before delivery
- Bedrock IGNs are normalized with a leading dot, for example `.Steve123`
- Purchase receipts are sent to the buyer and receipt user `806032916353515560`
- Confirm/Deny payment buttons
- Customer DM after payment confirmation or denial
- Idempotent wallet ledger that prevents duplicate credit
- Minecraft RCON and Discord-role delivery
- Professional embeds, audit logs, health endpoint, and Railway persistence

## Discord setup

1. Create the bot in Discord Developer Portal.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**.
3. Invite the bot with the `bot` scope.
4. Give it:
   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History
   - Manage Roles, if products deliver Discord roles
5. Put the bot role above every role it needs to assign.

## Railway setup

Connect this GitHub repository to a Railway service. Add a Railway Volume mounted at
`/data`, then configure:

```text
DISCORD_TOKEN=your_bot_token
BRIDGE_ADMIN_ROLE_ID=your_staff_role_id
BRIDGE_AUDIT_CHANNEL_ID=optional_audit_channel
BRIDGE_COLOR=7C3AED
BRIDGE_DATA_FILE=/data/bridge.json
BRIDGE_CATALOG_FILE=/data/catalog.json
PAYMENT_REVIEWER_ID=806032916353515560
PURCHASE_RECEIPT_USER_ID=806032916353515560
RECEIPT_TIME_ZONE=Asia/Manila
MINECRAFT_SERVER_ADDRESS=play.example.net
GCASH_RECEIVER_NUMBER=09XXXXXXXXX
PAYMENT_INSTRUCTIONS=Send the exact amount, then DM this bot your GCash screenshot receipt.
PAYMENT_WEBHOOK_SECRET=use-a-long-random-secret
RCON_HOST=your_minecraft_host
RCON_PORT=25575
RCON_PASSWORD=your_rcon_password
```

Do not create `PORT`; Railway supplies it automatically.

## Commands

Customer:

```text
?help
?wallet
?store
?profile
?orders
?payments
?link Java MinecraftUsername
?link Bedrock .BedrockName
```

Staff:

```text
?bridgepanel topup
?bridgepanel store
?products
?addproduct (name) (description) (Rank or Keys) (price)
?removeproduct (name or ID)
?approve LB-REFERENCE RECEIPT-ID
?credit @member 500 reason
?order LBO-ID
```

Examples:

```text
?addproduct (VIP Rank) (Permanent VIP access and perks) (Rank) (199)
?addproduct (Premium Key) (One premium crate key) (Keys) (49)
?removeproduct (VIP Rank)
```

New Rank products generate:

```text
lp user {minecraft} parent add <product-id>
```

New Keys products generate:

```text
crate key give {minecraft} <product-id> 1
```

Confirm that these commands match the plugins installed on the Minecraft server.

## Advanced top-up workflow

1. Customer clicks **Top up**.
2. Customer enters amount and GCash sender number.
3. The bot creates an `LB-...` reference.
4. Customer sends the GCash screenshot receipt to the bot in DM.
5. The bot finds the customer's open top-up, attaches the screenshot, and DMs reviewer `806032916353515560`.
6. Reviewer verifies the payment and clicks **Confirm Payment** or **Deny Payment**.
7. Confirm credits the wallet exactly once and DMs a receipt-style confirmation.
8. Deny leaves the wallet unchanged and DMs a receipt-style denial.

If a customer has multiple open top-ups, they should include the `LB-...` reference in the DM with the screenshot.
A Discord bot still cannot safely inspect a personal GCash account by itself; the automated part is intake,
matching, routing, receipts, and wallet crediting after reviewer confirmation.

## Advanced purchase workflow

1. Customer opens the store and selects an item.
2. The checkout asks whether the account is **Java** or **Bedrock**.
3. The checkout asks for the exact IGN. Bedrock names are automatically required to start with `.`.
4. The wallet is debited, Minecraft delivery runs, and a receipt is sent to the customer.
5. A copy of the purchase receipt is sent to `PURCHASE_RECEIPT_USER_ID`.

## Deployment files

Keep these in the GitHub repository root:

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

Railway installs from `package-lock.json`, runs `npm start`, and checks `GET /health`.
