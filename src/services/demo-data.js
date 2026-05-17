/**
 * DALEBA — Données de démonstration pour Kadio Coiffure
 * Utilisées quand MODE=demo ou pas de DATABASE_URL
 */

const DEMO_BUSINESS = {
  id: 1,
  name: 'Kadio Coiffure et Esthétique',
  address: '615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone: '514-919-5970',
  email: 'contact@kadiocoiffure.ca',
  website: 'https://kadiocoiffure.ca',
  logo_url: null,
  settings: { currency: 'CAD', timezone: 'America/Toronto' },
};

const DEMO_SERVICES = [
  { id: 1, name: 'Coupe Homme', description: 'Dégradé, tondeuse, style afro — propre et soigné', duration_min: 45, price: 25, deposit: 5, category: 'coupe' },
  { id: 2, name: 'Coupe Femme', description: 'Coupe, mise en forme, définition des boucles', duration_min: 60, price: 45, deposit: 9, category: 'coupe' },
  { id: 3, name: 'Coupe Enfant', description: 'Coupes pour enfants dans une ambiance douce', duration_min: 30, price: 20, deposit: 0, category: 'coupe' },
  { id: 4, name: 'Tresses (Box Braids)', description: 'Box braids, cornrows, goddess braids — toutes techniques', duration_min: 180, price: 120, deposit: 24, category: 'tresses' },
  { id: 5, name: 'Extensions', description: 'Pose d\'extensions naturelles ou synthétiques', duration_min: 240, price: 180, deposit: 36, category: 'extensions' },
  { id: 6, name: 'Dreadlocks', description: 'Création, entretien et retouche de dreadlocks', duration_min: 300, price: 200, deposit: 40, category: 'locs' },
  { id: 7, name: 'Tissage', description: 'Tissage naturel et synthétique, cousu ou collé', duration_min: 180, price: 150, deposit: 30, category: 'tissage' },
  { id: 8, name: 'Perruque', description: 'Pose et personnalisation de perruques full lace', duration_min: 120, price: 130, deposit: 26, category: 'perruque' },
  { id: 9, name: 'Barbier/Dégradé', description: 'Dégradé rasé, beard trim, liner — sans dépôt', duration_min: 45, price: 25, deposit: 0, category: 'barbier' },
  { id: 10, name: 'Traitement Capillaire', description: 'Soins hydratants, kératine, deep conditioning', duration_min: 60, price: 55, deposit: 11, category: 'soin' },
];

const DEMO_STAFF = [
  { id: 1, name: 'Ulrich Kadio', role_title: 'Fondateur & Directeur artistique', color: '#C4622D', avatar_url: null, services: [1,2,3,4,5,6,7,8,9,10] },
  { id: 2, name: 'Marie-Claire', role_title: 'Experte tresses & tissages', color: '#7A9E6E', avatar_url: null, services: [1,2,3,4,7,10] },
  { id: 3, name: 'Aminata Diallo', role_title: 'Spécialiste extensions & perruques', color: '#C9933A', avatar_url: null, services: [4,5,6,7,8,10] },
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
