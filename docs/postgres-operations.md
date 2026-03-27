# PostgreSQL Operations

This is the operator path for PostgreSQL-backed Parallaize state: backup, export, import, restore, and packaged-service validation.

## Storage shape

Parallaize does not spread state across a migration-heavy relational schema yet.

It stores one normalized app-state document in PostgreSQL:

- table: `app_state`
- primary key: `store_key`
- live row key: `singleton`
- payload column: `state JSONB`
- timestamp column: `updated_at TIMESTAMPTZ`

That shape makes export and restore straightforward, but it also means the full control-plane state should still be treated as a single stateful backup unit.

## Source checkout commands

From a repo checkout, use the built-in CLI wrappers:

```bash
flox activate -d . -- pnpm persistence:export -- --from postgres --output /tmp/parallaize-state.json
flox activate -d . -- pnpm persistence:import -- --to postgres --input /tmp/parallaize-state.json
flox activate -d . -- pnpm persistence:copy -- --from postgres --to json --to-data-file /tmp/parallaize-state.json
```

Useful variants:

```bash
flox activate -d . -- pnpm persistence:copy -- --from json --from-data-file data/state.json --to postgres
flox activate -d . -- pnpm persistence:export -- --from json --from-data-file data/state.json --output /tmp/parallaize-state.json
```

The PostgreSQL URL comes from `--database-url`, `PARALLAIZE_DATABASE_URL`, or `DATABASE_URL`.

## Packaged host commands

On packaged installs, use the packaged launcher:

```bash
parallaize-persistence export --from postgres --output /var/backups/parallaize-state.json
parallaize-persistence import --to postgres --input /var/backups/parallaize-state.json
parallaize-persistence copy --from postgres --to json --to-data-file /var/backups/parallaize-state.json
```

## Backup and restore checklist

1. Confirm the service is healthy before backup.

```bash
curl http://127.0.0.1:3000/api/health
```

2. Export state from PostgreSQL to a JSON file.
3. Optionally also copy the JSON export somewhere off-host.
4. Before a risky restore, stop the front door first, then the control plane.

```bash
sudo systemctl stop parallaize-caddy.service
sudo systemctl stop parallaize.service
```

5. Import the saved JSON back into PostgreSQL.
6. Start the control plane, validate `/api/health`, then start Caddy again.

```bash
sudo systemctl start parallaize.service
curl http://127.0.0.1:3000/api/health
sudo systemctl start parallaize-caddy.service
```

## Packaged PostgreSQL validation flow

This is the repeatable end-to-end checklist for the packaged PostgreSQL deployment path.

1. Install or upgrade PostgreSQL on the host.
2. Create the Parallaize database and credentials.
3. Edit `/etc/parallaize/parallaize.env`:

```bash
PARALLAIZE_PERSISTENCE=postgres
PARALLAIZE_DATABASE_URL=postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize
```

4. Restart the control plane:

```bash
sudo systemctl restart parallaize.service
curl http://127.0.0.1:3000/api/health
```

5. Exercise the persistence path:
   - launch a VM
   - snapshot it
   - clone it
   - delete the clone
6. Export state with `parallaize-persistence export --from postgres`.
7. Re-import that export into PostgreSQL with `parallaize-persistence import --to postgres`.
8. Restart `parallaize.service` and validate that VMs, templates, snapshots, and jobs are still present.
9. If Caddy is in use, start or restart `parallaize-caddy.service` only after the control plane health check passes.

## Upgrade ordering

For packaged upgrades, use this order:

1. Export state from PostgreSQL.
2. Stop `parallaize-caddy.service`.
3. Stop `parallaize.service`.
4. Install the new package.
5. Start `parallaize.service`.
6. Validate `/api/health` and an export round-trip.
7. Start `parallaize-caddy.service`.

If the new build fails, reinstall the previous package, import the saved export, and repeat the service start order above.
