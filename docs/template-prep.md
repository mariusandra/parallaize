# Template Prep And Maintenance

This is the repeatable path for preparing desktop-capable base images, validating the guest VNC bootstrap, and cleaning up leftover validation instances.

## What belongs in a base image

- Keep the base image focused on the desktop, display manager, Incus agent, and VNC bootstrap needed for browser access.
- Do not bake workload-specific forwarded services into the base image.
- Add forwarded ports only when you capture a workload template for an actual workload.

## Fast path: prepare a guest in place

Launch a clean workspace first, then run the host-side prep helper against its Incus instance:

```bash
flox activate -d . -- pnpm template:prep -- <instance-name>
```

What it does:

- Installs `x11vnc`
- Writes `/usr/local/bin/parallaize-x11vnc`
- Writes `/etc/systemd/system/parallaize-x11vnc.service`
- Disables the GNOME remote desktop user services that conflict with the noVNC path
- Restarts the display manager and the Parallaize VNC bridge

Useful env overrides:

```bash
PARALLAIZE_GUEST_VNC_PORT=5900
PARALLAIZE_TEMPLATE_AUTOLOGIN_USER=ubuntu
PARALLAIZE_TEMPLATE_EXTRA_PACKAGES="package-one package-two"
```

## Validation checklist

After the prep helper finishes:

1. Confirm the service is active:

```bash
flox activate -d . -- incus exec <instance-name> -- systemctl status --no-pager parallaize-x11vnc.service
```

2. Resolve the guest address:

```bash
flox activate -d . -- incus list <instance-name> --format json
```

3. Confirm the guest answers on the expected VNC port from the host:

```bash
nc -vz <guest-ip> 5900
```

4. Stop the VM before capture if you want a cleaner base image:

```bash
flox activate -d . -- incus stop <instance-name>
```

5. Capture back into the intended template entry from the UI.

## Default image notes

On this machine, checked on 2026-03-23:

- `images:ubuntu/noble/desktop` is available as a direct desktop launch source.

The seeded default picker now stays limited to launch-ready defaults. If an image needs manual prep before it becomes generally useful, prepare it with the helper above and capture it as a normal template instead of seeding it as a built-in default choice.

## Cleanup stale validation instances

List leftover smoke and churn instances:

```bash
flox activate -d . -- pnpm cleanup:incus:validation
```

Delete them:

```bash
flox activate -d . -- pnpm cleanup:incus:validation -- --delete
```

Override the prefixes if you used custom names:

```bash
flox activate -d . -- pnpm cleanup:incus:validation -- --delete my-smoke-prefix my-churn-prefix
```
