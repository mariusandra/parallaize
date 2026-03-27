# Signed APT Archive

Parallaize now supports a regular Ubuntu 24.04 APT source for the supported packaged path.

Current scope:

- Supported archive target: Ubuntu 24.04 `amd64`
- Archive URL: `https://archive.parallaize.com/apt`
- Suite and codename: `noble`
- Component: `main`

This path is for operators who want `apt update` plus `apt upgrade` to pick up new Parallaize releases without manually downloading a versioned `.deb` each time.

## Install

Bootstrap the archive key into a dedicated keyring file, add the source, then install `parallaize`:

```bash
sudo mkdir -p /etc/apt/keyrings /etc/apt/sources.list.d
curl -fsSL https://archive.parallaize.com/apt/parallaize-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/parallaize-archive-keyring.gpg >/dev/null
curl -fsSL https://archive.parallaize.com/apt/parallaize.sources \
  | sudo tee /etc/apt/sources.list.d/parallaize.sources >/dev/null
sudo apt-get update
sudo apt-get install -y parallaize
```

The published `parallaize.sources` file resolves to:

```deb822
Types: deb
URIs: https://archive.parallaize.com/apt
Suites: noble
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/parallaize-archive-keyring.gpg
```

If you prefer the one-line format, the equivalent entry is:

```text
deb [arch=amd64 signed-by=/etc/apt/keyrings/parallaize-archive-keyring.gpg] https://archive.parallaize.com/apt noble main
```

## Upgrade

Once the source is installed, normal APT flows work:

```bash
sudo apt-get update
sudo apt-get upgrade
```

If you want to upgrade only Parallaize:

```bash
sudo apt-get update
sudo apt-get install --only-upgrade parallaize
```

The package name stays `parallaize`, so APT compares the Debian version string and installs the newest signed archive entry automatically.

## Clean Host Validation Checklist

This is the exact Ubuntu 24.04 `amd64` archive path that still needs a clean-host validation pass:

1. Bootstrap the keyring and source file exactly as shown in the Install section.
2. Run `sudo apt-get update`.
3. Run `sudo apt-get install -y parallaize`.
4. Confirm the package came from the Parallaize archive:

```bash
apt-cache policy parallaize
dpkg -s parallaize
```

5. Rotate `/etc/parallaize/parallaize.env`, then start `parallaize.service` and validate `curl http://127.0.0.1:3000/api/health`.
6. Publish a newer package revision to the archive or stage one in a disposable test repo, then run:

```bash
sudo apt-get update
sudo apt-get install --only-upgrade parallaize
```

7. Re-check `dpkg -s parallaize`, `/api/health`, and at least one VM create plus delete cycle after the upgrade.

The clean-host claim is only closed once both the initial install and the `--only-upgrade` path succeed on a host that was not already carrying older manual package/bootstrap state.

## Published Files

Each release publishes these archive-facing files:

- `dists/noble/InRelease`: clear-signed repository metadata
- `dists/noble/Release`: unsigned repository metadata
- `dists/noble/Release.gpg`: detached signature for `Release`
- `dists/noble/main/binary-amd64/Packages` and `Packages.gz`: package index
- `pool/main/p/parallaize/*.deb`: versioned package payloads
- `parallaize-archive-keyring.gpg` and `parallaize-archive-keyring.asc`: public archive key exports
- `parallaize-archive-keyring.fingerprint`: published primary-key fingerprint
- `parallaize.list` and `parallaize.sources`: ready-to-install source definitions

The local helper command:

```bash
flox activate -d . -- pnpm package:apt-repo
```

builds an unsigned local archive under `artifacts/apt/` for inspection. The GitHub release workflow is the path that signs and publishes the real archive.

## Release Wiring

`.github/workflows/release.yml` now does this after the normal `.deb` build:

1. Imports the archive signing key into an ephemeral `GNUPGHOME`.
2. Builds `artifacts/apt/` with a standard `dists/` plus `pool/` layout.
3. Signs `dists/noble/Release` into both `InRelease` and `Release.gpg`.
4. Exports the public keyring and fingerprint alongside the archive.
5. Uploads `artifacts/apt/` to `s3://$R2_BUCKET/apt/`, which is served as `https://archive.parallaize.com/apt`.

## Key Process

APT repository trust is anchored at the archive key, not at the package files themselves. The important detail is that APT verifies the signature on `InRelease` or `Release.gpg`, then trusts the checksums recorded in `Release`, then trusts the checksums recorded in `Packages`, and only then installs the `.deb`.

That means the operator key flow should be:

1. Create an offline primary key that is used only for certification.
2. Add a signing-capable subkey that CI can use for archive signing.
3. Export the public key for users and export the secret subkeys for GitHub Actions.
4. Publish the public fingerprint in at least two places you control.
5. Configure clients with `signed-by=/etc/apt/keyrings/parallaize-archive-keyring.gpg` so this archive is pinned to the Parallaize key instead of every trusted APT key on the host.

### Generate The Initial Key

Run this on a dedicated offline machine or hardware-backed admin workstation, not on the GitHub runner:

```bash
gpg --batch --quick-gen-key \
  "Parallaize Archive Master <release@parallaize.com>" \
  ed25519 cert never

MASTER_FINGERPRINT="$(gpg --batch --with-colons --list-secret-keys "Parallaize Archive Master <release@parallaize.com>" \
  | awk -F: '/^fpr:/ { print $10; exit }')"

gpg --batch --quick-add-key "${MASTER_FINGERPRINT}" ed25519 sign 1y
```

Why this shape:

- The primary key is kept offline and is only there to certify subkeys and future rotations.
- The signing subkey is the only secret material that needs to reach CI.
- A one-year signing-subkey expiry gives you a forced review point without forcing a primary-key replacement.

### Export The Public Key And CI Signing Material

Export the public keyring users will install:

```bash
gpg --batch --export "${MASTER_FINGERPRINT}" > parallaize-archive-keyring.gpg
gpg --batch --armor --export "${MASTER_FINGERPRINT}" > parallaize-archive-keyring.asc
gpg --batch --fingerprint "${MASTER_FINGERPRINT}"
```

Export only the secret subkeys for GitHub Actions:

```bash
gpg --batch --armor --export-secret-subkeys "${MASTER_FINGERPRINT}" \
  > parallaize-archive-signing-subkeys.asc
```

Use a passphrase on the exported signing material. The release workflow expects:

- `APT_GPG_PRIVATE_KEY`: the full contents of `parallaize-archive-signing-subkeys.asc`
- `APT_GPG_PASSPHRASE`: the passphrase protecting that exported secret-subkey file
- `APT_GPG_SIGNING_KEY_ID`: the full primary fingerprint

Using the primary fingerprint as the key identifier is deliberate: GnuPG can still select the signing-capable subkey, while the repository publishes the stable primary fingerprint in `Release` and in the fingerprint artifact.

### What The Workflow Signs

The release workflow does not sign every `.deb` individually. Instead it follows the standard APT archive model:

1. Build the `.deb`.
2. Generate `Packages` and `Packages.gz`.
3. Generate `Release` with hashes for those index files.
4. Sign `Release` into `InRelease` and `Release.gpg`.

This matches the standard APT trust chain documented by `apt-secure(8)`.

### How Users Verify The Key

Users should not rely on `apt-key` for this flow. The intended pattern is:

- install the Parallaize key into `/etc/apt/keyrings/parallaize-archive-keyring.gpg`
- reference it explicitly with `Signed-By` or `signed-by=`
- compare the fingerprint against the latest GitHub release notes and the published `parallaize-archive-keyring.fingerprint`

The release workflow appends the active fingerprint and source entry to every GitHub release body so the archive site and GitHub release page can act as two independent publication channels.

## Rotation

There are two realistic rotation cases.

### Preferred: Rotate The Signing Subkey

If the offline primary key is still trusted, add a new signing subkey:

```bash
gpg --batch --quick-add-key "${MASTER_FINGERPRINT}" ed25519 sign 1y
gpg --batch --armor --export-secret-subkeys "${MASTER_FINGERPRINT}" \
  > parallaize-archive-signing-subkeys.asc
gpg --batch --export "${MASTER_FINGERPRINT}" > parallaize-archive-keyring.gpg
gpg --batch --armor --export "${MASTER_FINGERPRINT}" > parallaize-archive-keyring.asc
```

Then:

1. Update the GitHub secrets with the new `parallaize-archive-signing-subkeys.asc`.
2. Publish a release so the updated public keyring lands at `https://archive.parallaize.com/apt`.
3. Leave the primary fingerprint unchanged in client config.

This is the least disruptive path because clients continue trusting the same primary key.

### Break-Glass: Replace The Primary Key

If the primary key is compromised or must be retired entirely:

1. Generate a new offline primary key plus a new signing subkey.
2. Publish a combined public keyring that contains both the old and new public keys.
3. Keep signing releases with the old key until clients have had time to install the combined keyring.
4. Switch the workflow secret to the new signing key only after the dual-key keyring is published and documented.
5. Remove the old key from the published keyring only after a later release window.

Without a dual-key transition, existing clients will fail `apt-get update` as soon as the archive starts signing with an unknown key.

## Future Hardening

`apt-secure(8)` recommends shipping the archive key in its own keyring package so future key transitions can be distributed automatically. The current implementation deliberately starts with explicit operator-managed `signed-by` bootstrap files in `/etc/apt/keyrings` because that is the minimum correct path for Ubuntu 24.04 operators. A dedicated `parallaize-archive-keyring` package can later move the managed keyring to `/usr/share/keyrings` without changing the archive layout introduced here.
