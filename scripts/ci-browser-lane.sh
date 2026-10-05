#!/usr/bin/env bash
set -Eeuo pipefail

lane=${CI_QA_LANE:?CI_QA_LANE is required}

if [[ ${CI_MIGRATE_DATABASE:-true} == true ]]; then
  npm run db:migrate
fi

for second in $(seq 1 90); do
  if curl -fsS "$QA_BASE_URL/api/health" >/dev/null 2>&1; then
    echo "application healthy after ${second}s"
    break
  fi
  if [[ "$second" -eq 90 ]]; then
    [[ -f server.log ]] && cat server.log >&2
    exit 1
  fi
  sleep 1
done

# Next's custom-server runtime must retain the build-time image qualities. A
# route-only smoke can miss optimizer failures because <img> request errors do
# not surface as page errors, so probe both non-default qualities explicitly.
for quality in 72 78; do
  curl -fsS "$QA_BASE_URL/_next/image?url=%2Fbrand%2Faodom-hero.webp&w=640&q=$quality" \
    >/dev/null
done

curl -fsS -X POST "$QA_BASE_URL/api/account/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$QA_SMOKE_EMAIL\",\"username\":\"qa-cards\",\"password\":\"$QA_SMOKE_PASSWORD\"}" \
  || echo 'register returned non-2xx (account may already exist) - continuing'

run_routes() {
  set +e
  npm run test:smoke &
  smoke_pid=$!
  npm run test:hydration &
  hydration_pid=$!
  wait "$smoke_pid"
  smoke_status=$?
  wait "$hydration_pid"
  hydration_status=$?
  set -e
  [[ "$smoke_status" -eq 0 && "$hydration_status" -eq 0 ]]
}

run_deep() {
  QA_DEEP_SUITE=all QA_DEEP_PROFILE=full npm run test:qa-lucky-claw
}

case "$lane" in
  routes)
    run_routes
    ;;
  cage|claw)
    QA_DEEP_SUITE=$lane QA_DEEP_PROFILE=${QA_DEEP_PROFILE:-full} npm run test:qa-lucky-claw
    ;;
  source)
    run_routes
    [[ ${RUN_DEEP_QA:-false} != true ]] || run_deep
    ;;
  *)
    echo "unknown CI_QA_LANE: $lane" >&2
    exit 2
    ;;
esac
