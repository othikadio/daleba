/**
 * DALEBA Booking — Frontend JS
 * Système de réservation multi-step, mobile-first
 */

const API = '/api/booking';
const state = {
  businessId: null,
  step: 1,
  service: null,
  staff: null,
  date: null,
  time: null,
  weekOffset: 0,
};

// ─── INIT ─────────────────────────────────────────────────────────

async function init() {
  // Résolution du business depuis le subdomain ou query param
  const params = new URLSearchParams(window.location.search);
  const bizParam = params.get('business') || params.get('b');
  if (bizParam) {
    document.cookie = `business=${bizParam}; path=/`;
  }

  try {
    const res = await fetch(`${API}/info`, { headers: businessHeader() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const biz = data.business;
    document.getElementById('businessName').textContent = biz.name;
    document.getElementById('businessAddress').textContent = biz.address || '';
    document.getElementById('businessAvatar').textContent = biz.name.charAt(0).toUpperCase();
    document.title = `Réservation — ${biz.name}`;

    loadServices().then(() => {
      // Pré-sélection depuis ?forfait=...&service=...
      const p = new URLSearchParams(window.location.search);
      const preService = p.get('service');
      const preLabel   = p.get('forfait');
      if (preService) {
        // Attendre que les cards soient rendues puis cliquer sur le bon service
        setTimeout(() => {
          const card = document.querySelector(`.service-card[data-id="${preService}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('highlighted');
            // Auto-sélect après 600ms pour laisser le client voir la sélection
            setTimeout(() => card.click(), 600);
          }
        }, 300);
      }
    });
  } catch (err) {
    showError('Impossible de charger le salon. Vérifiez le lien.');
  }
}

// ─── STEP 1 : SERVICES ────────────────────────────────────────────

async function loadServices() {
  try {
    const res = await fetch(`${API}/services`, { headers: businessHeader() });
    const data = await res.json();

    const container = document.getElementById('servicesList');
    container.innerHTML = '';

    // Groupe par catégorie
    const categories = {};
    for (const svc of data.services) {
      const cat = svc.category || 'Services';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(svc);
    }

    for (const [cat, services] of Object.entries(categories)) {
      if (Object.keys(categories).length > 1) {
        const lbl = document.createElement('div');
        lbl.className = 'category-label';
        lbl.textContent = cat;
        container.appendChild(lbl);
      }
      for (const svc of services) {
        container.appendChild(serviceCard(svc));
      }
    }
  } catch (err) {
    showError('Erreur chargement services');
  }
}

function serviceCard(svc) {
  const el = document.createElement('div');
  el.className = 'service-card';
  el.dataset.id = svc.id;
  el.innerHTML = `
    <div class="service-info">
      <h3>${svc.name}</h3>
      <p>${svc.description || `${svc.duration_min} min`}</p>
    </div>
    <div class="service-price">
      <div class="price">${svc.price > 0 ? '$' + Number(svc.price).toFixed(0) : 'Gratuit'}</div>
      <div class="duration">${svc.duration_min} min</div>
    </div>
  `;
  el.addEventListener('click', () => selectService(svc));
  return el;
}

function selectService(svc) {
  state.service = svc;
  document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.service-card[data-id="${svc.id}"]`)?.classList.add('selected');
  setTimeout(() => goStep(2), 200);
}

// ─── STEP 2 : STAFF ───────────────────────────────────────────────

async function loadStaff() {
  try {
    const res = await fetch(`${API}/staff?serviceId=${state.service.id}`, { headers: businessHeader() });
    const data = await res.json();

    const container = document.getElementById('staffList');
    container.innerHTML = '';

    // Option "Peu importe"
    const anyEl = document.createElement('div');
    anyEl.className = 'staff-card';
    anyEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        <div class="staff-avatar" style="background:#9ca3af;font-size:20px">🎲</div>
        <div>
          <div class="staff-name">Peu importe</div>
          <div class="staff-role">Premier disponible</div>
        </div>
      </div>
    `;
    anyEl.addEventListener('click', () => selectStaff(null, anyEl));
    container.appendChild(anyEl);

    for (const s of data.staff) {
      const el = document.createElement('div');
      el.className = 'staff-card';
      el.dataset.id = s.id;
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px">
          <div class="staff-avatar" style="background:${s.color || '#6366f1'}">${s.name.charAt(0)}</div>
          <div>
            <div class="staff-name">${s.name}</div>
            <div class="staff-role">${s.role_title || 'Coiffeur'}</div>
          </div>
        </div>
      `;
      el.addEventListener('click', () => selectStaff(s, el));
      container.appendChild(el);
    }
  } catch (err) {
    showError('Erreur chargement coiffeurs');
  }
}

function selectStaff(staff, el) {
  state.staff = staff;
  document.querySelectorAll('.staff-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  setTimeout(() => goStep(3), 200);
}

// ─── STEP 3 : DATE & SLOTS ────────────────────────────────────────

function renderDatePicker() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + state.weekOffset * 7);
  // Lundi de la semaine
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diff);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  document.getElementById('dateRangeLabel').textContent =
    weekStart.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' }) + ' – ' +
    weekEnd.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });

  const container = document.getElementById('dateDays');
  container.innerHTML = '';

  const dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const isPast = d < new Date(new Date().toDateString());
    const dateStr = d.toISOString().slice(0, 10);

    const el = document.createElement('div');
    el.className = 'date-day' + (isPast ? ' disabled' : '') + (state.date === dateStr ? ' selected' : '');
    el.innerHTML = `<span class="day-name">${dayLabels[i]}</span><span class="day-num">${d.getDate()}</span>`;

    if (!isPast) {
      el.addEventListener('click', () => selectDate(dateStr));
    }
    container.appendChild(el);
  }
}

function selectDate(dateStr) {
  state.date = dateStr;
  state.time = null;
  document.querySelectorAll('.date-day').forEach(d => d.classList.remove('selected'));
  document.querySelectorAll('.date-day').forEach(d => {
    if (d.querySelector('.day-num') && dateStr.endsWith('-' + d.querySelector('.day-num').textContent.padStart(2, '0'))) {
      // Match by full date instead
    }
  });
  renderDatePicker(); // Re-render to show selected
  loadSlots(dateStr);
}

async function loadSlots(date) {
  const slotsSection = document.getElementById('slotsSection');
  const slotsList = document.getElementById('slotsList');

  slotsSection.classList.remove('hidden');
  slotsList.innerHTML = '<div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div>';

  document.getElementById('slotsTitle').textContent =
    new Date(date + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

  if (!state.staff) {
    // Pas de staff sélectionné — prend le premier disponible
    await loadFirstAvailableSlots(date);
    return;
  }

  try {
    const res = await fetch(
      `${API}/slots?staffId=${state.staff.id}&serviceId=${state.service.id}&date=${date}`,
      { headers: businessHeader() }
    );
    const data = await res.json();
    renderSlots(data.slots || []);
  } catch (err) {
    slotsList.innerHTML = '<p class="no-slots">Erreur chargement créneaux</p>';
  }
}

async function loadFirstAvailableSlots(date) {
  try {
    // Récupère le staff et prend le premier qui a des slots
    const res = await fetch(`${API}/staff?serviceId=${state.service.id}`, { headers: businessHeader() });
    const data = await res.json();

    for (const s of data.staff) {
      const r = await fetch(
        `${API}/slots?staffId=${s.id}&serviceId=${state.service.id}&date=${date}`,
        { headers: businessHeader() }
      );
      const d = await r.json();
      if (d.slots && d.slots.length > 0) {
        state.staff = s; // Assigne le staff automatiquement
        renderSlots(d.slots);
        return;
      }
    }
    renderSlots([]);
  } catch (err) {
    document.getElementById('slotsList').innerHTML = '<p class="no-slots">Erreur chargement créneaux</p>';
  }
}

function renderSlots(slots) {
  const container = document.getElementById('slotsList');
  container.innerHTML = '';

  if (!slots.length) {
    container.innerHTML = '<p class="no-slots">Aucun créneau disponible ce jour</p>';
    return;
  }

  for (const slot of slots) {
    const btn = document.createElement('button');
    btn.className = 'slot-btn' + (state.time === slot.time ? ' selected' : '');
    btn.textContent = slot.time;
    btn.addEventListener('click', () => selectSlot(slot.time));
    container.appendChild(btn);
  }
}

function selectSlot(time) {
  state.time = time;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.slot-btn').forEach(b => {
    if (b.textContent === time) b.classList.add('selected');
  });
  setTimeout(() => goStep(4), 200);
}

// ─── STEP 4 : CLIENT INFO ─────────────────────────────────────────

function renderSummary() {
  const dateFormatted = new Date(state.date + 'T12:00:00').toLocaleDateString('fr-CA', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  document.getElementById('bookingSummary').innerHTML = `
    <strong>📋 Récapitulatif</strong><br>
    ${state.service.name} — <strong>${state.time}</strong>, ${dateFormatted}
    ${state.staff ? `<br>avec <strong>${state.staff.name}</strong>` : ''}
  `;
}

document.getElementById('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Réservation en cours...';

  const body = {
    staffId: state.staff?.id || 1,
    serviceId: state.service.id,
    date: state.date,
    time: state.time,
    clientName: document.getElementById('clientName').value,
    clientPhone: document.getElementById('clientPhone').value,
    clientEmail: document.getElementById('clientEmail').value,
    notes: document.getElementById('clientNotes').value,
  };

  try {
    const res = await fetch(`${API}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...businessHeader() },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = 'Confirmer mon RDV →';
      showError(data.error || 'Erreur lors de la réservation');
      return;
    }

    // Confirmation
    const appt = data.appointment;
    const dateStr = new Date(appt.startTime).toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });

    document.getElementById('confirmCard').innerHTML = `
      <div class="confirm-row"><span>Service</span><span>${appt.service}</span></div>
      <div class="confirm-row"><span>Date</span><span>${dateStr}</span></div>
      <div class="confirm-row"><span>Nom</span><span>${appt.clientName}</span></div>
      <div class="confirm-row"><span>Statut</span><span>✅ Confirmé</span></div>
    `;

    goStep(5);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirmer mon RDV →';
    showError('Erreur réseau. Réessayez.');
  }
});

// ─── NAVIGATION ───────────────────────────────────────────────────

function goStep(n) {
  document.querySelectorAll('.step-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`step-${n}`).classList.remove('hidden');

  document.querySelectorAll('.step').forEach(s => {
    const num = parseInt(s.dataset.step);
    s.classList.remove('active', 'done');
    if (num === n) s.classList.add('active');
    if (num < n) s.classList.add('done');
  });

  state.step = n;

  if (n === 2) loadStaff();
  if (n === 3) renderDatePicker();
  if (n === 4) renderSummary();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Date navigation
document.getElementById('prevWeek').addEventListener('click', () => {
  if (state.weekOffset > 0) {
    state.weekOffset--;
    state.date = null;
    document.getElementById('slotsSection').classList.add('hidden');
    renderDatePicker();
  }
});
document.getElementById('nextWeek').addEventListener('click', () => {
  if (state.weekOffset < 8) {
    state.weekOffset++;
    state.date = null;
    document.getElementById('slotsSection').classList.add('hidden');
    renderDatePicker();
  }
});

// ─── HELPERS ──────────────────────────────────────────────────────

function businessHeader() {
  const params = new URLSearchParams(window.location.search);
  const biz = params.get('business') || params.get('b') || '';
  return biz ? { 'X-Business-ID': biz } : {};
}

function showError(msg) {
  const existing = document.getElementById('error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'error-toast';
  toast.style.cssText = `
    position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:#ef4444;color:white;padding:12px 20px;border-radius:8px;
    font-size:14px;font-weight:500;z-index:999;max-width:90%;text-align:center;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── START ────────────────────────────────────────────────────────
init();
