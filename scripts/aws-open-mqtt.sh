#!/usr/bin/env bash
# Open AWS MQTT TLS path (TCP :8883) for the controlai daemon at 52.79.241.139.
#
# What it does:
#   1. Resolves the EC2 instance + primary security group from the public IP
#   2. Ensures TCP 8883 ingress rule exists (adds 0.0.0.0/0 if missing)
#   3. SSHes in, verifies Traefik is bound to :8883, and if not patches
#      /etc/traefik/traefik.yml with an mqtts entrypoint + restarts traefik
#   4. Re-runs the TCP probe from the local host
#
# Env overrides:
#   AWS_REGION    (default: ap-northeast-2)
#   AWS_IP        (default: 52.79.241.139)
#   SSH_USER      (default: ec2-user; try `ubuntu` if Ubuntu AMI)
#   SSH_KEY       (default: ~/.ssh/id_ed25519; pass --identity to override)
#   SSH_OPTS      (extra ssh args, e.g. "-i /path/to/key.pem")
#   CIDR          (default: 0.0.0.0/0; set to "$(curl -s ifconfig.me)/32" to lock down)
#   TRAEFIK_YML   (default: /etc/traefik/traefik.yml)
#
# Usage:
#   ./scripts/aws-open-mqtt.sh
#   SSH_USER=ubuntu SSH_KEY=~/.ssh/aws-seoul.pem ./scripts/aws-open-mqtt.sh

set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
AWS_IP="${AWS_IP:-52.79.241.139}"
SSH_USER="${SSH_USER:-ec2-user}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"
CIDR="${CIDR:-0.0.0.0/0}"
TRAEFIK_YML="${TRAEFIK_YML:-/etc/traefik/traefik.yml}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
die()   { red "FATAL: $*"; exit 1; }

require() { command -v "$1" >/dev/null || die "missing tool: $1"; }
require aws
require ssh
require nc

# ───────────────────────────────────────────────────────────────────────
blue "[1/4] Probe TCP $AWS_IP:8883 (current state)"
if nc -z -w 3 "$AWS_IP" 8883 2>/dev/null; then
  green "  already reachable — nothing to do for SG. Skipping to traefik check."
  SG_OK=1
else
  red   "  ECONNREFUSED / timeout"
  SG_OK=0
fi

# ───────────────────────────────────────────────────────────────────────
blue "[2/4] Resolve EC2 instance + security group"
INSTANCE_ID=$(aws ec2 describe-instances --region "$AWS_REGION" \
  --filters "Name=ip-address,Values=$AWS_IP" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
[[ "$INSTANCE_ID" == "None" || -z "$INSTANCE_ID" ]] && die "no EC2 instance for $AWS_IP in $AWS_REGION"
green "  instance: $INSTANCE_ID"

SG_ID=$(aws ec2 describe-instances --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
[[ -z "$SG_ID" || "$SG_ID" == "None" ]] && die "no SG attached"
green "  primary SG: $SG_ID"

HAS_8883=$(aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`8883` && ToPort==`8883` && IpProtocol==`tcp`] | length(@)' \
  --output text)

if [[ "$HAS_8883" == "0" ]]; then
  blue "  adding ingress tcp/8883 from $CIDR ..."
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
    --group-id "$SG_ID" --protocol tcp --port 8883 --cidr "$CIDR" >/dev/null
  green "  SG rule added"
else
  green "  SG already permits tcp/8883 (count=$HAS_8883)"
fi

# ───────────────────────────────────────────────────────────────────────
blue "[3/4] SSH + verify Traefik :8883 listener"
SSH_CMD=(ssh $SSH_OPTS -i "$SSH_KEY" "$SSH_USER@$AWS_IP")
if ! "${SSH_CMD[@]}" 'echo ok' >/dev/null 2>&1; then
  red "  SSH failed as $SSH_USER@$AWS_IP using key $SSH_KEY"
  red "  retry hint: SSH_USER=ubuntu SSH_KEY=~/.ssh/aws-seoul.pem $0"
  red "  skipping traefik check — you must verify manually:"
  red "    ssh ... 'sudo ss -tlnp | grep :8883'"
  red "    expect a traefik process bound on *:8883"
  exit 1
fi
green "  SSH ok as $SSH_USER@$AWS_IP"

LISTENER_OUT=$("${SSH_CMD[@]}" "sudo ss -tlnp 2>/dev/null | grep ':8883' || true")
if [[ -n "$LISTENER_OUT" ]]; then
  green "  Traefik (or other) is listening on :8883:"
  echo "$LISTENER_OUT" | sed 's/^/    /'
else
  red   "  nothing is listening on :8883 — patching $TRAEFIK_YML"

  # Backup + idempotent patch — append mqtts entrypoint if absent
  "${SSH_CMD[@]}" "sudo test -f $TRAEFIK_YML" || die "$TRAEFIK_YML missing on remote — abort, configure traefik manually"

  PATCH_CMD=$(cat <<'PATCH'
set -e
TYML="__TYML__"
if sudo grep -qE '^[[:space:]]*mqtts:' "$TYML"; then
  echo "    mqtts entrypoint already present"
else
  sudo cp -n "$TYML" "${TYML}.bak.$(date +%s)" || true
  if sudo grep -qE '^entryPoints:' "$TYML"; then
    sudo awk '/^entryPoints:/{print; print "  mqtts:"; print "    address: \":8883\""; next}1' "$TYML" \
      | sudo tee "${TYML}.new" >/dev/null
    sudo mv "${TYML}.new" "$TYML"
  else
    printf '\nentryPoints:\n  mqtts:\n    address: ":8883"\n' | sudo tee -a "$TYML" >/dev/null
  fi
  echo "    patched: appended mqtts entrypoint"
fi
# restart traefik (systemd unit name varies — try both)
if systemctl list-unit-files | grep -q '^traefik\.service'; then
  sudo systemctl restart traefik
  echo "    systemctl restart traefik OK"
elif command -v docker >/dev/null && sudo docker ps --format '{{.Names}}' | grep -q '^traefik$'; then
  sudo docker restart traefik
  echo "    docker restart traefik OK"
else
  echo "    WARN: could not auto-restart traefik (no systemd unit, no docker container 'traefik') — restart it yourself"
fi
PATCH

  PATCH_CMD="${PATCH_CMD//__TYML__/$TRAEFIK_YML}"
  "${SSH_CMD[@]}" "$PATCH_CMD" 2>&1 | sed 's/^/    /'

  sleep 3
  LISTENER_OUT=$("${SSH_CMD[@]}" "sudo ss -tlnp 2>/dev/null | grep ':8883' || true")
  if [[ -n "$LISTENER_OUT" ]]; then
    green "  traefik now listening:"
    echo "$LISTENER_OUT" | sed 's/^/    /'
  else
    die ":8883 still not listening after patch — inspect /var/log/traefik.log or 'journalctl -u traefik -n 50'"
  fi
fi

# ───────────────────────────────────────────────────────────────────────
blue "[4/4] Re-probe TCP $AWS_IP:8883 from this host"
for i in 1 2 3 4 5; do
  if nc -z -w 3 "$AWS_IP" 8883 2>/dev/null; then
    green "  $AWS_IP:8883 OPEN"
    green ""
    green "=== AWS MQTT path ready. Now run: ==="
    green "  set -a; source apps/web/.env.local; set +a"
    green "  pnpm -F web exec tsx ../../scripts/smoke-aws-sni.ts"
    exit 0
  fi
  echo "  retry $i/5 ..."
  sleep 2
done
die "still ECONNREFUSED after SG + Traefik fix — security group propagation delay? wait 60s and probe again"
