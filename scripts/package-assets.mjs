const EXPECTED_CADDY_SITE =
  "https://127.0.0.1:{$PARALLAIZE_CADDY_PORT:8080}, https://localhost:{$PARALLAIZE_CADDY_PORT:8080}, https://{$HOSTNAME:localhost}:{$PARALLAIZE_CADDY_PORT:8080}, https://{$PARALLAIZE_FORWARDED_SERVICE_HOST_BASE:parallaize.localhost}:{$PARALLAIZE_CADDY_PORT:8080}, https://*.{$PARALLAIZE_FORWARDED_SERVICE_HOST_BASE:parallaize.localhost}:{$PARALLAIZE_CADDY_PORT:8080} {";
const DEVELOPMENT_CONTROL_PROXY = "127.0.0.1:3000";
const PACKAGED_CONTROL_PROXY = "127.0.0.1:{$PORT:3000}";

export function renderPackagedCaddyfile(source) {
  if (!source.includes(EXPECTED_CADDY_SITE)) {
    throw new Error(
      `Expected the development Caddyfile to include "${EXPECTED_CADDY_SITE}".`,
    );
  }

  if (!source.includes(DEVELOPMENT_CONTROL_PROXY)) {
    throw new Error(
      `Expected the development Caddyfile to include "${DEVELOPMENT_CONTROL_PROXY}".`,
    );
  }

  return source.replaceAll(DEVELOPMENT_CONTROL_PROXY, PACKAGED_CONTROL_PROXY);
}
