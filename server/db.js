
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve('server/data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(
  path.join(dataDir, 'barberbook.sqlite')
);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ----------------------------------
// DATABASE TABLES
// ----------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price INTEGER NOT NULL,
    duration INTEGER NOT NULL DEFAULT 30,
    category TEXT DEFAULT 'GROOMING',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS addons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    token INTEGER,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    service_id TEXT,
    service_name TEXT NOT NULL,
    barber TEXT DEFAULT 'Any available barber',
    total INTEGER NOT NULL,
    advance INTEGER NOT NULL,
    transaction_id TEXT DEFAULT '',
    payment_screenshot TEXT DEFAULT '',
    payment_status TEXT DEFAULT 'Pending Verification',
    status TEXT DEFAULT 'Pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_date
  ON bookings(date, time);
`);

// ----------------------------------
// SAFE DATABASE MIGRATIONS
// ----------------------------------

const bookingColumns = db.prepare(
  'PRAGMA table_info(bookings)'
).all();

const ensureBookingColumn = (name, definition) => {
  if (!bookingColumns.some(column => column.name === name)) {
    db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);
  }
};

ensureBookingColumn(
  'addons_json',
  "TEXT NOT NULL DEFAULT '[]'"
);

ensureBookingColumn(
  'payment_method',
  "TEXT NOT NULL DEFAULT 'upi'"
);

ensureBookingColumn(
  'razorpay_order_id',
  "TEXT DEFAULT ''"
);

ensureBookingColumn(
  'razorpay_payment_id',
  "TEXT DEFAULT ''"
);

ensureBookingColumn(
  'razorpay_signature',
  "TEXT DEFAULT ''"
);

ensureBookingColumn(
  'payment_verified_at',
  "TEXT DEFAULT ''"
);

// Prevent one Razorpay payment from being attached to multiple bookings.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_payment_id
  ON bookings(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL
    AND razorpay_payment_id != '';
`);

// ----------------------------------
// DEFAULT SETTINGS
// ----------------------------------

const defaults = {
  shopName: 'Royal Cuts Barber Studio',
  tagline: 'Good grooming. No waiting.',
  address: 'Your shop address, Pune, Maharashtra',
  phone: '9876543210',
  whatsapp: process.env.SHOP_WHATSAPP || '919699214019',
  hours: 'Mon–Sun · 9:00 AM – 9:00 PM',
  upiId: 'yourshop@upi',

  // Fixed booking fee paid by customer.
  bookingFee: '50',

  // Kept for backward compatibility.
  advanceMode: 'fixed',

  qrImage: '',
  logoImage: '',
  slotInterval: '30',
  maxBookingsPerSlot: '3',
  currency: 'INR',

  // Payment configuration.
  paymentMode: 'upi'
};

const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO settings(key, value)
  VALUES(?, ?)
`);

for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, String(value));
}

// ----------------------------------
// OLD SETTING MIGRATION
// ----------------------------------

// If an older database has advanceFee but no bookingFee,
// migrate its existing value to bookingFee.
// Existing shop settings are preserved.

const existingSettings = db.prepare(`
  SELECT key, value
  FROM settings
  WHERE key IN ('bookingFee', 'advanceFee')
`).all();

const existingMap = Object.fromEntries(
  existingSettings.map(row => [row.key, row.value])
);

if (existingMap.bookingFee === undefined) {
  const oldFee = existingMap.advanceFee ?? '50';

  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES('bookingFee', ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(String(oldFee));
}

// ----------------------------------
// ADMIN CREATION
// ----------------------------------

const adminCount = db.prepare(
  'SELECT COUNT(*) AS n FROM admins'
).get().n;

if (!adminCount) {
  db.prepare(`
    INSERT INTO admins(username, password_hash)
    VALUES(?, ?)
  `).run(
    process.env.ADMIN_USERNAME || 'owner',
    bcrypt.hashSync(
      process.env.ADMIN_PASSWORD || 'ChangeMe@12345',
      12
    )
  );
}

// ----------------------------------
// DEFAULT SERVICES
// ----------------------------------

const serviceCount = db.prepare(
  'SELECT COUNT(*) AS n FROM services'
).get().n;

if (!serviceCount) {
  const add = db.prepare(`
    INSERT INTO services(
      id, name, description, price, duration, category
    )
    VALUES(?, ?, ?, ?, ?, ?)
  `);

  [
    [
      'svc_cut',
      'Classic Haircut',
      'Clean, confident and tailored to you',
      150,
      30,
      'HAIRCUT'
    ],
    [
      'svc_beard',
      'Beard Styling',
      'Shape, trim and define',
      100,
      20,
      'BEARD'
    ],
    [
      'svc_combo',
      'Haircut + Beard',
      'The complete grooming session',
      220,
      45,
      'COMBO'
    ],
    [
      'svc_fade',
      'Skin Fade',
      'Precision fade with a sharp finish',
      200,
      40,
      'HAIRCUT'
    ]
  ].forEach(row => add.run(...row));
}

// ----------------------------------
// SETTINGS FUNCTIONS
// ----------------------------------

export function getSettings() {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings')
      .all()
      .map(row => [row.key, row.value])
  );
}

export function setSettings(obj) {
  const statement = db.prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `);

  const transaction = db.transaction(entries => {
    for (const [key, value] of entries) {
      statement.run(key, String(value ?? ''));
    }
  });

  transaction(Object.entries(obj));

  return getSettings();
}

// ----------------------------------
// ADD-ON FUNCTIONS
// ----------------------------------

export function getAddons(activeOnly = true) {
  return db.prepare(`
    SELECT id, name, description, price, active
    FROM addons
    ${activeOnly ? 'WHERE active = 1' : ''}
    ORDER BY created_at DESC
  `).all();
}
