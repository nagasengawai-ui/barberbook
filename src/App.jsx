
import React, { useEffect, useState } from 'react';
import {
  Scissors, Clock, MapPin, Phone, MessageCircle,
  Edit2, Trash2, Check, X, LogOut,
  RefreshCw, Copy, ZoomIn, Smartphone
} from 'lucide-react';

const money = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN');

const today = () => {
  const now = new Date();
  return new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 10);
};

const getBookingFee = settings =>
  Math.max(
    0,
    Number(
      settings?.bookingFee ??
      settings?.booking_fee ??
      settings?.advanceFee ??
      50
    ) || 0
  );

const getPaidBookingFee = booking =>
  Number(
    booking?.booking_fee ??
    booking?.bookingFee ??
    booking?.advance ??
    0
  );

const api = async (url, opts = {}) => {
  const r = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(opts.headers || {})
    }
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw Error(d.error || 'Something went wrong');
  }

  return d;
};

const wa = (phone, text) =>
  `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

const makeUpiLink = (upiId, shopName, amount) => {
  if (!upiId || upiId === 'yourshop@upi') return '';

  const params = new URLSearchParams({
    pa: upiId,
    pn: shopName || 'Barber Shop',
    am: Number(amount || 0).toFixed(2),
    cu: 'INR',
    tn: 'Barber appointment booking fee'
  });

  return `upi://pay?${params.toString()}`;
};

const loadRazorpayScript = () =>
  new Promise(resolve => {
    if (window.Razorpay) return resolve(true);

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });

const parseAddons = booking => {
  if (Array.isArray(booking?.addons)) return booking.addons;

  try {
    return JSON.parse(booking?.addons_json || '[]');
  } catch {
    return [];
  }
};

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [pub, setPub] = useState({
    settings: {},
    services: [],
    addons: []
  });
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const listener = () => setPath(location.pathname);
    addEventListener('popstate', listener);
    return () => removeEventListener('popstate', listener);
  }, []);

  const go = p => {
    history.pushState({}, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  };

  const refresh = () => setRefreshCount(x => x + 1);

  useEffect(() => {
    let live = true;

    api('/api/public')
      .then(d => {
        if (live) setPub(d);
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [refreshCount]);

  const [admin, setAdmin] = useState(!!localStorage.bbToken);
  const [bookings, setBookings] = useState([]);

  const loadBookings = () => {
    if (!localStorage.bbToken) return;

    api('/api/admin/bookings', {
      headers: {
        Authorization: 'Bearer ' + localStorage.bbToken
      }
    })
      .then(setBookings)
      .catch(() => {
        localStorage.removeItem('bbToken');
        setAdmin(false);
      });
  };

  useEffect(() => {
    if (!admin) return;

    loadBookings();
    const timer = setInterval(loadBookings, 5000);

    return () => clearInterval(timer);
  }, [admin]);

  const settings = pub.settings || {};

  if (path === '/admin') {
    return (
      <Admin
        admin={admin}
        setAdmin={setAdmin}
        bookings={bookings}
        reload={loadBookings}
        settings={settings}
        refresh={refresh}
        go={go}
      />
    );
  }

  if (path.startsWith('/receipt/')) {
    return (
      <Receipt
        id={path.split('/').pop()}
        settings={settings}
        go={go}
      />
    );
  }

  if (path === '/book') {
    return <Booking data={pub} go={go} refresh={refresh} />;
  }

  return <Home data={pub} go={go} />;
}

// ---------------- HEADER ----------------

function Header({ s, go }) {
  return (
    <header>
      <button className="brand" onClick={() => go('/')}>
        {s.logoImage
          ? <img className="brandlogo" src={s.logoImage} alt="Shop logo" />
          : <span className="brandicon"><Scissors /></span>}

        <span>
          {s.shopName || 'BARBERBOOK'}
          <small>GROOMING · BOOKING</small>
        </span>
      </button>

      <nav>
        <a href="#services">Services</a>
        <a href="#visit">Visit</a>
        <button className="btn" onClick={() => go('/book')}>
          Book appointment ↗
        </button>
        <button className="adminlink" onClick={() => go('/admin')}>
          Shop admin
        </button>
      </nav>
    </header>
  );
}

// ---------------- HOME ----------------

function Home({ data, go }) {
  const s = data.settings || {};
  const services = data.services || [];

  return (
    <>
      <Header s={s} go={go} />

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">YOUR LOCAL BARBER. YOUR TIME.</span>
            <h1>Look sharp.<br /><i>Skip the wait.</i></h1>

            <p>
              {s.tagline || 'Book your chair online, pay a small booking fee and walk in on time.'}
            </p>

            <button className="btn gold" onClick={() => go('/book')}>
              Reserve your chair ↗
            </button>

            <div className="hero-proof">
              <span>✓ Easy online booking</span>
              <span>✓ Transparent pricing</span>
              <span>✓ Daily queue token</span>
            </div>
          </div>

          <div className="hero-art">
            <div className="art-circle">✂</div>
            <div className="art-caption">GOOD HAIR<br />GOOD DAY.</div>
          </div>
        </section>

        <section className="section" id="services">
          <div className="sectionhead">
            <div>
              <span className="eyebrow">THE MENU</span>
              <h2>Choose your <i>service.</i></h2>
            </div>
            <p>Clear pricing. No surprises.</p>
          </div>

          <div className="services">
            {services.map(x => (
              <article className="service" key={x.id}>
                <span className="service-tag">{x.category}</span>
                <h3>{x.name}</h3>
                <p>{x.description}</p>

                <div className="servicefoot">
                  <b>{money(x.price)}</b>
                  <span><Clock size={15} /> {x.duration} min</span>
                </div>

                <button onClick={() => go('/book')}>
                  Book this service ↗
                </button>
              </article>
            ))}
          </div>

          {!services.length && (
            <p>Services will appear here once added by the shop.</p>
          )}
        </section>

        <section className="visit" id="visit">
          <div>
            <span className="eyebrow">COME THROUGH</span>
            <h2>Your chair<br /><i>is waiting.</i></h2>
          </div>

          <div className="visitdetails">
            <p><MapPin /> {s.address || 'Shop address'}</p>
            <p><Clock /> {s.hours || 'Opening hours'}</p>
            <p><Phone /> {s.phone || 'Contact number'}</p>
            <button className="btn gold" onClick={() => go('/book')}>
              Book now ↗
            </button>
          </div>
        </section>
      </main>

      <footer>
        © {new Date().getFullYear()} {s.shopName || 'BarberBook'} · Powered by BarberBook
      </footer>
    </>
  );
}

// ---------------- QR VIEWER ----------------

function QRViewer({ src, close }) {
  useEffect(() => {
    const listener = e => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('keydown', listener);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', listener);
      document.body.style.overflow = '';
    };
  }, [close]);

  if (!src) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,.94)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
    >
      <button
        onClick={close}
        style={{
          position: 'absolute',
          right: 20,
          top: 20,
          color: '#fff',
          background: '#333',
          border: 0,
          borderRadius: 50,
          width: 44,
          height: 44,
          fontSize: 25
        }}
      >
        ×
      </button>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          padding: 18,
          borderRadius: 18,
          maxWidth: 430,
          width: '100%',
          textAlign: 'center'
        }}
      >
        <h2 style={{ color: '#111' }}>Shop UPI QR Code</h2>

        <img
          src={src}
          alt="Shop UPI QR code"
          style={{
            display: 'block',
            width: '100%',
            maxHeight: '70vh',
            objectFit: 'contain'
          }}
        />

        <p style={{ color: '#333' }}>
          Scan this QR code using another phone.
        </p>
      </div>
    </div>
  );
}

// ---------------- CUSTOMER BOOKING ----------------

function Booking({ data, go, refresh }) {
  const s = data.settings || {};
  const services = data.services || [];
  const addons = data.addons || [];

  const paymentMode = s.paymentMode || 'upi';
  const razorpayEnabled = Boolean(
    (s.razorpayEnabled || s.razorpayConfigured) &&
    (s.razorpayKeyId || s.razorpayKey)
  );

  const upiAllowed =
    paymentMode === 'upi' || paymentMode === 'both';

  const razorpayAllowed =
    (paymentMode === 'razorpay' || paymentMode === 'both') &&
    razorpayEnabled;

  const bookingFee = getBookingFee(s);

  const [service, setService] = useState(services[0]?.id || '');
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    date: today(),
    time: '10:00',
    transactionId: '',
    email: ''
  });

  const [paymentMethod, setPaymentMethod] = useState(
    paymentMode === 'razorpay' ? 'razorpay' : 'upi'
  );

  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selected = services.find(x => x.id === service);

  const selectedAddons = addons.filter(
    x => selectedAddonIds.includes(x.id)
  );

  const servicePrice = Number(selected?.price || 0);
  const addonTotal = selectedAddons.reduce(
    (sum, x) => sum + Number(x.price || 0),
    0
  );

  // IMPORTANT: Booking fee is independent of service and add-on prices.
  const upiLink = makeUpiLink(s.upiId, s.shopName, bookingFee);

  const slots = Array.from({ length: 24 }, (_, i) =>
    `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  ).filter(t => Number(t.slice(0, 2)) < 21);

  const change = (key, value) => {
    setForm(old => ({ ...old, [key]: value }));
  };

  const toggleAddon = id => {
    setSelectedAddonIds(old =>
      old.includes(id)
        ? old.filter(x => x !== id)
        : [...old, id]
    );
  };

  async function copyUPI() {
    if (!s.upiId || s.upiId === 'yourshop@upi') {
      setErr('Shop UPI ID is not available.');
      return;
    }

    try {
      await navigator.clipboard.writeText(s.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this UPI ID:', s.upiId);
    }
  }

  function openUPI() {
    if (!upiLink) {
      setErr('Shop UPI ID is not configured. Please use the QR code.');
      return;
    }

    window.location.href = upiLink;
  }

  function validateForm() {
    if (!selected) {
      throw new Error('Please select a service.');
    }

    if (!form.name.trim() || !/^[6-9]\d{9}$/.test(form.phone)) {
      throw new Error('Please enter a valid name and 10-digit mobile number.');
    }

    if (!form.date || !form.time) {
      throw new Error('Please select appointment date and time.');
    }

    if (bookingFee < 0 || !Number.isFinite(bookingFee)) {
      throw new Error('Invalid booking fee. Please contact the shop.');
    }

    if (paymentMethod === 'upi') {
      if (!file) {
        throw new Error('Please upload your payment screenshot.');
      }

      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Only PNG, JPG or WEBP screenshots are allowed.');
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Screenshot must be 5 MB or smaller.');
      }
    }

    if (paymentMethod === 'razorpay' && !razorpayAllowed) {
      throw new Error('Razorpay is not currently available. Please contact the shop.');
    }
  }

  const bookingPayload = () => ({
    customerName: form.name.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    date: form.date,
    time: form.time,
    serviceId: service,
    addonIds: selectedAddonIds,
    barber: 'Any available barber'
  });

  async function submitUpi() {
    const fd = new FormData();

    Object.entries({
      ...bookingPayload(),
      addonIds: JSON.stringify(selectedAddonIds),
      transactionId: form.transactionId.trim()
    }).forEach(([key, value]) => {
      fd.append(key, value);
    });

    fd.append('screenshot', file);

    const result = await api('/api/bookings', {
      method: 'POST',
      body: fd
    });

    setCreated(result.booking || result);
    refresh();
  }

  async function submitRazorpay() {
    const loaded = await loadRazorpayScript();

    if (!loaded) {
      throw new Error('Could not load Razorpay Checkout. Please try again.');
    }

    const order = await api('/api/payments/create-order', {
      method: 'POST',
      body: JSON.stringify(bookingPayload())
    });

    if (!order.keyId || !order.orderId) {
      throw new Error('Razorpay order could not be created.');
    }

    // Amount comes from the backend order, which must use saved bookingFee.
    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: s.shopName || 'Barber Shop',
      description: 'Appointment booking fee',
      order_id: order.orderId,

      prefill: {
        name: order.customer?.name || form.name,
        contact: order.customer?.contact || form.phone,
        email: order.customer?.email || form.email
      },

      theme: {
        color: '#b89655'
      },

      handler: async response => {
        try {
          setSubmitting(true);

          const verified = await api('/api/payments/verify', {
            method: 'POST',
            body: JSON.stringify({
              bookingId: order.bookingId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });

          if (!verified.success) {
            throw new Error('Payment could not be verified.');
          }

          setCreated(verified.booking || verified);
          refresh();

        } catch (error) {
          setErr(
            error.message +
            ' If money was deducted, please contact the shop with your payment ID.'
          );
        } finally {
          setSubmitting(false);
        }
      },

      modal: {
        ondismiss: () => {
          setSubmitting(false);
        }
      }
    };

    const checkout = new window.Razorpay(options);

    checkout.on('payment.failed', response => {
      setErr(
        response.error?.description ||
        'Payment failed. Please try again.'
      );
      setSubmitting(false);
    });

    checkout.open();
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');

    try {
      validateForm();
      setSubmitting(true);

      if (paymentMethod === 'razorpay') {
        await submitRazorpay();
      } else {
        await submitUpi();
      }

    } catch (error) {
      setErr(error.message || 'Could not submit booking.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <>
        <Header s={s} go={go} />

        <section className="formwrap">
          <div className="success">
            <div className="successicon">✓</div>
            <span className="eyebrow">BOOKING RECEIVED</span>

            <h1>
              {created.status === 'Confirmed'
                ? "You're confirmed."
                : "You're on the list."}
            </h1>

            <p>Booking ID: <b>{created.id}</b></p>
            <p>Service: <b>{created.service_name}</b></p>

            <p>
              Booking Fee: <b>{money(getPaidBookingFee(created) || bookingFee)}</b>
            </p>

            <p>
              Payment status: <b>{created.payment_status}</b>
            </p>

            {created.token ? (
              <h2>
                Your token: #{String(created.token).padStart(2, '0')}
              </h2>
            ) : (
              <p>Your token will be assigned after payment verification.</p>
            )}

            <button
              className="btn gold"
              onClick={() => go('/receipt/' + created.id)}
            >
              View booking receipt ↗
            </button>

            <a
              className="btn outline"
              target="_blank"
              rel="noreferrer"
              href={wa(
                s.whatsapp,
                `New booking
Booking: ${created.id}
Name: ${created.customer_name}
Phone: ${created.phone}
Service: ${created.service_name}
Date/time: ${created.date} ${created.time}
Booking Fee: ${money(getPaidBookingFee(created) || bookingFee)}
Payment: ${created.payment_status}`
              )}
            >
              <MessageCircle /> Send booking details on WhatsApp
            </a>

            <button className="btn outline" onClick={() => go('/')}>
              Back to home
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Header s={s} go={go} />

      <section className="formwrap">
        <div className="formintro">
          <span className="eyebrow">BOOK ONLINE · SKIP THE WAIT</span>
          <h1>Reserve your <i>chair.</i></h1>
          <p>Choose your service, optional extras and appointment time.</p>
        </div>

        <form className="bookingform" onSubmit={submit}>
          <label>
            Choose service
            <select
              required
              value={service}
              onChange={e => setService(e.target.value)}
            >
              {services.map(x => (
                <option key={x.id} value={x.id}>
                  {x.name} — {money(x.price)} ({x.duration} min)
                </option>
              ))}
            </select>
          </label>

          <div className="two">
            <label>
              Your name
              <input
                required
                value={form.name}
                onChange={e => change('name', e.target.value)}
                placeholder="Full name"
              />
            </label>

            <label>
              Mobile number
              <input
                required
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                maxLength="10"
                value={form.phone}
                onChange={e => change('phone', e.target.value)}
                placeholder="10-digit number"
              />
            </label>
          </div>

          <label>
            Email (Optional)
            <input
              type="email"
              value={form.email}
              onChange={e => change('email', e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <div className="two">
            <label>
              Date
              <input
                required
                type="date"
                min={today()}
                value={form.date}
                onChange={e => change('date', e.target.value)}
              />
            </label>

            <label>
              Time
              <select
                value={form.time}
                onChange={e => change('time', e.target.value)}
              >
                {slots.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>

          {/* OPTIONAL ADD-ONS */}
          <div
            style={{
              border: '1px solid rgba(180,150,90,.35)',
              borderRadius: 14,
              padding: 16,
              margin: '14px 0'
            }}
          >
            <span className="eyebrow">OPTIONAL EXTRAS</span>
            <h2 style={{ margin: '7px 0' }}>Make it a little extra.</h2>
            <p className="fineprint">
              Select only what you want. Add-ons are completely optional.
            </p>

            {addons.length === 0 ? (
              <p className="fineprint">
                No additional services are available right now.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {addons.map(item => {
                  const checked = selectedAddonIds.includes(item.id);

                  return (
                    <label
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: 12,
                        border: '1px solid rgba(180,150,90,.3)',
                        borderRadius: 10,
                        cursor: 'pointer'
                      }}
                    >
                      <span>
                        <b>{item.name}</b>
                        {item.description && (
                          <small style={{ display: 'block' }}>
                            {item.description}
                          </small>
                        )}
                      </span>

                      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <b>{money(item.price)}</b>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAddon(item.id)}
                          style={{ width: 18, height: 18 }}
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* BOOKING FEE ONLY */}
          <div
            style={{
              border: '1px solid rgba(180,150,90,.4)',
              borderRadius: 14,
              padding: 18,
              margin: '14px 0'
            }}
          >
            <span className="eyebrow">BOOKING FEE</span>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 10
            }}>
              <b>Pay now to reserve your chair</b>
              <b style={{ fontSize: 25 }}>{money(bookingFee)}</b>
            </div>
          </div>

          {/* PAYMENT METHOD SELECTION */}
          {paymentMode === 'both' && (
            <div
              style={{
                border: '1px solid rgba(180,150,90,.4)',
                borderRadius: 14,
                padding: 16,
                margin: '14px 0'
              }}
            >
              <span className="eyebrow">SELECT PAYMENT METHOD</span>

              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                {upiAllowed && (
                  <label style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'upi'}
                      onChange={() => setPaymentMethod('upi')}
                    />
                    <span>
                      <b>UPI Payment</b>
                      <small style={{ display: 'block' }}>
                        Scan QR, pay and upload screenshot
                      </small>
                    </span>
                  </label>
                )}

                {razorpayAllowed && (
                  <label style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === 'razorpay'}
                      onChange={() => setPaymentMethod('razorpay')}
                    />
                    <span>
                      <b>Online Payment (Razorpay)</b>
                      <small style={{ display: 'block' }}>
                        Pay securely using supported payment methods
                      </small>
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* UPI PAYMENT */}
          {paymentMethod === 'upi' && upiAllowed && (
            <>
              <div className="paymentbox">
                <div>
                  <span className="eyebrow">UPI BOOKING FEE</span>
                  <h2>{money(bookingFee)} <small>pay now</small></h2>
                </div>

                {s.qrImage ? (
                  <button
                    type="button"
                    onClick={() => setShowQR(true)}
                    title="Tap to enlarge QR code"
                    style={{
                      padding: 0,
                      border: '3px solid #fff',
                      borderRadius: 10,
                      background: '#fff',
                      cursor: 'zoom-in'
                    }}
                  >
                    <img
                      className="qr"
                      src={s.qrImage}
                      alt="Shop UPI QR code"
                    />
                    <span style={{
                      display: 'block',
                      fontSize: 11,
                      padding: 4,
                      color: '#111'
                    }}>
                      <ZoomIn size={12} /> Tap to enlarge
                    </span>
                  </button>
                ) : (
                  <div className="qrplaceholder">QR<br />not added</div>
                )}
              </div>

              {s.upiId && s.upiId !== 'yourshop@upi' && (
                <div
                  style={{
                    border: '1px solid rgba(180,150,90,.4)',
                    borderRadius: 12,
                    padding: 15,
                    margin: '12px 0',
                    display: 'grid',
                    gap: 12
                  }}
                >
                  <div>
                    <span className="eyebrow">PAY USING UPI</span>
                    <p>UPI ID: <b>{s.upiId}</b></p>
                    <small>Booking fee: {money(bookingFee)}</small>
                  </div>

                  <button
                    type="button"
                    className="btn gold"
                    onClick={openUPI}
                  >
                    <Smartphone size={17} /> Pay {money(bookingFee)} using UPI App
                  </button>

                  <button
                    type="button"
                    className="btn outline"
                    onClick={copyUPI}
                  >
                    <Copy size={16} />
                    {copied ? 'UPI ID Copied ✓' : 'Copy UPI ID'}
                  </button>

                  <small>
                    If the UPI app does not open, copy the UPI ID or scan the QR code using another phone.
                  </small>
                </div>
              )}

              <label>
                UPI transaction ID / UTR (Optional)
                <input
                  value={form.transactionId}
                  onChange={e => change('transactionId', e.target.value)}
                  placeholder="Enter UTR only if available"
                />
              </label>

              <label>
                Payment screenshot (Required)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
                <small>Upload successful payment screenshot. Maximum 5 MB.</small>
              </label>

              <p className="fineprint">
                Your booking remains pending until the shop verifies the payment in its UPI/bank account.
              </p>
            </>
          )}

          {/* RAZORPAY PAYMENT */}
          {paymentMethod === 'razorpay' && razorpayAllowed && (
            <div
              className="paymentbox"
              style={{
                display: 'block',
                padding: 18,
                margin: '14px 0'
              }}
            >
              <span className="eyebrow">SECURE ONLINE PAYMENT</span>
              <h2>{money(bookingFee)} <small>booking fee</small></h2>
              <p>
                You will be redirected to Razorpay Checkout to complete your booking fee payment.
                Your booking will be confirmed after the server verifies the payment.
              </p>
            </div>
          )}

          {paymentMode === 'razorpay' && !razorpayAllowed && (
            <p className="error">
              Razorpay is selected by the shop but is not configured yet. Please contact the shop.
            </p>
          )}

          {err && <p className="error">{err}</p>}

          <button
            className="btn gold submit"
            type="submit"
            disabled={
              submitting ||
              !selected ||
              (paymentMethod === 'razorpay' && !razorpayAllowed)
            }
          >
            {submitting
              ? 'Please wait...'
              : paymentMethod === 'razorpay'
                ? `Pay ${money(bookingFee)} with Razorpay ↗`
                : 'Submit booking request ↗'}
          </button>
        </form>
      </section>

      {showQR && (
        <QRViewer
          src={s.qrImage}
          close={() => setShowQR(false)}
        />
      )}
    </>
  );
}

// ---------------- RECEIPT ----------------

function Receipt({ id, settings, go }) {
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/bookings/' + encodeURIComponent(id))
      .then(setBooking)
      .catch(e => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <section className="formwrap">
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!booking) {
    return (
      <section className="formwrap">
        <p>Loading booking…</p>
      </section>
    );
  }

  const bookingFee = getPaidBookingFee(booking);

  const message = `Booking update
${booking.id}
${booking.customer_name}
${booking.service_name}
${booking.date} ${booking.time}
Booking Fee ${money(bookingFee)}
Payment Status ${booking.payment_status}
Booking Status ${booking.status}${booking.token ? '\nToken #' + booking.token : ''}`;

  return (
    <>
      <Header s={settings} go={go} />

      <section className="formwrap">
        <div className="success">
          <span className="eyebrow">BOOKING RECEIPT</span>

          <h1>
            {booking.status === 'Confirmed'
              ? 'Booking confirmed'
              : 'Booking details'}
          </h1>

          <h2>
            {booking.token
              ? `Token #${String(booking.token).padStart(2, '0')}`
              : 'Awaiting payment verification'}
          </h2>

          <p>{booking.id} · {booking.customer_name}</p>
          <p>{booking.service_name} · {booking.date} · {booking.time}</p>

          <p>Booking Fee: <b>{money(bookingFee)}</b></p>
          <p>Payment Status: <b>{booking.payment_status}</b></p>

          <a
            className="btn gold"
            target="_blank"
            rel="noreferrer"
            href={wa(booking.phone, message)}
          >
            <MessageCircle /> WhatsApp update
          </a>

          <button className="btn outline" onClick={() => go('/')}>
            Back to home
          </button>
        </div>
      </section>
    </>
  );
}

// ---------------- ADMIN ----------------

function Admin({
  admin, setAdmin, bookings, reload,
  settings, refresh, go
}) {
  const [token, setToken] = useState(localStorage.bbToken || '');
  const [tab, setTab] = useState('Overview');

  const [login, setLogin] = useState({
    username: 'owner',
    password: ''
  });

  const [err, setErr] = useState('');
  const [services, setServices] = useState([]);
  const [addons, setAddons] = useState([]);
  const [shop, setShop] = useState({
    ...settings,
    bookingFee: settings.bookingFee ??
      settings.booking_fee ??
      settings.advanceFee ??
      50
  });
  const [editService, setEditService] = useState(null);
  const [editAddon, setEditAddon] = useState(null);

  const [serviceForm, setServiceForm] = useState({
    name: '',
    description: '',
    price: '',
    duration: 30,
    category: 'GROOMING'
  });

  const [addonForm, setAddonForm] = useState({
    name: '',
    description: '',
    price: ''
  });

  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const headers = {
    Authorization: 'Bearer ' + token
  };

  useEffect(() => {
    setShop({
      ...settings,
      bookingFee: settings.bookingFee ??
        settings.booking_fee ??
        settings.advanceFee ??
        50
    });
  }, [settings]);

  const loadServices = () => {
    api('/api/public')
      .then(d => setServices(d.services || []))
      .catch(() => {});
  };

  const loadAddons = () => {
    api('/api/admin/addons', { headers })
      .then(setAddons)
      .catch(e => setErr(e.message));
  };

  useEffect(() => {
    if (!admin) return;
    loadServices();
    loadAddons();
  }, [admin, tab]);

  async function saveService(e) {
    e.preventDefault();
    setErr('');

    try {
      await api(
        editService
          ? '/api/admin/services/' + editService
          : '/api/admin/services',
        {
          method: editService ? 'PUT' : 'POST',
          headers,
          body: JSON.stringify(serviceForm)
        }
      );

      setEditService(null);
      setServiceForm({
        name: '',
        description: '',
        price: '',
        duration: 30,
        category: 'GROOMING'
      });

      loadServices();
      refresh();
      setErr('Service saved successfully.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveAddon(e) {
    e.preventDefault();
    setErr('');

    try {
      await api(
        editAddon
          ? '/api/admin/addons/' + editAddon
          : '/api/admin/addons',
        {
          method: editAddon ? 'PUT' : 'POST',
          headers,
          body: JSON.stringify(addonForm)
        }
      );

      setEditAddon(null);
      setAddonForm({
        name: '',
        description: '',
        price: ''
      });

      loadAddons();
      refresh();
      setErr('Add-on saved successfully.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function deleteAddon(item) {
    if (!confirm(`Remove ${item.name} from customer options?`)) return;

    try {
      await api('/api/admin/addons/' + item.id, {
        method: 'DELETE',
        headers
      });

      loadAddons();
      refresh();
      setErr('Add-on removed successfully.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function upload(kind, file) {
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErr('Only PNG, JPG or WEBP images are allowed.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErr('Image size must be 5 MB or less.');
      return;
    }

    const fd = new FormData();
    fd.append('image', file);
    fd.append('kind', kind);

    try {
      const result = await api('/api/admin/upload', {
        method: 'POST',
        headers,
        body: fd
      });

      const key = kind === 'qr' ? 'qrImage' : 'logoImage';

      const saved = await api('/api/admin/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ [key]: result.url })
      });

      const savedSettings = saved.settings || saved;

      setShop(old => ({
        ...old,
        ...savedSettings,
        bookingFee: savedSettings.bookingFee ??
          savedSettings.booking_fee ??
          savedSettings.advanceFee ??
          old.bookingFee ??
          50
      }));

      refresh();
      setErr('Image uploaded successfully.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);

    try {
      const fee = Number(shop.bookingFee);

      if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
        throw new Error('Booking fee must be between ₹0 and ₹10,000.');
      }

      const normalized = {
        ...shop,
        phone: String(shop.phone || '').replace(/\D/g, ''),
        whatsapp: String(shop.whatsapp || '').replace(/\D/g, ''),
        bookingFee: String(fee)
      };

      // bookingFee is the new authoritative setting.
      const saved = await api('/api/admin/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify(normalized)
      });

      const savedSettings = saved.settings || saved;

      setShop({
        ...savedSettings,
        bookingFee: savedSettings.bookingFee ??
          savedSettings.booking_fee ??
          fee
      });

      refresh();
      setErr('Settings saved successfully.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function bookingAction(id, kind) {
    try {
      await api('/api/admin/bookings/' + id + '/' + kind, {
        method: 'POST',
        headers
      });

      reload();
      setErr(kind === 'approve'
        ? 'Payment approved and token assigned.'
        : 'Payment rejected.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function updateStatus(id, value) {
    try {
      await api('/api/admin/bookings/' + id + '/status', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: value })
      });

      reload();
      setErr('Booking status updated.');
    } catch (e) {
      setErr(e.message);
    }
  }

  if (!admin) {
    return (
      <section className="loginwrap">
        <form
          className="login"
          onSubmit={async e => {
            e.preventDefault();

            try {
              const result = await api('/api/admin/login', {
                method: 'POST',
                body: JSON.stringify(login)
              });

              localStorage.bbToken = result.token;
              setToken(result.token);
              setAdmin(true);
              setErr('');
            } catch (e) {
              setErr(e.message);
            }
          }}
        >
          <div className="brandicon"><Scissors /></div>
          <span className="eyebrow">OWNER ACCESS</span>
          <h1>Shop <i>admin.</i></h1>

          <label>
            Username
            <input
              value={login.username}
              onChange={e => setLogin({
                ...login,
                username: e.target.value
              })}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={login.password}
              onChange={e => setLogin({
                ...login,
                password: e.target.value
              })}
            />
          </label>

          {err && <p className="error">{err}</p>}

          <button className="btn gold submit">Sign in securely</button>

          <button
            type="button"
            className="backlink"
            onClick={() => go('/')}
          >
            ← Back to website
          </button>

          <p className="fineprint">
            Change the default admin password before launch.
          </p>
        </form>
      </section>
    );
  }

  const todayBookings = bookings.filter(b => b.date === today());

  const pending = bookings.filter(
    b => b.payment_status === 'Pending Verification'
  );

  const filtered = bookings.filter(b =>
    `${b.customer_name} ${b.phone} ${b.id}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  const message = b => {
    const addons = parseAddons(b);

    return `Booking ${b.id}
Customer: ${b.customer_name}
Phone: ${b.phone}
Service: ${b.service_name}
Add-ons: ${addons.map(x => x.name).join(', ') || 'None'}
Date/time: ${b.date} ${b.time}
Booking Fee: ${money(getPaidBookingFee(b))}
Payment: ${b.payment_status}${b.token ? '\nToken: #' + b.token : ''}`;
  };

  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="sidebrand"><Scissors /> BARBERBOOK</div>
        <small>SHOP WORKSPACE</small>

        {[
          'Overview',
          'Bookings',
          'Services',
          'Add-ons',
          'Payments',
          'Shop Settings'
        ].map(item => (
          <button
            key={item}
            className={tab === item ? 'selected' : ''}
            onClick={() => setTab(item)}
          >
            {item === 'Overview' ? '▦' :
              item === 'Bookings' ? '▤' :
              item === 'Services' ? '✂' :
              item === 'Add-ons' ? '+' :
              item === 'Payments' ? '₹' : '⚙'}
            {'　'}{item}
            {item === 'Payments' && pending.length
              ? ` (${pending.length})`
              : ''}
          </button>
        ))}

        <button
          className="logout"
          onClick={() => {
            localStorage.removeItem('bbToken');
            setToken('');
            setAdmin(false);
          }}
        >
          <LogOut /> Sign out
        </button>
      </aside>

      <main className="adminmain">
        <div className="adminhead">
          <div>
            <span className="eyebrow">SHOP MANAGEMENT</span>
            <h1>{tab}</h1>
          </div>

          <div>
            <button
              className="btn outline"
              onClick={() => {
                reload();
                refresh();
                loadServices();
                loadAddons();
              }}
            >
              <RefreshCw size={15} /> Refresh
            </button>
            {' '}
            <button className="btn" onClick={() => go('/')}>
              View website ↗
            </button>
          </div>
        </div>

        {err && (
          <p className={
            err.toLowerCase().includes('success') ||
            err.toLowerCase().includes('approved') ||
            err.toLowerCase().includes('updated') ||
            err.toLowerCase().includes('removed') ||
            err.toLowerCase().includes('deleted')
              ? 'notice'
              : 'error'
          }>
            {err}
          </p>
        )}

        {/* OVERVIEW */}
        {tab === 'Overview' && (
          <>
            <div className="stats">
              <div>
                <span>Today's bookings</span>
                <b>{todayBookings.length}</b>
              </div>
              <div>
                <span>UPI payment pending</span>
                <b>{pending.length}</b>
              </div>
              <div>
                <span>Confirmed bookings</span>
                <b>{bookings.filter(b => b.status === 'Confirmed').length}</b>
              </div>
              <div>
                <span>Booking fees collected</span>
                <b>
                  {money(
                    bookings
                      .filter(b => b.payment_status === 'Approved')
                      .reduce((sum, b) => sum + getPaidBookingFee(b), 0)
                  )}
                </b>
              </div>
            </div>

            <div className="panel">
              <h2>Today's appointments</h2>
              <BookingTable
                rows={todayBookings}
                action={bookingAction}
                status={updateStatus}
                msg={message}
                settings={shop}
              />
            </div>

            <div className="panel">
              <h2>UPI payment verification required</h2>
              <BookingTable
                rows={pending}
                action={bookingAction}
                status={updateStatus}
                msg={message}
                settings={shop}
              />
            </div>
          </>
        )}

        {/* BOOKINGS AND PAYMENTS */}
        {(tab === 'Bookings' || tab === 'Payments') && (
          <div className="panel">
            <div className="paneltop">
              <h2>
                {tab === 'Payments'
                  ? 'Verify UPI payments'
                  : 'All appointments'}
              </h2>

              <input
                placeholder="Search customer, phone, booking ID"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <BookingTable
              rows={
                tab === 'Payments'
                  ? filtered.filter(b => b.payment_status === 'Pending Verification')
                  : filtered
              }
              action={bookingAction}
              status={updateStatus}
              msg={message}
              settings={shop}
            />
          </div>
        )}

        {/* SERVICES */}
        {tab === 'Services' && (
          <div className="panel">
            <h2>{editService ? 'Edit service' : 'Add a service'}</h2>

            <form className="serviceform" onSubmit={saveService}>
              <label>
                Service name
                <input
                  required
                  value={serviceForm.name}
                  onChange={e => setServiceForm({
                    ...serviceForm,
                    name: e.target.value
                  })}
                />
              </label>

              <label>
                Price (₹)
                <input
                  required
                  type="number"
                  min="0"
                  value={serviceForm.price}
                  onChange={e => setServiceForm({
                    ...serviceForm,
                    price: e.target.value
                  })}
                />
              </label>

              <label>
                Duration (min)
                <input
                  type="number"
                  min="5"
                  value={serviceForm.duration}
                  onChange={e => setServiceForm({
                    ...serviceForm,
                    duration: e.target.value
                  })}
                />
              </label>

              <label>
                Category
                <input
                  value={serviceForm.category}
                  onChange={e => setServiceForm({
                    ...serviceForm,
                    category: e.target.value
                  })}
                />
              </label>

              <label className="wide">
                Description
                <input
                  value={serviceForm.description}
                  onChange={e => setServiceForm({
                    ...serviceForm,
                    description: e.target.value
                  })}
                />
              </label>

              <button className="btn gold">
                {editService ? 'Save changes' : 'Add service'}
              </button>

              {editService && (
                <button
                  type="button"
                  className="btn outline"
                  onClick={() => {
                    setEditService(null);
                    setServiceForm({
                      name: '',
                      description: '',
                      price: '',
                      duration: 30,
                      category: 'GROOMING'
                    });
                  }}
                >
                  Cancel
                </button>
              )}
            </form>

            <div className="servicelist">
              {services.map(item => (
                <div className="servicerow" key={item.id}>
                  <div>
                    <b>{item.name}</b>
                    <small>{item.description} · {item.duration} min</small>
                  </div>

                  <strong>{money(item.price)}</strong>

                  <button
                    title="Edit service"
                    onClick={() => {
                      setEditService(item.id);
                      setServiceForm({
                        name: item.name,
                        description: item.description,
                        price: item.price,
                        duration: item.duration,
                        category: item.category
                      });
                    }}
                  >
                    <Edit2 />
                  </button>

                  <button
                    title="Delete service"
                    onClick={async () => {
                      if (!confirm(`Delete ${item.name}?`)) return;

                      try {
                        await api(
                          '/api/admin/services/' + item.id,
                          { method: 'DELETE', headers }
                        );

                        loadServices();
                        refresh();
                        setErr('Service deleted.');
                      } catch (e) {
                        setErr(e.message);
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ADD-ONS */}
        {tab === 'Add-ons' && (
          <div className="panel">
            <h2>{editAddon ? 'Edit optional add-on' : 'Create optional add-on'}</h2>

            <p className="fineprint">
              Customers can select these extras during booking. They are never compulsory.
            </p>

            <form className="serviceform" onSubmit={saveAddon}>
              <label>
                Add-on name
                <input
                  required
                  value={addonForm.name}
                  placeholder="Example: Beard Trim"
                  onChange={e => setAddonForm({
                    ...addonForm,
                    name: e.target.value
                  })}
                />
              </label>

              <label>
                Add-on price (₹)
                <input
                  required
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  value={addonForm.price}
                  placeholder="50"
                  onChange={e => setAddonForm({
                    ...addonForm,
                    price: e.target.value
                  })}
                />
              </label>

              <label className="wide">
                Description
                <input
                  value={addonForm.description}
                  placeholder="Optional description"
                  onChange={e => setAddonForm({
                    ...addonForm,
                    description: e.target.value
                  })}
                />
              </label>

              <button className="btn gold">
                {editAddon ? 'Update add-on' : 'Add optional service'}
              </button>

              {editAddon && (
                <button
                  type="button"
                  className="btn outline"
                  onClick={() => {
                    setEditAddon(null);
                    setAddonForm({
                      name: '',
                      description: '',
                      price: ''
                    });
                  }}
                >
                  Cancel
                </button>
              )}
            </form>

            <div className="servicelist">
              <h2>Customer add-on options</h2>

              {addons.length === 0 && (
                <p className="empty">
                  No add-ons created yet. Add your first optional service above.
                </p>
              )}

              {addons.map(item => (
                <div className="servicerow" key={item.id}>
                  <div>
                    <b>{item.name}</b>
                    <small>{item.description || 'Optional extra service'}</small>
                  </div>

                  <strong>{money(item.price)}</strong>

                  <button
                    title="Edit add-on"
                    onClick={() => {
                      setEditAddon(item.id);
                      setAddonForm({
                        name: item.name,
                        description: item.description || '',
                        price: item.price
                      });
                    }}
                  >
                    <Edit2 />
                  </button>

                  <button
                    title="Deactivate add-on"
                    onClick={() => deleteAddon(item)}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SHOP SETTINGS */}
        {tab === 'Shop Settings' && (
          <div className="panel">
            <h2>Business profile & booking rules</h2>

            <form className="settingsform" onSubmit={saveSettings}>
              <label>
                Shop name
                <input
                  value={shop.shopName || ''}
                  onChange={e => setShop({
                    ...shop,
                    shopName: e.target.value
                  })}
                />
              </label>

              <label>
                Tagline
                <input
                  value={shop.tagline || ''}
                  onChange={e => setShop({
                    ...shop,
                    tagline: e.target.value
                  })}
                />
              </label>

              <label>
                Address
                <input
                  value={shop.address || ''}
                  onChange={e => setShop({
                    ...shop,
                    address: e.target.value
                  })}
                />
              </label>

              <label>
                Phone
                <input
                  value={shop.phone || ''}
                  onChange={e => setShop({
                    ...shop,
                    phone: e.target.value
                  })}
                />
              </label>

              <label>
                WhatsApp number (country code + number)
                <input
                  value={shop.whatsapp || ''}
                  onChange={e => setShop({
                    ...shop,
                    whatsapp: e.target.value
                  })}
                  placeholder="919876543210"
                />
              </label>

              <label>
                Opening hours
                <input
                  value={shop.hours || ''}
                  onChange={e => setShop({
                    ...shop,
                    hours: e.target.value
                  })}
                />
              </label>

              <label>
                UPI ID (Optional)
                <input
                  value={shop.upiId || ''}
                  onChange={e => setShop({
                    ...shop,
                    upiId: e.target.value
                  })}
                  placeholder="yourname@upi"
                />
              </label>

              <label>
                Default Booking Fee (₹)
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  value={shop.bookingFee ?? 50}
                  onChange={e => setShop({
                    ...shop,
                    bookingFee: e.target.value
                  })}
                />
                <small>
                  Customer pays only this fixed amount online to reserve an appointment. Service and add-on prices do not increase this fee.
                </small>
              </label>

              <label>
                Max bookings per time slot
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={shop.maxBookingsPerSlot || 3}
                  onChange={e => setShop({
                    ...shop,
                    maxBookingsPerSlot: e.target.value
                  })}
                />
              </label>

              {/* PAYMENT MODE */}
              <div className="uploadbox">
                <b>Customer payment mode</b>

                <select
                  value={shop.paymentMode || 'upi'}
                  onChange={e => setShop({
                    ...shop,
                    paymentMode: e.target.value
                  })}
                >
                  <option value="upi">UPI Only</option>
                  <option
                    value="razorpay"
                    disabled={!shop.razorpayConfigured}
                  >
                    Razorpay Only
                  </option>
                  <option
                    value="both"
                    disabled={!shop.razorpayConfigured}
                  >
                    Both UPI + Razorpay
                  </option>
                </select>

                <small>
                  Default mode is UPI Only. Razorpay options become available after the server has valid Razorpay keys in its .env file.
                </small>

                <p>
                  Razorpay configuration:{' '}
                  <b>
                    {shop.razorpayConfigured
                      ? 'Configured'
                      : 'Not configured'}
                  </b>
                </p>
              </div>

              <div className="uploadbox">
                <b>Shop UPI QR code</b>

                {shop.qrImage && (
                  <img className="qr" src={shop.qrImage} alt="Shop UPI QR" />
                )}

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => upload('qr', e.target.files?.[0])}
                />

                <small>PNG/JPG/WEBP · max 5 MB</small>
              </div>

              <div className="uploadbox">
                <b>Shop logo</b>

                {shop.logoImage && (
                  <img
                    className="logoPreview"
                    src={shop.logoImage}
                    alt="Shop logo"
                  />
                )}

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => upload('logo', e.target.files?.[0])}
                />
              </div>

              <button className="btn gold" disabled={saving}>
                {saving ? 'Saving...' : 'Save all shop settings'}
              </button>
            </form>

            <p className="fineprint">
              Never enter Razorpay Secret Key in this form. Configure it only in the server .env file.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------- BOOKING TABLE ----------------

function BookingTable({ rows, action, status, msg, settings }) {
  if (!rows.length) {
    return <p className="empty">No bookings to show.</p>;
  }

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Service & add-ons</th>
            <th>Booking Fee</th>
            <th>Payment</th>
            <th>Token / status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {rows.map(b => {
            const addons = parseAddons(b);

            return (
              <tr key={b.id}>
                <td>
                  <b>{b.customer_name}</b>
                  <small>{b.phone}<br />{b.id}</small>
                </td>

                <td>
                  {b.service_name}
                  {addons.map(item => (
                    <small key={item.id}>
                      + {item.name}
                    </small>
                  ))}
                  <small>{b.date} · {b.time}</small>
                </td>

                <td>
                  <b>{money(getPaidBookingFee(b))}</b>
                </td>

                <td>
                  <b className={
                    'pill ' +
                    (b.payment_status === 'Approved'
                      ? 'green'
                      : b.payment_status === 'Rejected'
                        ? 'red'
                        : 'yellow')
                  }>
                    {b.payment_status}
                  </b>

                  <small>
                    Method: {b.payment_method === 'razorpay' ? 'Razorpay' : 'UPI'}
                  </small>

                  {b.transaction_id && (
                    <small>UTR: {b.transaction_id}</small>
                  )}

                  {b.razorpay_payment_id && (
                    <small>Payment ID: {b.razorpay_payment_id}</small>
                  )}

                  {b.payment_screenshot && (
                    <ProofButton filename={b.id} />
                  )}
                </td>

                <td>
                  {b.token
                    ? '#' + String(b.token).padStart(2, '0')
                    : '—'}
                  <small>{b.status}</small>
                </td>

                <td>
                  <div className="actions">
                    {b.payment_status === 'Pending Verification' && (
                      <>
                        <button
                          className="approve"
                          title="Approve after checking bank"
                          onClick={() => action(b.id, 'approve')}
                        >
                          <Check />
                        </button>

                        <button
                          className="reject"
                          title="Reject"
                          onClick={() => action(b.id, 'reject')}
                        >
                          <X />
                        </button>
                      </>
                    )}

                    <a
                      title="WhatsApp shop"
                      target="_blank"
                      rel="noreferrer"
                      href={wa(settings.whatsapp, msg(b))}
                    >
                      <MessageCircle />
                    </a>

                    <a
                      title="WhatsApp customer"
                      target="_blank"
                      rel="noreferrer"
                      href={wa(b.phone, msg(b))}
                    >
                      <Phone />
                    </a>

                    {b.payment_status === 'Approved' && (
                      <select
                        value={b.status}
                        onChange={e => status(b.id, e.target.value)}
                      >
                        <option value="Confirmed">Confirmed</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- PAYMENT PROOF ----------------

function ProofButton({ filename }) {
  return (
    <button
      className="proofbutton"
      onClick={async () => {
        const win = window.open('about:blank', '_blank');

        try {
          const response = await fetch(
            '/api/admin/payment-proof/' + encodeURIComponent(filename),
            {
              headers: {
                Authorization: 'Bearer ' + localStorage.bbToken
              }
            }
          );

          if (!response.ok) {
            throw Error('Unable to load payment proof.');
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);

          if (win) win.location = url;
          else window.location.href = url;

        } catch (e) {
          if (win) win.close();
          alert(e.message);
        }
      }}
    >
      View payment proof ↗
    </button>
  );
}
