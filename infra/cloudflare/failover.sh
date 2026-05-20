#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DALEBA — Cloudflare DNS Failover Automatique
# Surveille VPS A toutes les 30s — bascule vers VPS B si DOWN
# À déployer sur les DEUX VPS (ou un monitoring externe)
# ═══════════════════════════════════════════════════════════════
#
# CONFIG REQUISE (variables d'env ou .env.cloudflare):
#   CF_API_TOKEN      → Cloudflare API token (Zone:Edit)
#   CF_ZONE_ID        → Zone ID du domaine dans Cloudflare
#   CF_RECORD_NAME    → ex: api.daleba.app
#   VPS_A_IP          → IP du VPS principal (Railway ou OVH)
#   VPS_B_IP          → IP du VPS secours (DigitalOcean)
#   HEALTH_URL        → https://<domaine>/api/status
#   ULRICH_PHONE      → +15149845970 (SMS alerte)
#   TWILIO_SID        → Account SID Twilio
#   TWILIO_TOKEN      → Auth Token Twilio
#   TWILIO_FROM       → +13022328291

set -euo pipefail

# ── Config ──────────────────────────────────────────────────
CF_API_TOKEN="${CF_API_TOKEN:?CF_API_TOKEN requis}"
CF_ZONE_ID="${CF_ZONE_ID:?CF_ZONE_ID requis}"
CF_RECORD_NAME="${CF_RECORD_NAME:?CF_RECORD_NAME requis}"
VPS_A_IP="${VPS_A_IP:?VPS_A_IP requis}"
VPS_B_IP="${VPS_B_IP:?VPS_B_IP requis}"
HEALTH_URL="${HEALTH_URL:-https://${CF_RECORD_NAME}/api/status}"
ULRICH_PHONE="${ULRICH_PHONE:-+15149845970}"
TWILIO_SID="${TWILIO_SID:-}"
TWILIO_FROM="${TWILIO_FROM:-+13022328291}"
CHECK_INTERVAL=30
FAIL_THRESHOLD=2  # 2 échecs consécutifs → bascule
STATE_FILE="/tmp/daleba-failover.state"

# ── Init state ───────────────────────────────────────────────
current_vps="A"
fail_count=0
[ -f "$STATE_FILE" ] && source "$STATE_FILE"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

# ── Fonctions Cloudflare ────────────────────────────────────
get_dns_record_id() {
  curl -sS -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?name=$CF_RECORD_NAME&type=A" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'])"
}

update_dns() {
  local new_ip="$1"
  local record_id
  record_id=$(get_dns_record_id)
  curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$record_id" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"content\":\"$new_ip\",\"ttl\":60}" > /dev/null
  log "✅ DNS mis à jour → $new_ip"
}

# ── SMS alerte Ulrich ────────────────────────────────────────
send_sms() {
  local msg="$1"
  if [ -n "$TWILIO_SID" ]; then
    curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/Messages.json" \
      -u "$TWILIO_SID:${TWILIO_TOKEN}" \
      --data-urlencode "To=$ULRICH_PHONE" \
      --data-urlencode "From=$TWILIO_FROM" \
      --data-urlencode "Body=$msg" > /dev/null
  fi
  log "📱 SMS Ulrich: $msg"
}

# ── Healthcheck ──────────────────────────────────────────────
check_health() {
  local url="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 8 --max-time 10 "$url" 2>/dev/null)
  [ "$code" = "200" ]
}

# ── Boucle principale ────────────────────────────────────────
log "🚀 DALEBA Failover Guard démarré — check toutes les ${CHECK_INTERVAL}s"
log "   VPS A: $VPS_A_IP | VPS B: $VPS_B_IP | DNS: $CF_RECORD_NAME"

while true; do
  if check_health "$HEALTH_URL"; then
    # Tout va bien
    if [ $fail_count -gt 0 ]; then
      log "✅ Service restauré après $fail_count échecs"
      fail_count=0
      echo "current_vps=$current_vps; fail_count=0" > "$STATE_FILE"
    fi

    # Si on était basculé sur B et que A est de nouveau dispo → re-bascule
    if [ "$current_vps" = "B" ]; then
      if check_health "http://$VPS_A_IP/api/status"; then
        log "🔄 VPS A de retour — rebascule depuis B vers A"
        update_dns "$VPS_A_IP"
        current_vps="A"
        echo "current_vps=A; fail_count=0" > "$STATE_FILE"
        send_sms "[DALEBA] ✅ VPS A restauré — trafic rebascule vers principal"
      fi
    fi
  else
    fail_count=$((fail_count + 1))
    log "⚠️  Échec $fail_count/$FAIL_THRESHOLD — ${HEALTH_URL}"

    if [ $fail_count -ge $FAIL_THRESHOLD ] && [ "$current_vps" = "A" ]; then
      log "🔴 FAILOVER DÉCLENCHÉ — VPS A DOWN → bascule vers VPS B ($VPS_B_IP)"
      update_dns "$VPS_B_IP"
      current_vps="B"
      fail_count=0
      echo "current_vps=B; fail_count=0" > "$STATE_FILE"
      send_sms "[DALEBA ALERTE] 🔴 VPS A hors ligne. FAILOVER automatique → VPS B activé. Salon opérationnel."
    fi
  fi

  sleep "$CHECK_INTERVAL"
done
