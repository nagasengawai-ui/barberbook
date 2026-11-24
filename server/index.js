
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Razorpay from 'razorpay';

import {
  db,
  getSettings,
  setSettings,
  getAddons
} from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

const JWT_SECRET =
  process.env.JWT_SECRET || 'development-only-change-this-secret';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET || '';

const razorpayConfigured = Boolean(
  RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
);

const razorpay = razorpayConfigured
  ? new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    })
  : null;

// -----------------------------------------
// DIRECTORIES
// -----------------------------------------

const uploadDir = path.resolve('server/uploads');
const privateDir = path.resolve('server/private-payments');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(privateDir, { recursive: true });

// -----------------------------------------
// MIDDLEWARE
// -----------------------------------------

app.use(cors({ origin: true }));

// Razorpay webhook must receive the original raw body.
// Keep this route BEFORE express.json().

app.post(
  '/api/razorpay/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      if (!RAZORPAY_WEBHOOK_SECRET) {
        return res.status(503).send('Webhook secret not configured');
      }

      const signature = req.headers['x-razorpay-signature'];

      if (!signature || !Buffer.isBuffer(req.body)) {
        return res.status(400).send('Invalid webhook request');
      }

      const expected = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');

      const receivedBuffer = Buffer.from(String(signature), 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');

      if (
        receivedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
      ) {
        return res.status(400).send('Invalid webhook signature');
      }

      const event = JSON.parse(req.body.toString('utf8'));

      if (
        event.event === 'payment.captured' ||
        event.event === 'order.paid'
      ) {
        const paymentEntity =
          event.payload?.payment?.entity || null;

        const orderEntity =
          event.payload?.order?.entity || null;

        const orderId =
          paymentEntity?.order_id || orderEntity?.id || '';

        const paymentId = paymentEntity?.id || '';

        if (orderId) {
          const booking = db.prepare(`
            SELECT *
            FROM bookings
            WHERE razorpay_order_id = ?
            LIMIT 1
          `).get(orderId);

          if (booking && paymentEntity?.status === 'captured') {
            // advance column now stores ONLY the fixed booking fee.
            if (
              Number(paymentEntity.amount) ===
                Number(booking.advance) * 100 &&
              paymentEntity.currency === 'INR'
            ) {
              approveRazorpayBooking(
                booking.id,
                orderId,
                paymentId
              );
            }
          }
        }
      }

      return res.status(200).json({ received: true });

    } catch (error) {
      console.error('Razorpay webhook error:', error);
      return res.status(500).send('Webhook processing failed');
    }
  }
);

app.use(express.json({ limit: '2mb' }));

app.use('/uploads', express.static(uploadDir));

// -----------------------------------------
// MULTER UPLOAD CONFIGURATION
// -----------------------------------------

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp'
];

const createStorage = directory =>
  multer.diskStorage({
    destination: (req, file, callback) => {
      callback(null, directory);
    },

    filename: (req, file, callback) => {
      const extension =
        path.extname(file.originalname).toLowerCase();

      callback(
        null,
        `${Date.now()}-${crypto.randomUUID()}${extension}`
      );
    }
  });

const createUpload = directory =>
  multer({
    storage: createStorage(directory),
    limits: { fileSize: 5 * 1024 * 1024 },

    fileFilter: (req, file, callback) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return callback(
          new Error('Only JPG, PNG and WEBP images are allowed')
        );
      }

      callback(null, true);
    }
  });

const publicUpload = createUpload(uploadDir);
const privateUpload = createUpload(privateDir);

// -----------------------------------------
// AUTHENTICATION
// -----------------------------------------

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : '';

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    req.admin = jwt.verify(token, JWT_SECRET);
    next();

  } catch {
    return res.status(401).json({
      error: 'Invalid or expired session'
    });
  }
}

// -----------------------------------------
// HELPERS
// -----------------------------------------

const makeId = () => crypto.randomUUID();

function safeBooking(booking) {
  if (!booking) return null;

  const {
    payment_screenshot,
    razorpay_signature,
    ...safe
  } = booking;

  return safe;
}

function getBooking(id) {
  return db.prepare(`
    SELECT *
    FROM bookings
    WHERE id = ?
  `).get(id);
}

function getActiveService(serviceId) {
  return db.prepare(`
    SELECT *
    FROM services
    WHERE id = ? AND active = 1
  `).get(serviceId);
}

function getSelectedAddons(addonIds) {
  if (!Array.isArray(addonIds)) {
    throw new Error('Invalid add-ons');
  }

  if (addonIds.length > 30) {
    throw new Error('Too many add-ons selected');
  }

  const uniqueIds = [...new Set(addonIds.map(String))];

  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => '?').join(',');

  const addons = db.prepare(`
    SELECT *
    FROM addons
    WHERE active = 1
      AND id IN (${placeholders})
  `).all(...uniqueIds);

  if (addons.length !== uniqueIds.length) {
    throw new Error('One or more selected add-ons are unavailable');
  }

  return addons;
}

// -----------------------------------------
// FIXED BOOKING FEE
// -----------------------------------------

function getBookingFee() {
  const settings = getSettings();

  // New setting has priority.
  // Old advanceFee is only a backward-compatible fallback.
  const rawFee =
    settings.bookingFee ??
    settings.booking_fee ??
    settings.advanceFee ??
    50;

  const fee = Number(rawFee);

  if (!Number.isFinite(fee) || fee < 0) {
    return 50;
  }

  return Math.round(fee);
}

// Service and add-on prices are saved separately.
// They NEVER increase the booking fee.

function calculateBooking(service, addons) {
  const addonTotal = addons.reduce(
    (sum, addon) => sum + Number(addon.price || 0),
    0
  );

  const servicePrice = Number(service.price || 0);

  const total = servicePrice + addonTotal;

  // Customer pays ONLY this fixed amount.
  const bookingFee = getBookingFee();

  return {
    total,
    bookingFee,

    // Keep old DB column for compatibility.
    // This column now stores the fixed booking fee only.
    advance: bookingFee,

    addonsJson: JSON.stringify(
      addons.map(addon => ({
        id: addon.id,
        name: addon.name,
        price: Number(addon.price)
      }))
    )
  };
}

function validateBookingDetails(body) {
  const {
    date,
    time,
    customerName,
    phone,
    serviceId
  } = body;

  if (
    !date ||
    !time ||
    !customerName ||
    !phone ||
    !serviceId
  ) {
    throw new Error('Please fill all required booking details');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error('Invalid booking date');
  }

  if (!/^\d{2}:\d{2}$/.test(String(time))) {
    throw new Error('Invalid booking time');
  }

  if (String(customerName).trim().length < 2) {
    throw new Error('Please enter a valid customer name');
  }

  if (!/^[0-9+\-\s]{8,16}$/.test(String(phone))) {
    throw new Error('Please enter a valid phone number');
  }

  const selectedDate = new Date(`${date}T${time}:00`);
  const now = new Date();

  if (
    Number.isNaN(selectedDate.getTime()) ||
    selectedDate.getTime() < now.getTime() - 60000
  ) {
    throw new Error('Please select a future date and time');
  }
}

function checkSlotAvailability(date, time) {
  const settings = getSettings();

  const maxBookings = Math.max(
    1,
    Number(settings.maxBookingsPerSlot || 3)
  );

  const count = db.prepare(`
    SELECT COUNT(*) AS total
    FROM bookings
    WHERE date = ?
      AND time = ?
      AND status NOT IN ('Cancelled', 'Rejected')
      AND (
        payment_method = 'upi'
        OR payment_status = 'Approved'
        OR status = 'Confirmed'
      )
  `).get(date, time).total;

  if (count >= maxBookings) {
    throw new Error('This time slot is full. Please select another time.');
  }
}

function getPaymentMode() {
  const mode = String(
    getSettings().paymentMode || 'upi'
  ).toLowerCase();

  return ['upi', 'razorpay', 'both'].includes(mode)
    ? mode
    : 'upi';
}

function isRazorpayAllowed() {
  const mode = getPaymentMode();

  return (
    razorpayConfigured &&
    (mode === 'razorpay' || mode === 'both')
  );
}

function isUpiAllowed() {
  const mode = getPaymentMode();

  return mode === 'upi' || mode === 'both';
}

// -----------------------------------------
// TOKEN AND PAYMENT APPROVAL
// -----------------------------------------

function approveRazorpayBooking(
  bookingId,
  orderId,
  paymentId
) {
  const transaction = db.transaction(() => {
    const booking = getBooking(bookingId);

    if (!booking) return false;

    if (
      booking.razorpay_order_id !== orderId ||
      booking.payment_method !== 'razorpay'
    ) {
      return false;
    }

    // Idempotency: webhook and verify endpoint may both arrive.
    if (
      booking.payment_status === 'Approved' &&
      booking.token
    ) {
      return true;
    }

    if (
      booking.status === 'Cancelled' ||
      booking.status === 'Rejected'
    ) {
      return false;
    }

    const nextToken = db.prepare(`
      SELECT COALESCE(MAX(token), 0) + 1 AS nextToken
      FROM bookings
      WHERE date = ?
    `).get(booking.date).nextToken;

    db.prepare(`
      UPDATE bookings
      SET
        token = ?,
        payment_status = 'Approved',
        status = 'Confirmed',
        razorpay_payment_id = ?,
        payment_verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextToken,
      paymentId,
      bookingId
    );

    return true;
  });

  return transaction();
}

function approveUpiBooking(bookingId) {
  const transaction = db.transaction(() => {
    const booking = getBooking(bookingId);

    if (!booking) {
      throw new Error('Booking not found');
    }

    if (!booking.payment_screenshot) {
      throw new Error('Payment screenshot is missing');
    }

    if (
      booking.status === 'Rejected' ||
      booking.status === 'Cancelled'
    ) {
      throw new Error('This booking cannot be approved');
    }

    if (
      booking.payment_status === 'Approved' &&
      booking.token
    ) {
      return booking;
    }

    const nextToken = db.prepare(`
      SELECT COALESCE(MAX(token), 0) + 1 AS nextToken
      FROM bookings
      WHERE date = ?
    `).get(booking.date).nextToken;

    db.prepare(`
      UPDATE bookings
      SET
        token = ?,
        payment_status = 'Approved',
        status = 'Confirmed',
        payment_verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextToken, bookingId);

    return getBooking(bookingId);
  });

  return transaction();
}

// -----------------------------------------
// PUBLIC API
// -----------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BarberBook Pro'
  });
});

app.get('/api/public', (req, res) => {
  const settings = getSettings();

  res.json({
    settings: {
      ...settings,

      // Frontend should use bookingFee.
      bookingFee: getBookingFee(),

      paymentMode: getPaymentMode(),

      razorpayKeyId: razorpayConfigured
        ? RAZORPAY_KEY_ID
        : '',

      razorpayEnabled: isRazorpayAllowed()
    },

    services: db.prepare(`
      SELECT *
      FROM services
      WHERE active = 1
      ORDER BY name
    `).all(),

    addons: getAddons(true)
  });
});

// -----------------------------------------
// ADMIN LOGIN
// -----------------------------------------

app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    const admin = db.prepare(`
      SELECT *
      FROM admins
      WHERE username = ?
    `).get(String(username));

    if (
      !admin ||
      !bcrypt.compareSync(
        String(password),
        admin.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      username: admin.username
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Login failed'
    });
  }
});

// -----------------------------------------
// ADMIN BOOKINGS
// -----------------------------------------

app.get('/api/admin/bookings', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM bookings
    ORDER BY created_at DESC
  `).all();

  res.json(rows.map(safeBooking));
});

// -----------------------------------------
// PRIVATE PAYMENT SCREENSHOT
// -----------------------------------------

app.get(
  '/api/admin/payment-proof/:id',
  auth,
  (req, res) => {
    const booking = getBooking(req.params.id);

    if (!booking || !booking.payment_screenshot) {
      return res.status(404).json({
        error: 'Payment screenshot not found'
      });
    }

    const filename = path.basename(
      booking.payment_screenshot
    );

    const filePath = path.join(privateDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Payment proof file not found'
      });
    }

    res.sendFile(filePath);
  }
);

// -----------------------------------------
// ADMIN SETTINGS
// -----------------------------------------

app.get('/api/admin/settings', auth, (req, res) => {
  res.json({
    ...getSettings(),

    // Return the normalized fixed fee.
    bookingFee: getBookingFee(),

    paymentMode: getPaymentMode(),
    razorpayConfigured
  });
});

app.put('/api/admin/settings', auth, (req, res) => {
  try {
    const allowed = [
      'shopName',
      'tagline',
      'address',
      'phone',
      'whatsapp',
      'hours',
      'upiId',

      // New fixed booking fee setting.
      'bookingFee',

      // Old setting accepted for older frontend compatibility.
      'advanceFee',

      'advanceMode',
      'qrImage',
      'logoImage',
      'slotInterval',
      'maxBookingsPerSlot',
      'currency',
      'paymentMode'
    ];

    const updates = {};

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        updates[key] = req.body[key];
      }
    }

    // If old frontend sends advanceFee, convert it to bookingFee.
    // New bookingFee always has priority.
    if (
      updates.bookingFee === undefined &&
      updates.advanceFee !== undefined
    ) {
      updates.bookingFee = updates.advanceFee;
    }

    if (updates.bookingFee !== undefined) {
      const fee = Number(updates.bookingFee);

      if (
        !Number.isFinite(fee) ||
        fee < 0 ||
        fee > 10000
      ) {
        return res.status(400).json({
          error: 'Booking fee must be between ₹0 and ₹10,000'
        });
      }

      updates.bookingFee = String(Math.round(fee));
    }

    if (updates.paymentMode !== undefined) {
      const mode = String(updates.paymentMode).toLowerCase();

      if (!['upi', 'razorpay', 'both'].includes(mode)) {
        return res.status(400).json({
          error: 'Invalid payment mode'
        });
      }

      if (
        mode !== 'upi' &&
        !razorpayConfigured
      ) {
        return res.status(400).json({
          error: 'Configure Razorpay keys in server .env first'
        });
      }

      updates.paymentMode = mode;
    }

    setSettings(updates);

    res.json({
      success: true,
      settings: {
        ...getSettings(),
        bookingFee: getBookingFee(),
        paymentMode: getPaymentMode(),
        razorpayConfigured
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Could not save settings'
    });
  }
});

// -----------------------------------------
// ADMIN IMAGE UPLOAD
// Accepts fields: file, image, qr, logo
// -----------------------------------------

app.post(
  '/api/admin/upload',
  auth,
  publicUpload.any(),
  (req, res) => {
    try {
      const file = req.files?.[0];

      if (!file) {
        return res.status(400).json({
          error: 'Please select an image'
        });
      }

      res.json({
        success: true,
        filename: file.filename,
        url: `/uploads/${file.filename}`
      });

    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  }
);

// -----------------------------------------
// ADMIN ADD-ONS
// -----------------------------------------

app.get('/api/admin/addons', auth, (req, res) => {
  res.json(getAddons(false));
});

app.post('/api/admin/addons', auth, (req, res) => {
  try {
    const {
      name,
      description = '',
      price
    } = req.body || {};

    if (
      !String(name || '').trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        error: 'Valid name and price are required'
      });
    }

    const id = makeId();

    db.prepare(`
      INSERT INTO addons(id, name, description, price, active)
      VALUES(?, ?, ?, ?, 1)
    `).run(
      id,
      String(name).trim(),
      String(description),
      Math.round(Number(price))
    );

    res.json({
      success: true,
      addon: db.prepare(`
        SELECT *
        FROM addons
        WHERE id = ?
      `).get(id)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Could not create add-on'
    });
  }
});

app.put('/api/admin/addons/:id', auth, (req, res) => {
  try {
    const current = db.prepare(`
      SELECT *
      FROM addons
      WHERE id = ?
    `).get(req.params.id);

    if (!current) {
      return res.status(404).json({
        error: 'Add-on not found'
      });
    }

    const name = req.body.name ?? current.name;
    const description =
      req.body.description ?? current.description;
    const price = req.body.price ?? current.price;
    const active =
      req.body.active === undefined
        ? current.active
        : (req.body.active ? 1 : 0);

    if (
      !String(name).trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        error: 'Invalid add-on details'
      });
    }

    db.prepare(`
      UPDATE addons
      SET name = ?, description = ?, price = ?, active = ?
      WHERE id = ?
    `).run(
      String(name).trim(),
      String(description),
      Math.round(Number(price)),
      active,
      req.params.id
    );

    res.json({
      success: true
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Could not update add-on'
    });
  }
});

app.delete('/api/admin/addons/:id', auth, (req, res) => {
  db.prepare(`
    DELETE FROM addons
    WHERE id = ?
  `).run(req.params.id);

  res.json({ success: true });
});

// -----------------------------------------
// ADMIN SERVICES
// -----------------------------------------

app.post('/api/admin/services', auth, (req, res) => {
  try {
    const {
      name,
      description = '',
      price,
      duration = 30,
      category = 'GROOMING'
    } = req.body || {};

    if (
      !String(name || '').trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        error: 'Valid service name and price are required'
      });
    }

    const id = makeId();

    db.prepare(`
      INSERT INTO services(
        id, name, description, price, duration, category, active
      )
      VALUES(?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      String(name).trim(),
      String(description),
      Math.round(Number(price)),
      Math.max(1, Number(duration)),
      String(category)
    );

    res.json({
      success: true,
      service: db.prepare(`
        SELECT *
        FROM services
        WHERE id = ?
      `).get(id)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Could not create service'
    });
  }
});

app.put('/api/admin/services/:id', auth, (req, res) => {
  try {
    const current = db.prepare(`
      SELECT *
      FROM services
      WHERE id = ?
    `).get(req.params.id);

    if (!current) {
      return res.status(404).json({
        error: 'Service not found'
      });
    }

    const name = req.body.name ?? current.name;
    const description =
      req.body.description ?? current.description;
    const price = req.body.price ?? current.price;
    const duration = req.body.duration ?? current.duration;
    const category = req.body.category ?? current.category;
    const active =
      req.body.active === undefined
        ? current.active
        : (req.body.active ? 1 : 0);

    if (
      !String(name).trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        error: 'Invalid service details'
      });
    }

    db.prepare(`
      UPDATE services
      SET
        name = ?,
        description = ?,
        price = ?,
        duration = ?,
        category = ?,
        active = ?
      WHERE id = ?
    `).run(
      String(name).trim(),
      String(description),
      Math.round(Number(price)),
      Math.max(1, Number(duration)),
      String(category),
      active,
      req.params.id
    );

    res.json({ success: true });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Could not update service'
    });
  }
});

app.delete('/api/admin/services/:id', auth, (req, res) => {
  db.prepare(`
    UPDATE services
    SET active = 0
    WHERE id = ?
  `).run(req.params.id);

  res.json({ success: true });
});

// -----------------------------------------
// UPI BOOKING
// -----------------------------------------

app.post(
  '/api/bookings',
  privateUpload.single('screenshot'),
  (req, res) => {
    try {
      if (!isUpiAllowed()) {
        return res.status(400).json({
          error: 'UPI payment is currently unavailable'
        });
      }

      const body = req.body || {};

      validateBookingDetails(body);

      if (!req.file) {
        return res.status(400).json({
          error: 'Payment screenshot is required'
        });
      }

      const service = getActiveService(body.serviceId);

      if (!service) {
        return res.status(400).json({
          error: 'Selected service is unavailable'
        });
      }

      let addonIds = [];

      try {
        addonIds = body.addonIds
          ? JSON.parse(body.addonIds)
          : [];
      } catch {
        return res.status(400).json({
          error: 'Invalid add-on selection'
        });
      }

      const addons = getSelectedAddons(addonIds);

      checkSlotAvailability(body.date, body.time);

      const pricing = calculateBooking(service, addons);
      const id = makeId();

      db.prepare(`
        INSERT INTO bookings(
          id,
          date,
          time,
          customer_name,
          phone,
          email,
          service_id,
          service_name,
          barber,
          total,
          advance,
          transaction_id,
          payment_screenshot,
          payment_status,
          status,
          addons_json,
          payment_method
        )
        VALUES(
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'Pending Verification',
          'Pending',
          ?,
          'upi'
        )
      `).run(
        id,
        body.date,
        body.time,
        String(body.customerName).trim(),
        String(body.phone).trim(),
        String(body.email || '').trim(),
        service.id,
        service.name,
        String(body.barber || 'Any available barber'),

        // Full service + add-on value is saved separately.
        pricing.total,

        // Only fixed booking fee is saved in advance.
        pricing.bookingFee,

        String(body.transactionId || '').trim(),
        req.file.filename,
        pricing.addonsJson
      );

      res.status(201).json({
        success: true,
        booking: safeBooking(getBooking(id))
      });

    } catch (error) {
      console.error('UPI booking error:', error);

      res.status(400).json({
        error: error.message || 'Could not create booking'
      });
    }
  }
);

// -----------------------------------------
// RAZORPAY CREATE ORDER
// -----------------------------------------

app.post('/api/payments/create-order', async (req, res) => {
  try {
    if (!isRazorpayAllowed()) {
      return res.status(400).json({
        error: 'Razorpay payment is not enabled or configured'
      });
    }

    const body = req.body || {};

    validateBookingDetails(body);

    const service = getActiveService(body.serviceId);

    if (!service) {
      return res.status(400).json({
        error: 'Selected service is unavailable'
      });
    }

    let addonIds = body.addonIds || [];

    if (typeof addonIds === 'string') {
      addonIds = JSON.parse(addonIds);
    }

    const addons = getSelectedAddons(addonIds);

    checkSlotAvailability(body.date, body.time);

    const pricing = calculateBooking(service, addons);

    // Razorpay receives ONLY the fixed booking fee.
    if (pricing.bookingFee <= 0) {
      return res.status(400).json({
        error: 'Booking fee must be greater than zero for Razorpay payment'
      });
    }

    const bookingId = makeId();

    const order = await razorpay.orders.create({
      amount: Math.round(pricing.bookingFee * 100),
      currency: 'INR',
      receipt: bookingId.slice(0, 40),
      notes: {
        booking_id: bookingId,
        customer_name: String(body.customerName).trim(),
        customer_phone: String(body.phone).trim(),
        payment_type: 'Fixed booking fee'
      }
    });

    db.prepare(`
      INSERT INTO bookings(
        id,
        date,
        time,
        customer_name,
        phone,
        email,
        service_id,
        service_name,
        barber,
        total,
        advance,
        transaction_id,
        payment_screenshot,
        payment_status,
        status,
        addons_json,
        payment_method,
        razorpay_order_id
      )
      VALUES(
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        '', '',
        'Pending',
        'Pending Payment',
        ?,
        'razorpay',
        ?
      )
    `).run(
      bookingId,
      body.date,
      body.time,
      String(body.customerName).trim(),
      String(body.phone).trim(),
      String(body.email || '').trim(),
      service.id,
      service.name,
      String(body.barber || 'Any available barber'),

      // Full service + add-on value.
      pricing.total,

      // Only fixed booking fee.
      pricing.bookingFee,

      pricing.addonsJson,
      order.id
    );

    res.status(201).json({
      success: true,
      bookingId,
      orderId: order.id,

      // Exact amount returned by Razorpay.
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID,

      customer: {
        name: String(body.customerName).trim(),
        contact: String(body.phone).trim(),
        email: String(body.email || '').trim()
      }
    });

  } catch (error) {
    console.error('Razorpay order error:', error);

    res.status(400).json({
      error: error.message || 'Could not create Razorpay order'
    });
  }
});

// -----------------------------------------
// RAZORPAY PAYMENT VERIFICATION
// -----------------------------------------

app.post('/api/payments/verify', async (req, res) => {
  try {
    if (!razorpayConfigured) {
      return res.status(503).json({
        error: 'Razorpay is not configured'
      });
    }

    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};

    if (
      !bookingId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: 'Payment verification details are incomplete'
      });
    }

    const booking = getBooking(bookingId);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found'
      });
    }

    if (
      booking.payment_method !== 'razorpay' ||
      booking.razorpay_order_id !== razorpay_order_id
    ) {
      return res.status(400).json({
        error: 'Order does not match this booking'
      });
    }

    // Verify Razorpay signature on the server.
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const received = Buffer.from(String(razorpay_signature));
    const expected = Buffer.from(expectedSignature);

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return res.status(400).json({
        error: 'Invalid payment signature'
      });
    }

    // Fetch payment directly from Razorpay.
    const payment = await razorpay.payments.fetch(
      razorpay_payment_id
    );

    // advance contains ONLY the fixed booking fee.
    if (
      payment.status !== 'captured' ||
      payment.order_id !== razorpay_order_id ||
      Number(payment.amount) !== Number(booking.advance) * 100 ||
      payment.currency !== 'INR'
    ) {
      return res.status(400).json({
        error: 'Payment is not captured or payment details do not match'
      });
    }

    const approved = approveRazorpayBooking(
      bookingId,
      razorpay_order_id,
      razorpay_payment_id
    );

    if (!approved) {
      return res.status(400).json({
        error: 'Booking could not be confirmed'
      });
    }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      booking: safeBooking(getBooking(bookingId))
    });

  } catch (error) {
    console.error('Payment verification error:', error);

    res.status(500).json({
      error: 'Payment verification failed'
    });
  }
});

// -----------------------------------------
// ADMIN APPROVE UPI PAYMENT
// -----------------------------------------

app.post(
  '/api/admin/bookings/:id/approve',
  auth,
  (req, res) => {
    try {
      const booking = getBooking(req.params.id);

      if (!booking) {
        return res.status(404).json({
          error: 'Booking not found'
        });
      }

      if (booking.payment_method === 'razorpay') {
        return res.status(400).json({
          error: 'Razorpay payments are verified automatically'
        });
      }

      const updated = approveUpiBooking(req.params.id);

      res.json({
        success: true,
        booking: safeBooking(updated)
      });

    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  }
);

// -----------------------------------------
// ADMIN REJECT BOOKING
// -----------------------------------------

app.post(
  '/api/admin/bookings/:id/reject',
  auth,
  (req, res) => {
    const booking = getBooking(req.params.id);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found'
      });
    }

    if (booking.payment_status === 'Approved') {
      return res.status(400).json({
        error: 'An approved payment cannot be rejected here'
      });
    }

    db.prepare(`
      UPDATE bookings
      SET
        status = 'Rejected',
        payment_status = 'Rejected'
      WHERE id = ?
    `).run(req.params.id);

    res.json({
      success: true
    });
  }
);

// -----------------------------------------
// ADMIN UPDATE BOOKING STATUS
// -----------------------------------------

app.patch(
  '/api/admin/bookings/:id/status',
  auth,
  (req, res) => {
    const { status } = req.body || {};

    const allowedStatuses = [
      'Pending',
      'Confirmed',
      'Completed',
      'Cancelled',
      'Rejected'
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid booking status'
      });
    }

    const booking = getBooking(req.params.id);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found'
      });
    }

    if (
      status === 'Confirmed' &&
      booking.payment_status !== 'Approved'
    ) {
      return res.status(400).json({
        error: 'Verify payment before confirming this booking'
      });
    }

    db.prepare(`
      UPDATE bookings
      SET status = ?
      WHERE id = ?
    `).run(status, req.params.id);

    res.json({
      success: true,
      booking: safeBooking(getBooking(req.params.id))
    });
  }
);

// -----------------------------------------
// PUBLIC BOOKING RECEIPT
// -----------------------------------------

app.get('/api/bookings/:id', (req, res) => {
  const booking = getBooking(req.params.id);

  if (!booking) {
    return res.status(404).json({
      error: 'Booking not found'
    });
  }

  res.json(safeBooking(booking));
});

// -----------------------------------------
// FRONTEND PRODUCTION BUILD
// -----------------------------------------

const distDir = path.resolve('dist');

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// -----------------------------------------
// ERROR HANDLER
// -----------------------------------------

app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Image size must be 5MB or less'
          : error.message
    });
  }

  res.status(400).json({
    error: error.message || 'Something went wrong'
  });
});

// -----------------------------------------
// START SERVER
// -----------------------------------------

app.listen(PORT, () => {
  console.log(`BarberBook Pro server running on port ${PORT}`);

  console.log(
    `Razorpay configured: ${razorpayConfigured ? 'YES' : 'NO'}`
  );

  console.log(
    `Payment mode: ${getPaymentMode()}`
  );

  console.log(
    `Default booking fee: ₹${getBookingFee()}`
  );
});
