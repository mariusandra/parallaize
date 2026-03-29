# Ubuntu Template Prep

This is the repeatable operator flow for turning a fresh Ubuntu desktop VM into a reusable Parallaize template without relying on scattered notes.

## What is automatic now

Parallaize already bootstraps the default Ubuntu desktop guest for you:

- installs and enables the `x11vnc` bridge
- raises guest inotify limits for dev-heavy workloads
- installs `indicator-multiload`
- applies Ubuntu dock defaults in the desktop session:
  - dock on the right
  - 32px dock icons
- sets GNOME blank screen and inactive suspend to `Never`
- dismisses the Ubuntu first-login welcome flow before it can prompt for Ubuntu Pro, system data sharing, or App Center
- applies `Monument_valley_by_orbitelambda.jpg` on the first desktop login only when that wallpaper is present
- autostarts `indicator-multiload` in the GNOME session

You should still validate that first-boot automation succeeded before you capture a long-lived template.

## Repeatable checklist

1. Start Parallaize in live Incus mode and log into the dashboard.
2. Launch a fresh VM from `Ubuntu Agent Forge` or the current base template you want to refresh.
3. Wait for the desktop session to come up in the browser.
4. In the VM inspector, confirm:
   - the workspace has a reachable VNC session
   - the dock is on the right with smaller icons
   - Power shows blank screen set to `Never`
   - `indicator-multiload` is visible in the desktop panel
   - the Ubuntu welcome wizard does not appear
   - the wallpaper is `Monument_valley_by_orbitelambda.jpg` when that file exists in the guest image
5. Open the command console for that VM and run:

```bash
pgrep -a indicator-multiload
gsettings get org.gnome.shell.extensions.dash-to-dock dock-position
gsettings get org.gnome.shell.extensions.dash-to-dock dash-max-icon-size
gsettings get org.gnome.desktop.session idle-delay
gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type
```

6. Install any extra tools you want in the reusable image.
7. Clean up obvious one-off state before capture:
   - editor temp files
   - shell history you do not want cloned forward
   - stray package locks or failed install remnants
8. Shut the VM down if you want the cleanest capture point.
9. Use `Capture template` in the inspector:
   - choose `Update existing template` to refresh a current template in place
   - choose `Create new template` if you want to branch the image lineage
10. After capture finishes, inspect the template card and confirm the updated provenance, notes, and snapshot history match what you intended.

## Recommended capture policy

- Use template clone plus first-boot init commands when you only need package or repo differences.
- Use full template capture when the desktop itself changed and you want to preserve that exact state.
- Prefer capturing from a stopped VM when you need a clean image for broader reuse.

## Failure checks

If the desktop defaults did not land, inspect:

- `/var/log/parallaize-template-init.log`
- `systemctl status parallaize-desktop-bootstrap.service`
- `systemctl status parallaize-x11vnc.service`

If `indicator-multiload` is missing, retry:

```bash
sudo apt-get update
sudo apt-get install -y indicator-multiload
```

Then restart the desktop session or reboot the VM before capturing again.
