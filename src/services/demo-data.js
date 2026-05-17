/**
 * DALEBA — Données de démonstration pour Kadio Coiffure
 * Utilisées quand MODE=demo ou pas de DATABASE_URL
 */

const DEMO_BUSINESS = {
  id: 1,
  name: 'Kadio Coiffure',
  address: '615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone: '+1 (450) 555-0123',
  email: 'contact@kadiocoiffure.ca',
  website: 'https://kadiocoiffure.ca',
  logo_url: null,
  settings: { currency: 'CAD', timezone: 'America/Toronto' },
};

const DEMO_SERVICES = [
  { id: 1, name: 'Coupe Homme', description: 'Coupe classique + finitions', duration_min: 30, price: 25, category: 'Coupe' },
  { id: 2, name: 'Coupe Femme', description: 'Coupe + brushing', duration_min: 60, price: 55, category: 'Coupe' },
  { id: 3, name: 'Coupe Enfant', description: 'Coupe pour moins de 12 ans', duration_min: 20, price: 18, category: 'Coupe' },
  { id: 4, name: 'Tresses Africaines', description: 'Tresses traditionnelles', duration_min: 180, price: 120, category: 'Tresses' },
  { id: 5, name: 'Extensions', description: 'Pose d\'extensions naturelles', duration_min: 240, price: 180, category: 'Extensions' },
  { id: 6, name: 'Coloration', description: 'Coloration complète + soin', duration_min: 120, price: 95, category: 'Coloration' },
  { id: 7, name: 'Lissage Brésilien', description: 'Lissage kératine longue durée', duration_min: 180, price: 160, category: 'Lissage' },
  { id: 8, name: 'Soin Hydratant', description: 'Masque + soin profond', duration_min: 45, price: 40, category: 'Soin' },
];

const DEMO_STAFF = [
  { id: 1, name: 'Ulrich Kadio', role_title: 'Directeur & Coiffeur', color: '#10b981', avatar_url: null, services: [1,2,3,4,5,6,7,8] },
  { id: 2, name: 'Marie-Claire', role_title: 'Coiffeuse Senior', color: '#6366f1', avatar_url: null, services: [1,2,3,6,7,8] },
  { id: 3, name: 'Aminata Diallo', role_title: 'Spécialiste Tresses', color: '#f59e0b', avatar_url: null, services: [4,5,8] },
];

// Générer des créneaux disponibles pour une journée
function generateSlots(date, staffId) {
  const slots = [];
  const hours = [9, 10, 11, 14, 15, 16, 17];
  hours.forEach(h => {
    slots.push({
      time: `${String(h).padStart(2, '0')}:00`,
      available: Math.random() > 0.3, // 70% disponibles
    });
    if (h < 17) {
      slots.push({
        time: `${String(h).padStart(2, '0')}:30`,
        available: Math.random() > 0.3,
      });
    }
  });
  return slots;
}

// Store RDV en mémoire
const demoAppointments = [];
let apptCounter = 100;

function createDemoAppointment({ businessId, staffId, serviceId, clientName, clientPhone, clientEmail, date, time, notes }) {
  const service = DEMO_SERVICES.find(s => s.id === parseInt(serviceId));
  const staff = DEMO_STAFF.find(s => s.id === parseInt(staffId));
  const appt = {
    id: ++apptCounter,
    business_id: businessId,
    staff_id: staffId,
    service_id: serviceId,
    client_name: clientName,
    client_phone: clientPhone,
    client_email: clientEmail,
    service_name: service?.name || 'Service',
    staff_name: staff?.name || 'Coiffeur',
    business_name: DEMO_BUSINESS.name,
    business_address: DEMO_BUSINESS.address,
    business_phone: DEMO_BUSINESS.phone,
    start_time: `${date}T${time}:00`,
    end_time: `${date}T${String(parseInt(time.split(':')[0]) + Math.ceil((service?.duration_min || 30) / 60)).padStart(2,'0')}:${time.split(':')[1]}:00`,
    price: service?.price || 0,
    status: 'confirmed',
    notes,
    created_at: new Date(),
  };
  demoAppointments.push(appt);
  return appt;
}

module.exports = {
  DEMO_BUSINESS,
  DEMO_SERVICES,
  DEMO_STAFF,
  generateSlots,
  createDemoAppointment,
  demoAppointments,
};
