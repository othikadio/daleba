/**
 * KADIO OS — Axe 3: L'Usine à Agents
 * Infrastructure de queues BullMQ avec fallback en mémoire si Redis indisponible
 */

let Queue, Worker, QueueEvents;
let redisAvailable = false;
let leadGenQueue, seoAuditQueue, emailSequenceQueue;

// Stats en mémoire (fallback)
const memoryStats = {
  'lead-gen-queue': { waiting: 0, active: 0, completed: 0, failed: 0 },
  'seo-audit-queue': { waiting: 0, active: 0, completed: 0, failed: 0 },
  'email-sequence-queue': { waiting: 0, active: 0, completed: 0, failed: 0 }
};

const memoryJobs = {
  'lead-gen-queue': [],
  'seo-audit-queue': [],
  'email-sequence-queue': []
};

let jobIdCounter = 1;

async function initQueues() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[USINE] Pas de REDIS_URL — mode mémoire activé');
    return false;
  }

  try {
    const bullmq = require('bullmq');
    Queue = bullmq.Queue;
    Worker = bullmq.Worker;
    QueueEvents = bullmq.QueueEvents;

    const IORedis = require('ioredis');
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    leadGenQueue = new Queue('lead-gen-queue', { connection });
    seoAuditQueue = new Queue('seo-audit-queue', { connection });
    emailSequenceQueue = new Queue('email-sequence-queue', { connection });

    redisAvailable = true;
    console.log('[USINE] Queues BullMQ initialisées avec Redis');

    // ── BullMQ Workers — consomment les jobs de la file ──────────────────────
    // Connexion séparée pour les workers (requis par BullMQ)
    const workerConn = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    // Worker Lead Gen
    const lgWorker = new Worker('lead-gen-queue', async (job) => {
      console.log(`[USINE-LG] Job ${job.id} démarré — trigger:${job.data.trigger}`);
      try {
        const { runLeadGenJob, DEFAULT_CITIES } = require('./lead-gen-worker');
        await runLeadGenJob(DEFAULT_CITIES);
        console.log(`[USINE-LG] Job ${job.id} terminé`);
      } catch (e) {
        console.warn(`[USINE-LG] Job ${job.id} erreur:`, e.message);
        throw e;
      }
    }, { connection: workerConn, concurrency: 1 });
    lgWorker.on('failed', (job, err) => console.warn(`[USINE-LG] Failed ${job?.id}:`, err.message));

    // Worker SEO Audit
    const seoConn = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const seoWorker = new Worker('seo-audit-queue', async (job) => {
      console.log(`[USINE-SEO] Job ${job.id} démarré`);
      try {
        const { runSeoAuditJob } = require('./seo-audit-worker');
        await runSeoAuditJob(job.data);
        console.log(`[USINE-SEO] Job ${job.id} terminé`);
      } catch (e) {
        console.warn(`[USINE-SEO] Job ${job.id} erreur:`, e.message);
        throw e;
      }
    }, { connection: seoConn, concurrency: 1 });
    seoWorker.on('failed', (job, err) => console.warn(`[USINE-SEO] Failed ${job?.id}:`, err.message));

    // Worker Email Sequence
    const emConn = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const emWorker = new Worker('email-sequence-queue', async (job) => {
      console.log(`[USINE-EM] Job ${job.id} démarré`);
      try {
        const { processEmailSequences } = require('./email-sequence-worker');
        await processEmailSequences();
        console.log(`[USINE-EM] Job ${job.id} terminé`);
      } catch (e) {
        console.warn(`[USINE-EM] Job ${job.id} erreur:`, e.message);
        throw e;
      }
    }, { connection: emConn, concurrency: 1 });
    emWorker.on('failed', (job, err) => console.warn(`[USINE-EM] Failed ${job?.id}:`, err.message));

    console.log('[USINE] Workers BullMQ démarrés — Lead Gen + SEO + Email');
    return true;
  } catch (e) {
    console.warn('[USINE] Redis indisponible, fallback mémoire:', e.message);
    return false;
  }
}

// Ajouter un job lead-gen
async function addLeadGenJob(data) {
  const jobId = `lg-${Date.now()}-${jobIdCounter++}`;
  if (redisAvailable && leadGenQueue) {
    return await leadGenQueue.add('scrape', data, { jobId });
  }
  // Fallback mémoire
  const job = { id: jobId, data, status: 'waiting', createdAt: new Date() };
  memoryJobs['lead-gen-queue'].push(job);
  memoryStats['lead-gen-queue'].waiting++;
  return job;
}

// Ajouter un job SEO audit
async function addSeoAuditJob(data) {
  const jobId = `seo-${Date.now()}-${jobIdCounter++}`;
  if (redisAvailable && seoAuditQueue) {
    return await seoAuditQueue.add('audit', data, { jobId });
  }
  const job = { id: jobId, data, status: 'waiting', createdAt: new Date() };
  memoryJobs['seo-audit-queue'].push(job);
  memoryStats['seo-audit-queue'].waiting++;
  return job;
}

// Ajouter un job séquence email
async function addEmailSequenceJob(data) {
  const jobId = `email-${Date.now()}-${jobIdCounter++}`;
  if (redisAvailable && emailSequenceQueue) {
    return await emailSequenceQueue.add('sequence', data, { jobId, delay: (data.delayDays || 0) * 86400000 });
  }
  const job = { id: jobId, data, status: 'waiting', createdAt: new Date() };
  memoryJobs['email-sequence-queue'].push(job);
  memoryStats['email-sequence-queue'].waiting++;
  return job;
}

// Stats globales des queues
async function getQueueStats() {
  if (redisAvailable && leadGenQueue) {
    try {
      const [lg, seo, email] = await Promise.all([
        leadGenQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
        seoAuditQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
        emailSequenceQueue.getJobCounts('waiting', 'active', 'completed', 'failed')
      ]);
      return { 'lead-gen-queue': lg, 'seo-audit-queue': seo, 'email-sequence-queue': email, redisAvailable: true };
    } catch (e) {
      console.warn('[USINE] getQueueStats error:', e.message);
    }
  }
  return { ...memoryStats, redisAvailable: false };
}

// Marquer job comme actif (fallback mémoire)
function markJobActive(queueName, jobId) {
  if (!redisAvailable) {
    const job = memoryJobs[queueName]?.find(j => j.id === jobId);
    if (job) {
      job.status = 'active';
      memoryStats[queueName].waiting = Math.max(0, memoryStats[queueName].waiting - 1);
      memoryStats[queueName].active++;
    }
  }
}

// Marquer job comme complété (fallback mémoire)
function markJobCompleted(queueName, jobId) {
  if (!redisAvailable) {
    const job = memoryJobs[queueName]?.find(j => j.id === jobId);
    if (job) {
      job.status = 'completed';
      memoryStats[queueName].active = Math.max(0, memoryStats[queueName].active - 1);
      memoryStats[queueName].completed++;
    }
  }
}

// Marquer job comme échoué (fallback mémoire)
function markJobFailed(queueName, jobId) {
  if (!redisAvailable) {
    const job = memoryJobs[queueName]?.find(j => j.id === jobId);
    if (job) {
      job.status = 'failed';
      memoryStats[queueName].active = Math.max(0, memoryStats[queueName].active - 1);
      memoryStats[queueName].failed++;
    }
  }
}

// Initialiser au démarrage
initQueues().catch(console.warn);

module.exports = {
  addLeadGenJob,
  addSeoAuditJob,
  addEmailSequenceJob,
  getQueueStats,
  markJobActive,
  markJobCompleted,
  markJobFailed,
  get leadGenQueue() { return leadGenQueue; },
  get seoAuditQueue() { return seoAuditQueue; },
  get emailSequenceQueue() { return emailSequenceQueue; },
  get redisAvailable() { return redisAvailable; }
};
