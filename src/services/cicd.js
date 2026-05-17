/**
 * DALEBA — CI/CD Auto (Point 15)
 * Déclenche un redéploiement Vercel via API.
 */

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || 'REDACTED_USE_ENV';
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_AB1rGiSyXAHgXhtVpwrrraIySrT5';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_xF28H411GIyX0CpUNUbMTGFR';

/**
 * Déclenche un redéploiement du projet Daleba sur Vercel
 * Utilise l'API deployments (force redeploy du dernier commit)
 */
async function triggerDeploy(reason = 'Auto-deploy via DALEBA') {
  if (!VERCEL_TOKEN) {
    console.warn('⚠️ VERCEL_TOKEN non configuré — deploy ignoré');
    return { success: false, error: 'token_missing' };
  }

  try {
    const url = `https://api.vercel.com/v13/deployments?teamId=${TEAM_ID}`;

    const body = {
      name: 'daleba',
      gitSource: {
        type: 'github',
        repoId: undefined, // Vercel résoudra depuis le projet lié
        ref: 'main',
      },
      projectId: PROJECT_ID,
      target: 'production',
      meta: {
        reason,
        triggeredBy: 'DALEBA-auto',
        triggeredAt: new Date().toISOString(),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ Deploy Vercel échoué:', data);
      return { success: false, error: data.error?.message || `HTTP ${res.status}`, raw: data };
    }

    console.log(`🚀 Deploy Vercel déclenché: ${data.id} — ${data.url}`);
    return {
      success: true,
      deploymentId: data.id,
      url: data.url,
      state: data.readyState,
    };
  } catch (err) {
    console.error('❌ Erreur triggerDeploy:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Récupère l'état du dernier déploiement
 */
async function getDeployStatus() {
  try {
    const url = `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });
    const data = await res.json();
    const deployment = data.deployments?.[0];
    if (!deployment) return { status: 'unknown' };

    return {
      id: deployment.uid,
      url: deployment.url,
      state: deployment.readyState,
      createdAt: deployment.createdAt,
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

module.exports = { triggerDeploy, getDeployStatus };
