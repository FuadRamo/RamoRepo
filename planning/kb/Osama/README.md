# Ramo Studio File Workflow

This setup lets n8n receive an attachment event, download the customer file,
save it under `D:\Downloads\Ramo`, and report the result to the mock database.

```text
Mock database API -> n8n webhook -> Ramo receiver -> D:\Downloads\Ramo
                              \-> job status callback -> mock database API
```

## Requirements

- Node.js 18 or newer
- Python 3
- Flask (`python -m pip install flask`)
- `cloudflared`
- The n8n workflow must be published

## 1. Run the mock database API

Open PowerShell from the repository root:

```powershell
cd .\db-api-app\order-file-api
npm install
npm start
```

The API runs at:

```text
http://127.0.0.1:3000
```

The active test data is stored in `db.json`. To restore the original data from
`db.seed.json`, run:

```powershell
npm run reset-db
```

Resetting the database does not delete files already saved in
`D:\Downloads\Ramo`.

## 2. Run the Ramo receiver

Open another PowerShell window from the repository root:

```powershell
New-Item -ItemType Directory -Force -Path "D:\Downloads\Ramo"
python .\planning\kb\Osama\ramo_receiver.py
```

The receiver runs at:

```text
http://127.0.0.1:8787
```

Check it with:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## 3. Start the temporary Cloudflare tunnels

n8n Cloud cannot access `localhost`, so expose both local services. Open a
separate PowerShell window for each command.

Receiver tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

Database API tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Cloudflare Quick Tunnel URLs are temporary. They change whenever a tunnel is
restarted and must not be treated as production URLs.

After restarting the tunnels, update these n8n nodes:

- `Upload to Ramo Receiver`: `https://<receiver-tunnel>/upload`
- `Report Completed to Database`: `https://<database-tunnel>/api/file-jobs/...`

The production n8n webhook is:

```text
https://ramostudiosama.app.n8n.cloud/webhook/attachment-ready
```

## 4. Trigger an attachment

The following request tells the mock API to read `ATT_123` from `db.json` and
send its existing order and attachment data to n8n. Replace the database tunnel
URL whenever the tunnel changes.

```powershell
$databaseUrl = "https://<database-tunnel>.trycloudflare.com"
$n8nWebhook = "https://ramostudiosama.app.n8n.cloud/webhook/attachment-ready"

$body = @{
    webhook_url  = $n8nWebhook
    attachment_id = "ATT_123"
} | ConvertTo-Json

Invoke-RestMethod `
    -Method Post `
    -Uri "$databaseUrl/api/simulate/fire-webhook" `
    -ContentType "application/json" `
    -Body $body
```

Use `ATT_124` to test the second seeded attachment.

n8n automatically generates folders similar to:

```text
D:\Downloads\Ramo\Orders\shopee\260727QURVFYCT\ITEM_01_Sticker-A5\
```

It also generates the final filename from the order ID, item, product, file
number, and detected extension.

The receiver intentionally refuses to overwrite an existing file. Sending the
same attachment again can therefore return `409 File already exists`.

## Useful checks

```powershell
Invoke-RestMethod "$databaseUrl/api/orders"
Invoke-RestMethod "$databaseUrl/api/attachments"
Invoke-RestMethod "$databaseUrl/api/file-jobs"
```

