#!/usr/bin/env bash
# Deploy idempotente dell'infrastruttura CMS MotoBroker su AWS (account Zentrya).
# Rieseguibile: ogni passo controlla lo stato esistente prima di creare/aggiornare.
# Vedi infra/README.md per i dettagli.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P=(--profile Zentrya)
REGION=us-east-1

GITHUB_OWNER=GabrieleFoti
GITHUB_REPO=MotoBroker
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
SECRET_NAME=motobroker/github-token

POOL_NAME=motobroker-admin
CLIENT_NAME=motobroker-admin-web
LAMBDA_NAME=motobroker-cms
API_NAME=motobroker-cms-api
ROLE_NAME=motobroker-cms-lambda-role
POLICY_NAME=motobroker-cms-lambda-policy

ORIGINS=(
  "https://motobroker.it"
  "https://www.motobroker.it"
  "http://localhost:4321"
)

aws() { command aws "$@" "${P[@]}" --region "$REGION"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "== 1/6: Cognito User Pool =="
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='$POOL_NAME'].Id" --output text)
if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then
  echo "  creo user pool $POOL_NAME"
  POOL_ID=$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --auto-verified-attributes email \
    --username-attributes email \
    --admin-create-user-config AllowAdminCreateUserOnly=true \
    --account-recovery-setting 'RecoveryMechanisms=[{Name=verified_email,Priority=1}]' \
    --policies 'PasswordPolicy={MinimumLength=10,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' \
    --query 'UserPool.Id' --output text)
else
  echo "  user pool esistente: $POOL_ID"
fi

CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 60 \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId" --output text)
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "None" ]; then
  echo "  creo app client $CLIENT_NAME"
  CLIENT_ID=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$POOL_ID" \
    --client-name "$CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --prevent-user-existence-errors ENABLED \
    --query 'UserPoolClient.ClientId' --output text)
else
  echo "  app client esistente: $CLIENT_ID"
fi

ISSUER="https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}"

echo "== 2/6: IAM role Lambda =="
TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "  ruolo esistente: $ROLE_NAME"
  ROLE_CREATED=false
else
  echo "  creo ruolo $ROLE_NAME"
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  ROLE_CREATED=true
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

jq -n --arg region "$REGION" --arg account "$ACCOUNT_ID" --arg secret "$SECRET_NAME" '{
  Version: "2012-10-17",
  Statement: [
    { Sid: "Logs", Effect: "Allow", Action: ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource: "arn:aws:logs:*:*:*" },
    { Sid: "GithubToken", Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: ("arn:aws:secretsmanager:" + $region + ":" + $account + ":secret:" + $secret + "-*") }
  ]
}' > "$HERE/.lambda-policy.json"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --policy-document "file://$HERE/.lambda-policy.json"
rm -f "$HERE/.lambda-policy.json"

if [ "${ROLE_CREATED:-false}" = "true" ]; then
  echo "  attendo propagazione IAM (10s)..."
  sleep 10
fi

echo "== 3/6: pacchetto Lambda =="
rm -f "$HERE/.lambda.zip"
# js-yaml (lo stesso parser di Astro) va nello zip: è l'unica dipendenza oltre all'SDK AWS,
# preso da node_modules del repo (npm ci prima del deploy).
JSYAML="$HERE/../node_modules/js-yaml"
[ -f "$JSYAML/package.json" ] || { echo "manca node_modules/js-yaml: esegui npm ci nella radice del repo" >&2; exit 1; }
PKG_DIR=$(mktemp -d)
cp "$HERE/lambda/index.mjs" "$HERE/lambda/lib.mjs" "$HERE/lambda/package.json" "$PKG_DIR/"
mkdir -p "$PKG_DIR/node_modules"
cp -R "$JSYAML" "$PKG_DIR/node_modules/js-yaml"
( cd "$PKG_DIR" && zip -q -r "$HERE/.lambda.zip" . )
rm -rf "$PKG_DIR"

echo "== 4/6: funzione Lambda $LAMBDA_NAME =="
ENV_VARS="Variables={GITHUB_OWNER=$GITHUB_OWNER,GITHUB_REPO=$GITHUB_REPO,GITHUB_BRANCH=$GITHUB_BRANCH,GITHUB_TOKEN_SECRET_ID=$SECRET_NAME,WORKFLOW_FILE=deploy.yml}"
if aws lambda get-function --function-name "$LAMBDA_NAME" >/dev/null 2>&1; then
  echo "  aggiorno codice e configurazione"
  aws lambda update-function-code --function-name "$LAMBDA_NAME" --zip-file "fileb://$HERE/.lambda.zip" >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME"
  aws lambda update-function-configuration --function-name "$LAMBDA_NAME" \
    --runtime nodejs22.x --handler index.handler --role "$ROLE_ARN" \
    --timeout 20 --memory-size 256 --environment "$ENV_VARS" >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME"
else
  echo "  creo funzione"
  for i in 1 2 3 4 5; do
    if aws lambda create-function --function-name "$LAMBDA_NAME" \
      --runtime nodejs22.x --handler index.handler --role "$ROLE_ARN" \
      --timeout 20 --memory-size 256 --environment "$ENV_VARS" \
      --zip-file "fileb://$HERE/.lambda.zip" >/dev/null; then
      break
    fi
    echo "  retry ($i) - ruolo IAM non ancora propagato, attendo 6s"
    sleep 6
  done
  aws lambda wait function-active --function-name "$LAMBDA_NAME"
fi
rm -f "$HERE/.lambda.zip"
LAMBDA_ARN=$(aws lambda get-function --function-name "$LAMBDA_NAME" --query 'Configuration.FunctionArn' --output text)

echo "== 5/6: API Gateway HTTP API =="
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId" --output text)
CORS_ORIGINS_JSON=$(printf '%s,' "${ORIGINS[@]}")
CORS_ORIGINS_JSON=${CORS_ORIGINS_JSON%,}
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  echo "  creo HTTP API $API_NAME"
  API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP \
    --query 'ApiId' --output text)
else
  echo "  API esistente: $API_ID"
fi

aws apigatewayv2 update-api --api-id "$API_ID" \
  --cors-configuration "AllowOrigins=$CORS_ORIGINS_JSON,AllowMethods=GET,PUT,POST,DELETE,OPTIONS,AllowHeaders=content-type,authorization,MaxAge=3000" >/dev/null

INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id "$API_ID" \
  --query "Items[?IntegrationUri=='$LAMBDA_ARN'].IntegrationId" --output text)
if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
  echo "  creo integrazione Lambda"
  INTEGRATION_ID=$(aws apigatewayv2 create-integration --api-id "$API_ID" \
    --integration-type AWS_PROXY --integration-uri "$LAMBDA_ARN" \
    --payload-format-version 2.0 --query 'IntegrationId' --output text)
else
  echo "  integrazione esistente: $INTEGRATION_ID"
fi

AUTHORIZER_ID=$(aws apigatewayv2 get-authorizers --api-id "$API_ID" \
  --query "Items[?Name=='cognito-jwt'].AuthorizerId" --output text)
if [ -z "$AUTHORIZER_ID" ] || [ "$AUTHORIZER_ID" = "None" ]; then
  echo "  creo authorizer JWT Cognito"
  AUTHORIZER_ID=$(aws apigatewayv2 create-authorizer --api-id "$API_ID" \
    --authorizer-type JWT --identity-source '$request.header.Authorization' \
    --name cognito-jwt \
    --jwt-configuration "Issuer=$ISSUER,Audience=$CLIENT_ID" \
    --query 'AuthorizerId' --output text)
else
  echo "  authorizer esistente: $AUTHORIZER_ID"
  aws apigatewayv2 update-authorizer --api-id "$API_ID" --authorizer-id "$AUTHORIZER_ID" \
    --jwt-configuration "Issuer=$ISSUER,Audience=$CLIENT_ID" >/dev/null
fi

create_or_update_route() {
  local method="$1" path="$2"
  local route_key="$method $path"
  local existing
  existing=$(aws apigatewayv2 get-routes --api-id "$API_ID" \
    --query "Items[?RouteKey=='$route_key'].RouteId" --output text)
  if [ -z "$existing" ] || [ "$existing" = "None" ]; then
    echo "  creo rotta $route_key"
    aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$route_key" \
      --target "integrations/$INTEGRATION_ID" \
      --authorization-type JWT --authorizer-id "$AUTHORIZER_ID" >/dev/null
  else
    echo "  rotta esistente: $route_key"
    aws apigatewayv2 update-route --api-id "$API_ID" --route-id "$existing" \
      --target "integrations/$INTEGRATION_ID" \
      --authorization-type JWT --authorizer-id "$AUTHORIZER_ID" >/dev/null
  fi
}
create_or_update_route GET /moto
create_or_update_route POST /blobs
create_or_update_route PUT '/moto/{slug}'
create_or_update_route DELETE '/moto/{slug}'
create_or_update_route GET /deploy-status

if aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' >/dev/null 2>&1; then
  echo "  stage \$default esistente"
else
  echo "  creo stage \$default (auto-deploy)"
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
fi

STATEMENT_ID="apigw-invoke-$API_ID"
if ! aws lambda get-policy --function-name "$LAMBDA_NAME" 2>/dev/null | grep -q "$STATEMENT_ID"; then
  echo "  concedo permesso invoke ad API Gateway"
  aws lambda add-permission --function-name "$LAMBDA_NAME" \
    --statement-id "$STATEMENT_ID" --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" >/dev/null
else
  echo "  permesso invoke già presente"
fi

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

echo "== 6/6: secret GitHub =="
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  echo "  secret $SECRET_NAME presente"
  SECRET_PRESENT=true
else
  echo "  ATTENZIONE: secret $SECRET_NAME non trovato in Secrets Manager."
  echo "  Crealo con:"
  echo "    aws secretsmanager create-secret --name $SECRET_NAME --secret-string <token> --profile Zentrya --region $REGION"
  SECRET_PRESENT=false
fi

jq -n --arg apiUrl "$API_URL" --arg userPoolId "$POOL_ID" --arg clientId "$CLIENT_ID" --arg region "$REGION" '{
  apiUrl: $apiUrl,
  userPoolId: $userPoolId,
  clientId: $clientId,
  region: $region
}' > "$HERE/outputs.json"

echo
echo "Fatto. Output in infra/outputs.json:"
cat "$HERE/outputs.json"
if [ "$SECRET_PRESENT" = "false" ]; then
  echo
  echo "Il secret GitHub manca ancora: la Lambda è deployata ma le rotte che parlano con"
  echo "GitHub falliranno finché il secret non viene creato (vedi sopra)."
fi
