/**
 * DALEBA — Meta Messenger & Instagram DM Sender
 * Envoi de messages via Meta Graph API (Messenger + Instagram)
 * Requis pour le flux publicitaire — réponses aux prospects
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

function getToken() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️ META_ACCESS_TOKEN manquant — impossible d\'envoyer via Messenger/Instagram');
    return null;
  }
  return token;
}

/**
 * Envoie un message via Facebook Messenger ou Instagram DMs
 * @param {string} recipientId — PSID Facebook ou IGSID Instagram
 * @param {string} text — message texte
 * @param {string} platform — 'facebook' | 'instagram'
 */
async function sendMetaMessage(recipientId, text, platform = 'facebook') {
  const token = getToken();
  if (!token) return { success: false, error: 'token_missing' };

  const endpoint = `${GRAPH_BASE}/me/messages?access_token=${token}`;

  const body = {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: 'RESPONSE',
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      const errMsg = data.error?.message || `HTTP ${res.status}`;
      console.error(`❌ [META/${platform.toUpperCase()}] Envoi échoué à ${recipientId}: ${errMsg}`);
      return { success: false, error: errMsg };
    }

    console.log(`✅ [META/${platform.toUpperCase()}] Message envoyé à ${recipientId}`);
    return { success: true, messageId: data.message_id };

  } catch (err) {
    console.error(`❌ [META/${platform.toUpperCase()}] Fetch error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Envoie un message Facebook Messenger
 */
async function sendMessengerMessage(psid, text) {
  return sendMetaMessage(psid, text, 'facebook');
}

/**
 * Envoie un message Instagram DM
 */
async function sendInstagramMessage(igsid, text) {
  return sendMetaMessage(igsid, text, 'instagram');
}

/**
 * Envoie un message avec un bouton URL (Messenger uniquement)
 * @param {string} psid
 * @param {string} text
 * @param {string} buttonTitle
 * @param {string} buttonUrl
 */
async function sendMessengerButtonMessage(psid, text, buttonTitle, buttonUrl) {
  const token = getToken();
  if (!token) return { success: false, error: 'token_missing' };

  const body = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: [
            {
              type: 'web_url',
              url: buttonUrl,
              title: buttonTitle,
              webview_height_ratio: 'full',
            },
          ],
        },
      },
    },
    messaging_type: 'RESPONSE',
  };

  try {
    const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      // Fallback : message texte simple avec le lien
      return sendMessengerMessage(psid, `${text}\n\n👉 ${buttonUrl}`);
    }
    return { success: true, messageId: data.message_id };
  } catch (err) {
    return sendMessengerMessage(psid, `${text}\n\n👉 ${buttonUrl}`);
  }
}

module.exports = {
  sendMetaMessage,
  sendMessengerMessage,
  sendInstagramMessage,
  sendMessengerButtonMessage,
};
