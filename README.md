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
- **Store modes** (Open/Maintenance/Closed) with automatic panel updates
- **Purchase confirmation flow** with duplicate prevention
- **Delivery queue** with automatic retry for offline players
- **Extended receipts** sent to both customer and staff
- **Product editing** (price, stock, enabled status, delivery commands)
- **Comprehensive audit logging** of all store operations
- **Analytics dashboard** with top products and revenue metrics
- **Rate limiting** to prevent spam and abuse
- **Input validation & sanitization** for all user inputs
- **Performance caching** for frequently accessed data
- **Refund system** with full audit trail

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

### Customer Commands

```text
?help               - View all available commands
?wallet             - View your private wallet balance and transactions
?store              - Open the private store panel
?profile            - View your linked Minecraft account and wallet details
?orders             - Show your recent orders
?payments           - Show your recent top-ups and payment history
?link Java <IGN>    - Link your Java Edition Minecraft account
?link Bedrock <IGN> - Link your Bedrock Edition account (name must start with .)
```

### Staff Management Commands

#### Panels & Display

```text
?bridgepanel topup      - Post the top-up panel to the current channel
?bridgepanel store      - Post the store panel to the current channel
?linkpanel              - Post the account linking panel to the current channel
?paneledit <panel> (title) (description)
                        - Edit the title and description of topup/store/link panels
?paneledit reset <panel>
                        - Reset a panel to its default text
?refresh_panels         - Manually refresh all posted panels (runs automatically)
```

#### Product Management

```text
?products                                    - List all configured products
?addproduct (name) (description) (type) (price)
                                             - Create a new product
                                             - Type must be "Rank" or "Keys"
                                             - Price is in PHP (e.g., 199)
?removeproduct <name or ID>                  - Remove a product from the store
?editproduct <id> <field> <value>            - Edit product details
                                             - Fields: price, stock, enabled, command
?storemode <open|maintenance|closed>         - Change store availability
                                             - open: Store accepting purchases
                                             - maintenance: Store locked (displays status)
                                             - closed: Store hidden entirely
```

#### Payment & Wallet Management

```text
?approve <LB-REFERENCE>    - Approve a top-up request and credit the wallet
?credit @member <amount> <reason>
                           - Manually add funds to a member's wallet
?refund <LBO-ID> [reason]  - Refund a completed order and credit the customer
```

#### Monitoring & Support

```text
?order <LBO-ID>        - View details of a specific order (reference or ID)
?stats                 - View analytics dashboard (top products, revenue, user count)
?help                  - Show this help message
?testexpire            - Test the expiry notification system
```

### Examples

Creating products:

```text
?addproduct (VIP Rank) (Permanent VIP access and perks) (Rank) (199)
?addproduct (Premium Key) (One premium crate key) (Keys) (49)
?removeproduct (VIP Rank)
?editproduct vip-rank price 249
?editproduct premium-key enabled false
```

Managing the store:

```text
?storemode maintenance    - Pause purchases for announcements
?storemode open           - Resume normal operation
?storemode closed         - Hide the store completely
?paneledit store (🎮 Lunaris Store - LIVE) (Purchase ranks and keys for amazing perks!)
?refresh_panels           - Update all posted panels immediately
```

Managing payments:

```text
?approve LB-A1B2C3D4       - Credit a customer after reviewing their screenshot
?credit @PlayerName 500 "Rank refund for disconnect"
?refund LBO-ORDER-ID "Player requested cancellation"
?stats                     - Check today's revenue and top products
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

## Advanced Features

### Store Modes

The store can operate in three modes:

- **Open** (🟢): Customers can purchase products normally
- **Maintenance** (🟠): Customers cannot purchase; panel shows maintenance message
- **Closed** (🔴): Store panel is completely hidden

Use `?storemode <status>` to change modes. All panels update automatically.

### Purchase Confirmation Flow

1. Customer selects a product from the store
2. Checkout flow asks for Java or Bedrock edition
3. Checkout asks for the exact Minecraft IGN
4. **Confirmation buttons appear**: Confirm or Cancel
5. If Confirm: Order is created, payment processed, delivery queued
6. If Cancel: Order is discarded, no payment taken
7. Duplicate prevention prevents accidental double-purchases

### Delivery Queue System

When a customer purchases an item:

1. Order is created with status `queued`
2. Background processor checks player status every 60 seconds
3. If player is **online**: Delivery commands execute via RCON
4. If player is **offline**: Order waits until player returns (up to 50+ hours)
5. Once delivered: Order marked `completed`, receipts sent to customer and staff
6. If player never returns: Order moves to `manual_review` for staff assistance

This ensures rank and key purchases arrive even if the player was briefly offline.

### Receipt System

Purchase receipts are automatically sent to:

- **Customer**: Personal DM with order details and confirmation
- **Staff**: User configured in `PURCHASE_RECEIPT_USER_ID` for accounting

Each receipt includes:
- Order ID and timestamp
- Product name and price
- Minecraft account (Java or Bedrock)
- Delivery method (RCON command or Discord role)
- Current wallet balance

### Input Validation & Sanitization

- Product names limited to 80 characters
- Descriptions limited to 300 characters
- All user input is trimmed and sanitized
- Newlines and special characters are escaped
- Amount validation ensures positive values
- Minecraft names validated for proper format

### Rate Limiting

To prevent spam and abuse:

- Store browsing limited to 5 actions per 3 seconds per user
- Exceeding limits shows a polite rate limit message
- Prevents accidental double-clicks from causing issues

### Analytics Dashboard

`?stats` shows comprehensive metrics:

- **Orders**: Completed, queued, failed, refunded counts
- **Revenue**: Total earned and average per order
- **Users**: Unique buyers and total ledger transactions
- **Top 5 Products**: Best sellers with unit count and revenue

Use this to track business performance and identify popular items.

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
4. **Confirmation buttons appear** for final approval.
5. The wallet is debited, Minecraft delivery runs, and a receipt is sent to the customer.
6. A copy of the purchase receipt is sent to `PURCHASE_RECEIPT_USER_ID`.
7. If the player is offline, the order enters the **delivery queue** and retries every 60 seconds.
8. Once the player returns online, the delivery completes automatically.

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
test.js
```

Railway installs from `package-lock.json`, runs `npm start`, and checks `GET /health`.

## System Architecture

The system is built on:

- **Node.js + Discord.js v14**: Real-time bot interactions and messaging
- **RCON Client**: Direct Minecraft server integration for automatic delivery
- **JSON-based Persistence**: Bridge data and catalog stored in mounted volume at `/data/`
- **Transaction Queue**: Promise-based locking prevents race conditions during concurrent orders
- **Background Processor**: Delivery queue runs every 60 seconds for offline player detection
- **Audit Logging**: All staff actions logged to a designated audit channel
- **Rate Limiting**: Anti-spam protection built into frequently-used commands
- **Performance Caching**: Frequently accessed data (catalog, store settings) cached for 5 seconds

## Troubleshooting

**Players not receiving rank/key**:
- Check that the Minecraft RCON credentials are correct in `.env`
- Verify the delivery commands match your server plugins (e.g., LuckPerms syntax)
- Check player is online when delivery queue processes (every 60 seconds)
- View order details with `?order LBO-ID` to see delivery status

**Top-up payments not crediting**:
- Ensure the payment reviewer has permission to receive DMs
- Verify `PAYMENT_REVIEWER_ID` and `PURCHASE_RECEIPT_USER_ID` are correct Discord user IDs
- Check the audit channel for error logs using `?help` for channel guidance

**Store not updating**:
- Use `?storemode open` to ensure store is active
- Use `?refresh_panels` to manually update all posted panels
- Verify panels are posted in channels the bot can access

**Orders stuck in queue**:
- Check that the Minecraft player name is spelled correctly (case-sensitive)
- Verify RCON connection is stable
- Orders automatically move to `manual_review` after 50+ failed attempts

## Support

For issues or feature requests, refer to staff commands `?stats`, `?order`, and audit logs.
