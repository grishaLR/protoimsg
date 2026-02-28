#!/bin/sh

# On Fly.io, UDP apps MUST bind to fly-global-services for reply routing.
# Falls back to 0.0.0.0 for local dev (Docker Compose).
FGS=$(getent hosts fly-global-services 2>/dev/null | awk '{print $1}')
LISTEN_IP="${FGS:-0.0.0.0}"

# Detect machine's internal IPv4 for relay binding
INTERNAL_IP=$(hostname -i 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+\./) print $i}' | head -1)
RELAY_IP="${INTERNAL_IP:-0.0.0.0}"

# External IP mapping — coturn needs explicit internal/external mapping
# so relay candidates use the public IP, not the Fly internal IP
EXTERNAL_FLAG=""
if [ -n "$EXTERNAL_IP" ] && [ -n "$INTERNAL_IP" ]; then
  EXTERNAL_FLAG="--external-ip=${EXTERNAL_IP}/${INTERNAL_IP}"
elif [ -n "$EXTERNAL_IP" ]; then
  EXTERNAL_FLAG="--external-ip=${EXTERNAL_IP}"
fi

echo "LISTEN_IP=$LISTEN_IP RELAY_IP=$RELAY_IP EXTERNAL_FLAG=$EXTERNAL_FLAG"

exec turnserver -n \
  --listening-port=3478 \
  --listening-ip="$LISTEN_IP" \
  --relay-ip="$RELAY_IP" \
  $EXTERNAL_FLAG \
  --realm="${TURN_REALM:-protoimsg.app}" \
  --use-auth-secret \
  --static-auth-secret="$COTURN_SHARED_SECRET" \
  --no-cli \
  --fingerprint \
  --no-multicast-peers \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=127.0.0.0-127.255.255.255 \
  --denied-peer-ip=0.0.0.0-0.255.255.255 \
  --secure-stun \
  --min-port=49152 \
  --max-port=49252 \
  --total-quota=1000 \
  --user-quota=10 \
  --prometheus \
  --verbose
