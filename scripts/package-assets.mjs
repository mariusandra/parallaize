const DEVELOPMENT_CADDY_SITE = ":8080 {";
const PACKAGED_CADDY_SITE = ":{$PARALLAIZE_CADDY_PORT:8080} {";
const DEVELOPMENT_CONTROL_PROXY = "127.0.0.1:3000";
const PACKAGED_CONTROL_PROXY = "127.0.0.1:{$PORT:3000}";

export function renderPackagedCaddyfile(source) {
  if (!source.includes(DEVELOPMENT_CADDY_SITE)) {
    throw new Error(
      `Expected the development Caddyfile to include "${DEVELOPMENT_CADDY_SITE}".`,
    );
  }

  if (!source.includes(DEVELOPMENT_CONTROL_PROXY)) {
    throw new Error(
      `Expected the development Caddyfile to include "${DEVELOPMENT_CONTROL_PROXY}".`,
    );
  }

  return source
    .replace(DEVELOPMENT_CADDY_SITE, PACKAGED_CADDY_SITE)
    .replaceAll(DEVELOPMENT_CONTROL_PROXY, PACKAGED_CONTROL_PROXY);
}
