/**
 * DALEBA — Hub Social Meta (Point 38)
 * Publication automatisée sur Instagram & Facebook via Meta Graph API
 */

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

function checkTokens() {
  if (!META_ACCESS_TOKEN || !META_PAGE_ID || !META_IG_USER_ID) {
    console.warn('⚠️ META tokens manquants (META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID)');
    return false;
  }
  return true;
}

/**
 * Publie une image sur Instagram (2 étapes : créer container → publier)
 * @param {string} imageUrl - URL publique de l'image
 * @param {string} caption - Légende du post
 */
async function postToInstagram(imageUrl, caption) {
  if (!checkTokens()) return { error: 'tokens_missing' };

  try {
    // Étape 1 : Créer le container média
    const containerRes = await fetch(
      `${GRAPH_BASE}/${META_IG_USER_ID}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: META_ACCESS_TOKEN,
        }),
      }
    );

    const containerData = await containerRes.json();
    if (!containerRes.ok || containerData.error) {
      throw new Error(containerData.error?.message || `HTTP ${containerRes.status}`);
    }

    const containerId = containerData.id;
    console.log(`📸 Container IG créé: ${containerId}`);

    // Étape 2 : Publier le container
    const publishRes = await fetch(
      `${GRAPH_BASE}/${META_IG_USER_ID}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: META_ACCESS_TOKEN,
        }),
      }
    );

    const publishData = await publishRes.json();
    if (!publishRes.ok || publishData.error) {
      throw new Error(publishData.error?.message || `HTTP ${publishRes.status}`);
    }

    console.log(`✅ Post Instagram publié: ${publishData.id}`);
    return { success: true, postId: publishData.id, platform: 'instagram' };

  } catch (err) {
    console.error('❌ Erreur postToInstagram:', err.message);
    return { success: false, error: err.message, platform: 'instagram' };
  }
}

/**
 * Publie un post sur la Page Facebook
 * @param {string} message - Texte du post
 * @param {string} [imageUrl] - URL de l'image (optionnel)
 */
async function postToFacebook(message, imageUrl = null) {
  if (!checkTokens()) return { error: 'tokens_missing' };

  try {
    const endpoint = imageUrl
      ? `${GRAPH_BASE}/${META_PAGE_ID}/photos`
      : `${GRAPH_BASE}/${META_PAGE_ID}/feed`;

    const body = imageUrl
      ? { message, url: imageUrl, access_token: META_ACCESS_TOKEN }
      : { message, access_token: META_ACCESS_TOKEN };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    console.log(`✅ Post Facebook publié: ${data.id}`);
    return { success: true, postId: data.id, platform: 'facebook' };

  } catch (err) {
    console.error('❌ Erreur postToFacebook:', err.message);
    return { success: false, error: err.message, platform: 'facebook' };
  }
}

/**
 * Vérifie si les tokens Meta sont configurés
 */
function getSocialStatus() {
  return {
    configured: checkTokens(),
    tokens: {
      META_ACCESS_TOKEN: !!META_ACCESS_TOKEN,
      META_PAGE_ID: !!META_PAGE_ID,
      META_IG_USER_ID: !!META_IG_USER_ID,
    },
    platforms: ['instagram', 'facebook'],
  };
}

module.exports = { postToInstagram, postToFacebook, getSocialStatus };
