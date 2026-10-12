#!/usr/bin/env bash
# E: CORS preflight + actual-response CORS headers for browser-direct use.
set -u
O="https://redletter.dev"
T=$(gh auth token)
show() { grep -iE '^(HTTP|access-control|vary|etag|x-ratelimit)' | tr -d '\r'; }
pre() { echo "== OPTIONS $1 ($2)"; curl -s -o /dev/null -D - -X OPTIONS "$1" -H "Origin: $O" \
  -H "Access-Control-Request-Method: $2" -H "Access-Control-Request-Headers: $3" | show; }

pre https://api.github.com/repos/satanworker/red-letter/git/refs/heads/spike/cas PATCH authorization,content-type,if-none-match
pre https://api.github.com/repos/satanworker/red-letter/git/ref/heads/main GET authorization,if-none-match,x-github-api-version
pre https://api.github.com/graphql POST authorization,content-type
echo "== GET (actual) api.github.com git/ref with Origin"
curl -s -o /dev/null -D - "https://api.github.com/repos/satanworker/red-letter/git/ref/heads/main" -H "Origin: $O" -H "Authorization: Bearer $T" | show
pre https://github.com/login/oauth/access_token POST content-type,accept
echo "== POST (actual) github.com/login/oauth/access_token with Origin"
curl -s -o /dev/null -D - -X POST "https://github.com/login/oauth/access_token" -H "Origin: $O" -H "Accept: application/json" | show
pre https://raw.githubusercontent.com/satanworker/red-letter/main/README.md GET authorization
echo "== GET (actual) raw.githubusercontent.com with Origin"
curl -s -o /dev/null -D - "https://raw.githubusercontent.com/satanworker/red-letter/main/docs/DESIGN.md" -H "Origin: $O" -H "Authorization: token $T" | show
