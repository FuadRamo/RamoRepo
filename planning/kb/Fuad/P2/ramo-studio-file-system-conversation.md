# Ramo Studio — Design File Auto-Retrieval System (Conversation Log)

---

## Prompt 1

okay so me and my team want to make a program for our printing company. the company is called ramo studio, its a print company that makes custom prints on shirts, paper, and other items. they have online stores on shoppe, Lazada, and wahatsapp. in these platofmrs the client has to send them the design (a file) and the customer service needs to find that file, download it, and save it. the problem is that it takes a lot of time to search for the file. what they want us to do is a system that searches through the chats of these files to find the client's design and download it in the corresponding folders. i want you to give me the steps needed to solve this issue so i can make a flowchart.

### Reply 1

Here's a logical breakdown you can turn into a flowchart, organized by phase:

**Phase 1: Connect to Each Platform**
- **Shopee**: Register for Shopee Open Platform, get API credentials, use their Chat API to pull messages/attachments tied to each order.
- **Lazada**: Register for Lazada Open Platform, similar OAuth + Chat API access (note: Lazada's chat API access is more limited than Shopee's, worth checking current docs).
- **WhatsApp**: Big fork here — if they're using regular WhatsApp (the app), there's no official way to automate it; you'd need an unofficial library (e.g., whatsapp-web.js) which risks account bans. If they're open to switching to WhatsApp Business API (Cloud API via Meta), that's the sanctioned route and supports webhooks for incoming media.

**Flowchart decision point**: "Which platform is this order/chat from?" → branches into 3 paths that reconverge later.

**Phase 2: Monitor for New Messages**
- Poll each platform's API on a schedule (or use webhooks where supported — WhatsApp Business API and Shopee support webhooks; confirm Lazada's capability) to catch new incoming messages in near real-time rather than searching after the fact.

**Phase 3: Detect the Design File in the Chat**
- Filter incoming messages for attachment/media type (image, PDF, AI/PSD file, etc.).
- Since a chat may contain multiple files (revisions, reference images, the final file), you need logic to decide *which* file is the actual design to use:
  - Look for the most recent attachment before an order/payment confirmation, or
  - Flag all attachments and let customer service confirm the correct one in a simple UI, or
  - Look for a keyword/caption near the file (e.g., "final", "this one po") as a signal.

**Flowchart decision point**: "Is there an attachment in this message?" → if yes, "Is it a supported file type?" → if yes, proceed; if no, skip/log.

**Phase 4: Match File to Customer/Order**
- Extract order ID or customer identifier from the chat/order metadata (Shopee and Lazada tie chats to order IDs; WhatsApp won't have this natively, so you'd need to match by phone number or ask the customer for an order/reference number).
- This step is critical — without it you just have a pile of files, not files linked to the right customer.

**Phase 5: Download and Save**
- Download the file via API.
- Auto-generate a folder path/name, e.g. `/Orders/{Platform}/{OrderID}_{CustomerName}/design_file.ext`
- Save file, log metadata (order ID, platform, date, filename) into a database or spreadsheet for tracking.

**Phase 6: Notify / Confirm**
- Notify customer service that a file was found and saved (dashboard, Slack/email alert, or a simple internal notification).
- Optionally include a manual review step where staff confirms the correct file was grabbed, especially for ambiguous cases (Phase 3).

**Phase 7: Handle Exceptions**
- No attachment found in chat → flag for manual follow-up with customer.
- Multiple candidate files → route to manual selection queue.
- API/auth failure → log error, retry, alert admin.

*(At this point I asked two clarifying questions: whether they're open to switching WhatsApp to the Business API, and how the system should pick the correct file when there are multiple attachments.)*

---

## Prompt 2

*(Answered via quick-select options)*

- Q: For WhatsApp, are you open to switching to the official WhatsApp Business API, or does it need to work with the regular WhatsApp app you're already using?
  **A: Open to switching to Business API**
- Q: How should the system decide which file in a chat is the final design if there are multiple attachments?
  **A: Always let staff confirm manually**

### Reply 2

Good — both of those choices simplify your flowchart a lot. Here's the refined version with your decisions baked in:

**Phase 1: Connect to Each Platform**
- **Shopee**: Register on Shopee Open Platform → OAuth → use Chat API to pull messages/attachments per order.
- **Lazada**: Register on Lazada Open Platform → OAuth → pull chat/attachments (worth double-checking current API scope/limits when you build this, since Lazada's chat API has historically been more restricted than Shopee's).
- **WhatsApp Business API (Cloud API)**: Set up a Meta Business account, verify the business number, configure webhooks. This gets you officially supported, real-time incoming message + media events — no ban risk like the unofficial route.

**Flowchart node**: "Which platform is this message from?" → 3 branches, reconverging at Phase 3.

**Phase 2: Monitor for New Messages**
- Shopee, Lazada, and WhatsApp Business API all support webhooks — set each up to push new messages to your system in real time instead of polling.

**Phase 3: Detect Attachments**
- Filter each incoming message for attachment type (image, PDF, PSD/AI file, etc.).
- **Decision node**: "Does message contain a file?" → No: ignore/log → Yes: continue.

**Phase 4: Match File to Customer/Order**
- Shopee & Lazada: order ID comes with the chat/order metadata automatically.
- WhatsApp: no native order ID, so match by phone number against your customer/order database, or prompt for an order reference if unmatched.
- **Decision node**: "Order/customer match found?" → No: flag for manual matching → Yes: continue.

**Phase 5: Queue for Staff Confirmation**
Since you're going with manual confirmation rather than auto-detection:
- All detected attachments for an order get pulled into a review queue (simple dashboard: shows order ID, customer, platform, thumbnail/preview of each attachment found in that chat).
- Staff clicks the correct file → system downloads and saves it.
- If there's only one attachment, this step can just be a one-click "confirm" instead of a "choose" — still keeps a human in the loop but reduces friction.

**Phase 6: Download and Save**
- Download confirmed file via the platform's API.
- Auto-generate folder path: `/Orders/{Platform}/{OrderID}_{CustomerName}/design_file.ext`
- Log metadata (order ID, platform, date, filename, staff who confirmed) to a database/spreadsheet for traceability.

**Phase 7: Notify Completion**
- Notify relevant staff/production team that the file is saved and ready.

**Phase 8: Handle Exceptions**
- No attachment found → auto-message or flag to ask customer to resend.
- No order/customer match → manual matching queue.
- API/webhook failure → error log + retry + admin alert.

For the flowchart itself: draw it as **3 parallel platform-input lanes → merge into one shared pipeline (detect → match → queue → confirm → save → notify) → with exception branches peeling off at each decision diamond.** That merge point is the core of the system — it's what turns three different chat sources into one consistent internal process.

---

## Prompt 3

whatever you write to me here along with my prompts, i want you to save it in an MD file and any new prompts and replies you should also make the updates in that file.

### Reply 3

*(This file was created in response to this request, and will be kept updated with new prompts and replies going forward.)*
