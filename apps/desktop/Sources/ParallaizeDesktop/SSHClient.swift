import Foundation

final class SSHClient {
    private let sshPath = "/usr/bin/ssh"
    private let rsyncPath = "/usr/bin/rsync"

    func probe(target: String, remotePort: Int) async throws -> ServerProbeResult {
        let script = """
        set +e
        package_version="$(dpkg-query -W -f='${Version}' parallaize 2>/dev/null || true)"
        service_status="$(systemctl is-active parallaize.service 2>/dev/null || true)"
        if command -v ufw >/dev/null 2>&1; then
          ufw_status="$(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || true)"
          case "$ufw_status" in
            *"Status: active"*) firewall_enabled="1" ;;
            *"Status: inactive"*) firewall_enabled="0" ;;
            *) firewall_enabled="unknown" ;;
          esac
        else
          firewall_enabled="missing"
        fi
        printf 'PACKAGE_VERSION=%s\\n' "$package_version"
        printf 'SERVICE_STATUS=%s\\n' "$service_status"
        printf 'FIREWALL_ENABLED=%s\\n' "$firewall_enabled"
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 20)
        try requireSuccess(result, command: "ssh probe")
        let fields = parseKeyValueOutput(result.stdout)

        return ServerProbeResult(
            packageVersion: emptyToNil(fields["PACKAGE_VERSION"]),
            serviceStatus: emptyToNil(fields["SERVICE_STATUS"]),
            firewallEnabled: parseFirewall(fields["FIREWALL_ENABLED"])
        )
    }

    func probeDev(target: String, folder: String) async throws -> ServerProbeResult {
        let folderArgument = shellQuote(folder)
        let script = """
        set +e
        dev_dir=\(folderArgument)
        if [ ! -d "$dev_dir" ]; then
          echo "Dev folder does not exist: $dev_dir" >&2
          exit 24
        fi
        package_version="$(cd "$dev_dir" && sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' package.json | head -n 1)"
        pid_file="$dev_dir/.parallaize-desktop-dev.pid"
        if [ -s "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          service_status="active"
        else
          service_status="inactive"
        fi
        if command -v ufw >/dev/null 2>&1; then
          ufw_status="$(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || true)"
          case "$ufw_status" in
            *"Status: active"*) firewall_enabled="1" ;;
            *"Status: inactive"*) firewall_enabled="0" ;;
            *) firewall_enabled="unknown" ;;
          esac
        else
          firewall_enabled="missing"
        fi
        printf 'PACKAGE_VERSION=dev %s\\n' "$package_version"
        printf 'SERVICE_STATUS=%s\\n' "$service_status"
        printf 'FIREWALL_ENABLED=%s\\n' "$firewall_enabled"
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 20)
        try requireSuccess(result, command: "ssh probe dev checkout")
        let fields = parseKeyValueOutput(result.stdout)

        return ServerProbeResult(
            packageVersion: emptyToNil(fields["PACKAGE_VERSION"]),
            serviceStatus: emptyToNil(fields["SERVICE_STATUS"]),
            firewallEnabled: parseFirewall(fields["FIREWALL_ENABLED"])
        )
    }

    func prepareDevBuild(target: String, folder: String, remotePort: Int) async throws -> String {
        let folderArgument = shellQuote(folder)
        let script = """
        set -e
        dev_dir=\(folderArgument)
        remote_port=\(remotePort)
        if [ ! -d "$dev_dir" ]; then
          echo "Dev folder does not exist: $dev_dir" >&2
          exit 24
        fi
        cd "$dev_dir"
        run_dev() {
          if command -v flox >/dev/null 2>&1; then
            flox activate -d . -- "$@"
          else
            "$@"
          fi
        }
        if [ ! -d node_modules ]; then
          run_dev pnpm install
        fi
        run_dev pnpm build
        if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet parallaize.service 2>/dev/null; then
          sudo -n systemctl stop parallaize.service 2>/dev/null || true
        fi
        pid_file="$dev_dir/.parallaize-desktop-dev.pid"
        log_file="$dev_dir/.parallaize-desktop-dev.log"
        if [ -s "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          kill "$(cat "$pid_file")" 2>/dev/null || true
          for _ in 1 2 3 4 5 6 7 8 9 10; do
            if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
              break
            fi
            sleep 0.5
          done
          if kill -0 "$(cat "$pid_file")" 2>/dev/null; then
            kill -9 "$(cat "$pid_file")" 2>/dev/null || true
          fi
        fi
        : > "$log_file"
        HOST=127.0.0.1 PORT="$remote_port" run_dev pnpm start > "$log_file" 2>&1 &
        printf '%s\\n' "$!" > "$pid_file"
        if command -v curl >/dev/null 2>&1; then
          for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
            if curl -fsS "http://127.0.0.1:$remote_port/api/version/current" >/dev/null 2>&1 || curl -fsS "http://127.0.0.1:$remote_port/api/auth/status" >/dev/null 2>&1; then
              printf 'dev server started on 127.0.0.1:%s\\n' "$remote_port"
              exit 0
            fi
            if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
              tail -n 80 "$log_file" >&2 || true
              exit 31
            fi
            sleep 0.5
          done
          tail -n 80 "$log_file" >&2 || true
          exit 32
        fi
        sleep 3
        if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          tail -n 80 "$log_file" >&2 || true
          exit 31
        fi
        printf 'dev server started on 127.0.0.1:%s\\n' "$remote_port"
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 900)
        try requireSuccess(result, command: "ssh manage dev build")
        return result.combinedOutput
    }

    func syncDevCheckout(target: String, folder: String) async throws -> String {
        let sourceURL = try resolveLocalCheckoutURL()
        let sourcePath = sourceURL.path.hasSuffix("/") ? sourceURL.path : "\(sourceURL.path)/"
        let remoteFolder = folder.hasSuffix("/") ? folder : "\(folder)/"
        let folderArgument = shellQuote(folder)
        let mkdirResult = try await runRemoteScript(
            target: target,
            script: "set -e\nmkdir -p \(folderArgument)",
            timeout: 30
        )
        try requireSuccess(mkdirResult, command: "ssh create dev folder")

        let rsyncSSH = ([sshPath] + sshBaseArguments()).joined(separator: " ")
        let arguments = [
            "-az",
            "--delete",
            "--exclude=.git/",
            "--exclude=node_modules/",
            "--exclude=dist/",
            "--exclude=artifacts/",
            "--exclude=apps/desktop/.build/",
            "--exclude=.flox/cache/",
            "--exclude=.flox/log/",
            "--exclude=.flox/run/",
            "--exclude=.DS_Store",
            "--exclude=.parallaize-desktop-dev.pid",
            "--exclude=.parallaize-desktop-dev.log",
            "-e",
            rsyncSSH,
            sourcePath,
            "\(target):\(shellQuote(remoteFolder))",
        ]
        let result = try await ProcessRunner.run(
            executable: rsyncPath,
            arguments: arguments,
            timeout: 900
        )
        try requireSuccess(result, command: "rsync dev checkout")

        let output = result.combinedOutput.trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = "synced local checkout \(sourceURL.path) to \(target):\(folder)"
        return output.isEmpty ? summary : "\(summary)\n\(output)"
    }

    func stopDevServer(target: String, folder: String) async throws -> String {
        let folderArgument = shellQuote(folder)
        let script = """
        set -e
        dev_dir=\(folderArgument)
        pid_file="$dev_dir/.parallaize-desktop-dev.pid"
        if [ -s "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          kill "$(cat "$pid_file")" 2>/dev/null || true
          rm -f "$pid_file"
          echo "stopped dev server"
        else
          echo "no managed dev server is running"
        fi
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 30)
        try requireSuccess(result, command: "ssh stop dev server")
        return result.combinedOutput
    }

    func installParallaize(target: String) async throws -> String {
        let script = """
        set -e
        if ! command -v apt-get >/dev/null 2>&1; then
          echo "Parallaize desktop setup currently expects an Ubuntu/Debian host with apt-get." >&2
          exit 20
        fi
        sudo -n true
        export DEBIAN_FRONTEND=noninteractive
        sudo -n apt-get update
        sudo -n apt-get install -y ca-certificates curl
        sudo -n install -d -m 0755 /etc/apt/keyrings /etc/apt/sources.list.d
        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "$tmp_dir"' EXIT
        curl -fsSL https://archive.parallaize.com/apt/parallaize-archive-keyring.gpg -o "$tmp_dir/parallaize-archive-keyring.gpg"
        curl -fsSL https://archive.parallaize.com/apt/parallaize.sources -o "$tmp_dir/parallaize.sources"
        sudo -n install -m 0644 "$tmp_dir/parallaize-archive-keyring.gpg" /etc/apt/keyrings/parallaize-archive-keyring.gpg
        sudo -n install -m 0644 "$tmp_dir/parallaize.sources" /etc/apt/sources.list.d/parallaize.sources
        sudo -n apt-get update
        sudo -n env DEBIAN_FRONTEND=noninteractive PARALLAIZE_INSTALL_APT_REPO_RESPONSE=yes PARALLAIZE_CREATE_LVM_POOL_RESPONSE=yes apt-get install -y parallaize
        sudo -n systemctl enable --now parallaize.service
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 900)
        try requireSuccess(result, command: "ssh install parallaize")
        return result.combinedOutput
    }

    func startParallaizeService(target: String) async throws -> String {
        let script = """
        set -e
        sudo -n systemctl enable --now parallaize.service
        systemctl is-active parallaize.service
        """
        let result = try await runRemoteScript(target: target, script: script, timeout: 60)
        try requireSuccess(result, command: "ssh start parallaize.service")
        return result.combinedOutput
    }

    func setFirewall(target: String, enabled: Bool) async throws -> String {
        let script: String

        if enabled {
            script = """
            set -e
            sudo -n true
            if ! command -v ufw >/dev/null 2>&1; then
              sudo -n apt-get update
              sudo -n apt-get install -y ufw
            fi
            sudo -n ufw default deny incoming
            sudo -n ufw default allow outgoing
            sudo -n ufw allow OpenSSH
            sudo -n ufw --force enable
            sudo -n ufw status
            """
        } else {
            script = """
            set -e
            sudo -n true
            if ! command -v ufw >/dev/null 2>&1; then
              echo "ufw is not installed"
              exit 0
            fi
            sudo -n ufw disable
            sudo -n ufw status
            """
        }

        let result = try await runRemoteScript(target: target, script: script, timeout: 120)
        try requireSuccess(result, command: enabled ? "ssh enable firewall" : "ssh disable firewall")
        return result.combinedOutput
    }

    private func runRemoteScript(
        target: String,
        script: String,
        timeout: TimeInterval
    ) async throws -> ProcessResult {
        try await ProcessRunner.run(
            executable: sshPath,
            arguments: sshBaseArguments() + [target, "sh -lc \(shellQuote(script))"],
            timeout: timeout
        )
    }

    private func sshBaseArguments() -> [String] {
        [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            "-o", "LogLevel=ERROR",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=2"
        ]
    }

    private func requireSuccess(_ result: ProcessResult, command: String) throws {
        if result.status != 0 {
            throw ProcessRunnerError.nonZeroExit(
                command: command,
                status: result.status,
                output: result.combinedOutput
            )
        }
    }

    private func parseKeyValueOutput(_ output: String) -> [String: String] {
        var fields: [String: String] = [:]

        for line in output.split(separator: "\n", omittingEmptySubsequences: false) {
            let parts = line.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2 {
                fields[String(parts[0])] = String(parts[1])
            }
        }

        return fields
    }

    private func parseFirewall(_ value: String?) -> Bool? {
        switch value {
        case "1":
            return true
        case "0":
            return false
        default:
            return nil
        }
    }

    private func emptyToNil(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func resolveLocalCheckoutURL() throws -> URL {
        let fileManager = FileManager.default
        var candidates: [URL] = []

        if let explicitPath = ProcessInfo.processInfo.environment["PARALLAIZE_DESKTOP_SYNC_SOURCE"] {
            candidates.append(URL(fileURLWithPath: explicitPath))
        }

        candidates.append(URL(fileURLWithPath: fileManager.currentDirectoryPath))

        if let executableURL = Bundle.main.executableURL {
            candidates.append(executableURL.deletingLastPathComponent())
        }

        candidates.append(Bundle.main.bundleURL)

        for candidate in candidates {
            if let checkoutURL = findCheckoutURL(startingAt: candidate) {
                return checkoutURL
            }
        }

        throw DevSyncError.checkoutNotFound
    }

    private func findCheckoutURL(startingAt initialURL: URL) -> URL? {
        let fileManager = FileManager.default
        var url = initialURL.standardizedFileURL

        var isDirectory: ObjCBool = false
        if
            fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory),
            !isDirectory.boolValue
        {
            url.deleteLastPathComponent()
        }

        for _ in 0..<12 {
            let packageURL = url.appendingPathComponent("package.json")
            let desktopPackageURL = url.appendingPathComponent("apps/desktop/Package.swift")

            if
                fileManager.fileExists(atPath: packageURL.path),
                fileManager.fileExists(atPath: desktopPackageURL.path)
            {
                return url
            }

            let parentURL = url.deletingLastPathComponent()
            if parentURL.path == url.path {
                break
            }

            url = parentURL
        }

        return nil
    }

    private func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
    }
}

private enum DevSyncError: LocalizedError {
    case checkoutNotFound

    var errorDescription: String? {
        switch self {
        case .checkoutNotFound:
            return "Could not find the local Parallaize checkout to sync. Run the desktop app from the repo, keep it under artifacts/macos, or set PARALLAIZE_DESKTOP_SYNC_SOURCE."
        }
    }
}
