# BarberBook Pro — Barber / Salon Booking System

A single-shop, self-hosted full-stack booking product for local barbers and salons. The React customer website and owner dashboard use the same Express API and SQLite database. Admin edits are saved on the server and customer pages fetch the latest data; the dashboard refreshes bookings every 3 seconds.

## Requirements
- Node.js 20 LTS or newer
- npm

## Run locally (Windows PowerShell)
1. Extract this folder and open it in VS Code.
2. In the project terminal:
   ```powershell
   Copy-Item .env.example .env
   npm install
   npm run dev
   ```
3. Customer site: http://localhost:5173
4. Owner dashboard: http://localhost:5173/admin

Default first-run login is username `owner`, password `ChangeMe@12345`. Change `ADMIN_PASSWORD` in `.env` before starting for the first time. If the database was already initialized, changing `.env` will not reset the existing admin password; use the database admin password reset procedure before launch.

## Production build
```powershell
npm run build
npm start
```
The Express server serves the built React website and API on port 4000. Put it behind HTTPS using a production host/reverse proxy. Keep `server/data` and `server/uploads` on persistent storage and back them up.

## Included
- Persistent SQLite database for shop profile, services and bookings
- Admin login with bcrypt password hash and signed 12-hour JWT
- Add, edit and soft-delete services; changes are available to customer pages via the API
- Configurable advance fee (fixed rupee amount), UPI ID and uploadable UPI QR image
- Customer booking form with payment reference and optional screenshot upload
- Admin payment review; approve only after checking the actual credit in the UPI/bank app
- Daily queue token assigned transactionally on approval; statuses for arrived, in service, completed, no-show and cancelled
- Shop details, WhatsApp number, opening hours, slot capacity and logo/QR uploads
- WhatsApp click-to-chat links with booking information

## Important launch checklist
This is a deployable single-shop application, not a hosted multi-tenant SaaS. Each barber shop needs its own deployment/database or a carefully engineered tenant layer. Before taking paying customers:
1. Set a long random `JWT_SECRET`, strong unique admin password, correct WhatsApp number and UPI ID in `.env` / settings.
2. Deploy on HTTPS; configure firewall, backups, persistent disk, monitoring and database access controls.
3. Review local privacy/retention requirements for customer phone numbers and payment screenshots; restrict server and upload access. Payment screenshots are stored separately and served only through an authenticated admin endpoint. Shop QR/logo images are public so customers can load them. Keep server and upload directories private at the host level and apply a retention policy for customer payment proofs.
4. Manually verify every UPI payment in the merchant bank/UPI app. An uploaded screenshot or UTR is not automatic payment confirmation. Do not approve based only on the image.
5. The WhatsApp buttons open WhatsApp with a prefilled message. They do not send automatically. For automated messages to both customer and shop, register a WhatsApp Business Platform account, configure approved templates, webhook/opt-in handling and credentials, then integrate the Cloud API. Do not promise automated WhatsApp until this is configured and tested.
6. The current slot cap is a simple per-date/time limit. Configure shop hours, holidays, barber-specific schedules and service-duration-aware scheduling before a high-volume launch.
7. The app currently provisions one shop per deployment. Do not sell the same shared database to multiple shops without tenant isolation, per-shop admin accounts, data access tests and tenant-aware media storage.

## Data
SQLite database: `server/data/barberbook.sqlite`
Uploads: `server/uploads/`
Back up both directories. Never commit `.env`, customer data or uploads to a public Git repository.
