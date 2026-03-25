#!/bin/sh
set -eu

bootstrap_blank_incus_host() {
  preseed_blank_incus_host() {
    storage_driver="$1"

    cat <<EOF | incus admin init --preseed >/dev/null 2>&1
config: {}
networks:
- name: incusbr0
  type: bridge
  config:
    ipv4.address: auto
    ipv6.address: auto
storage_pools:
- name: default
  driver: $storage_driver
profiles:
- name: default
  description: Default Incus profile
  config: {}
  devices:
    eth0:
      name: eth0
      network: incusbr0
      type: nic
    root:
      path: /
      pool: default
      type: disk
EOF
  }

  if ! command -v incus >/dev/null 2>&1; then
    return 0
  fi

  storage_json="$(incus storage list --format json 2>/dev/null || printf '[]')"
  profile_yaml="$(incus profile show default 2>/dev/null || printf '')"

  if incus network show incusbr0 >/dev/null 2>&1; then
    has_bridge=1
  else
    has_bridge=0
  fi

  case "$storage_json" in
    *'"name"'*)
      has_storage=1
      ;;
    *)
      has_storage=0
      ;;
  esac

  case "$profile_yaml" in
    *"devices: {}"*)
      default_profile_empty=1
      ;;
    *)
      default_profile_empty=0
      ;;
  esac

  if [ "$has_storage" -ne 0 ] || [ "$has_bridge" -ne 0 ] || [ "$default_profile_empty" -eq 0 ]; then
    return 0
  fi

  if command -v mkfs.btrfs >/dev/null 2>&1; then
    preseed_blank_incus_host btrfs || preseed_blank_incus_host dir || return 0
  else
    preseed_blank_incus_host dir || return 0
  fi

  if [ -f /etc/parallaize/parallaize.env ]; then
    if grep -q '^PARALLAIZE_INCUS_STORAGE_POOL=$' /etc/parallaize/parallaize.env; then
      sed -i 's/^PARALLAIZE_INCUS_STORAGE_POOL=$/PARALLAIZE_INCUS_STORAGE_POOL=default/' /etc/parallaize/parallaize.env
    elif ! grep -q '^PARALLAIZE_INCUS_STORAGE_POOL=' /etc/parallaize/parallaize.env; then
      printf '\nPARALLAIZE_INCUS_STORAGE_POOL=default\n' >> /etc/parallaize/parallaize.env
    fi
  fi
}

install -d -m 0750 -o parallaize -g parallaize /var/lib/parallaize

for group in incus incus-admin lxd sudo; do
  if getent group "$group" >/dev/null 2>&1; then
    usermod -a -G "$group" parallaize || true
  fi
done

bootstrap_blank_incus_host

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable parallaize-network-fix.service >/dev/null 2>&1 || true
  systemctl restart parallaize-network-fix.service >/dev/null 2>&1 || true
fi
