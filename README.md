# desserts_pos

A tablet-friendly checkout register for Dessert · Simply Sweet. React handles the register, Node.js and Express serve the API, and MySQL stores the menu, receipts and WhatsApp review queue.

## Start the register

You need Node.js 20.19 or newer, npm, and MySQL 8.4 or a running Docker engine with Compose.

```sh
cp .env.example .env
# Set unique DB_PASSWORD and POS_PASSWORD values in .env.
docker compose up -d --wait mysql
npm install
npm run build
npm start
```

Open **http://127.0.0.1:4173** and sign in with the cashier credentials from `.env`. If you already run MySQL, create a database and account, apply `db/schema.sql` to that database, and set the connection values in `.env`. Leave the WhatsApp fields empty until the sender is ready.

For a tablet, serve the Node app through an HTTPS reverse proxy with a certificate trusted by the tablet. Open that HTTPS address on the tablet. Keep the register behind staff authentication, keep MySQL on a private connection, and use HTTPS for any access beyond localhost.

## Counter workflow

Open **Products** to list, add or edit products and set the number of units available. Set stock to zero to prevent checkout or leave it blank to skip stock tracking. Existing products start untracked until a count is entered. Tracked stock is deducted when a sale is recorded.

Use **Product image** in the add or edit form to upload a JPEG, PNG, or WebP file up to 5 MB. Uploaded images are stored in `uploads/product-images/`. Include that directory when backing up the product database.

For an existing database whose `products` table has no `stock` column, apply `db/add-product-stock.sql` once before starting the updated server. For an existing database without barcode mapping, apply `db/schema.sql` first to create the missing table.

1. Open **Scan QR / barcode** and tap **Start camera**. Show each product code to the camera. A match adds one unit. Remove a code from view briefly before scanning that same item again. The drawer includes sample product QR codes. To test the camera, show a sample code on another screen.
2. A keyboard-mode scanner can fill the code field and submit it automatically when configured with an **Enter** suffix. Cashiers can also tap items or type a product code. Maintain product codes in the MySQL `products` table.
3. After taking payment at the counter, select the payment method and tap **Record payment & print**. The server calculates and commits the sale before the browser opens the print dialog. Card and UPI are recorded as payment methods after payment is taken separately.
4. In the print dialog select the thermal printer exposed by the tablet, operating system or vendor print service. Select the printer's roll size and turn off browser headers and footers. The default ticket is sized for an 80 mm roll. Use the **58 mm** checkbox for smaller printers. **Find receipt** lets staff reopen and reprint a completed bill. Direct or silent printing needs the printer model and a matching vendor SDK, kiosk print setup or print service.

## Connect WhatsApp reviews

1. In Meta WhatsApp Business, configure a sender and an approved template in the selected language. Use exactly one positional **body** parameter for the receipt number. For direct feedback, ask customers to reply in WhatsApp. Example template text for approval is “Thanks for visiting Dessert · Simply Sweet. How was your order? Reply here with your feedback about receipt {{1}}.”
2. Put your supported Graph API version, sender phone number ID, access token and template name into the corresponding `WA_*` entries in `.env`. Keep the access token on the server.
3. Restart Node. At checkout, record the customer's agreement and enter their WhatsApp number with the country code. The server creates the review job in the same MySQL transaction as the bill. A worker submits it to WhatsApp after the transaction commits.
4. Test with your own allowed test recipient. The receipt distinguishes queued, provider accepted, rejected and unknown. Provider acceptance does not confirm delivery. The queue leaves ambiguous submissions for manual review to avoid duplicate sends.

### Receive direct replies

For a local demo, set `WA_FEEDBACK_DEMO=true`, restart the app, then open **Feedback** and use **Simulate reply**. Demo entries appear only in demo mode. Set it to `false` before enabling a real sender and webhook.

1. For an existing database, apply `db/add-whatsapp-feedback.sql`. Set `WA_APP_SECRET` to the Meta app secret, `WA_WEBHOOK_VERIFY_TOKEN` to a random secret you generate, and `WA_PHONE_NUMBER_ID` to the sender's phone number ID. Restart Node.
2. Expose `/webhooks/whatsapp` through a public HTTPS callback to the Node server. Configure your reverse proxy to forward the webhook's query string, raw request body, and signature header. The POS routes can stay on a private network.
3. In Meta, configure the WhatsApp webhook callback URL with the same verification token and subscribe the app to the business account's `messages` events.
4. Send a test text to the configured number and open **Feedback** in the POS. The inbox displays incoming text messages for that number. A reply quoting the original template can display the associated receipt when its message ID matches the recorded send.

[Meta WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) · [ZXing browser decoder](https://github.com/zxing-js/browser)

## Verify

Run `npm test` for billing and WhatsApp queue logic. With a test database, complete a sale and look it up by receipt number. On the target tablet, scan a sample product, verify the quantity and total, then check the receipt on the intended thermal printer. Use a Meta test recipient to verify message delivery before enabling live review requests.
