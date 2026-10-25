#!/usr/bin/env bash
# Crea un utente del pannello admin (Cognito) con password temporanea inviata via email.
#
# Uso:
#   scripts/utente-admin.sh indirizzo@email.it
#   scripts/utente-admin.sh indirizzo@email.it --reinvia   # rimanda l'invito (password temporanea nuova)
#
# Cosa fa: aws cognito-idp admin-create-user senza --message-action SUPPRESS, quindi
# Cognito genera una password temporanea e la invia all'email indicata usando il
# messaggio di default (nessuna SES/SMTP da configurare). Al primo login il pannello
# chiederà di impostare una password definitiva (flusso NEW_PASSWORD_REQUIRED, già
# gestito dal pannello admin).
#
# È idempotente: se l'utente esiste già, non lo ricrea (lo dice ed esce 0). Per
# rimandare l'invito con una nuova password temporanea usa --reinvia.
#
# Per cancellare un utente (es. un test):
#   aws cognito-idp admin-delete-user --profile Zentrya --region us-east-1 \
#     --user-pool-id <userPoolId> --username <email>

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Uso: $0 <email> [--reinvia]" >&2
  exit 1
fi

EMAIL="$1"
REINVIA=false
if [ "${2:-}" = "--reinvia" ]; then
  REINVIA=true
fi

PROFILE="Zentrya"
REGION="us-east-1"
OUTPUTS="infra/outputs.json"

if [ ! -f "$OUTPUTS" ]; then
  echo "Non trovo $OUTPUTS: esegui prima infra/deploy.sh." >&2
  exit 1
fi

USER_POOL_ID=$(python3 -c "import json;print(json.load(open('$OUTPUTS'))['userPoolId'])")

EXISTS=true
aws cognito-idp admin-get-user \
  --profile "$PROFILE" --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" --username "$EMAIL" >/dev/null 2>&1 || EXISTS=false

if [ "$EXISTS" = true ] && [ "$REINVIA" = false ]; then
  echo "L'utente $EMAIL esiste già sul pool $USER_POOL_ID. Non lo ricreo."
  echo "Per rimandare l'invito (nuova password temporanea): $0 $EMAIL --reinvia"
  exit 0
fi

if [ "$EXISTS" = true ] && [ "$REINVIA" = true ]; then
  echo "Rimando l'invito a $EMAIL sul pool $USER_POOL_ID (nuova password temporanea)..."
  aws cognito-idp admin-create-user \
    --profile "$PROFILE" --region "$REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL \
    --message-action RESEND
  echo "Fatto. $EMAIL riceverà una nuova email da Cognito con la password temporanea."
  exit 0
fi

echo "Creo l'utente $EMAIL sul pool $USER_POOL_ID (regione $REGION)..."
aws cognito-idp admin-create-user \
  --profile "$PROFILE" --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL

echo "Fatto. $EMAIL riceverà una email da Cognito con nome utente e password temporanea."
echo "Al primo accesso al pannello verrà chiesto di impostarne una definitiva."
