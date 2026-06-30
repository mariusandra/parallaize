import Combine
import Foundation

@MainActor
final class ServerStore: ObservableObject {
    @Published var servers: [DesktopServer] {
        didSet {
            save()
        }
    }
    @Published var selectedServerID: UUID? {
        didSet {
            UserDefaults.standard.set(selectedServerID?.uuidString, forKey: selectedServerIDKey)
        }
    }

    private let serversKey = "com.parallaize.desktop.servers.v1"
    private let selectedServerIDKey = "com.parallaize.desktop.selectedServerID.v1"
    private let sshClient = SSHClient()
    private var healthTasks: [UUID: Task<Void, Never>] = [:]
    private var reconnectTasks: [UUID: Task<Void, Never>] = [:]
    private var tunnels: [UUID: SSHTunnel] = [:]

    init() {
        self.servers = Self.loadServers(key: serversKey)

        if
            let selectedIDString = UserDefaults.standard.string(forKey: selectedServerIDKey),
            let selectedID = UUID(uuidString: selectedIDString),
            servers.contains(where: { $0.id == selectedID })
        {
            self.selectedServerID = selectedID
        } else {
            self.selectedServerID = servers.first?.id
        }
    }

    deinit {
        for task in healthTasks.values {
            task.cancel()
        }
        for task in reconnectTasks.values {
            task.cancel()
        }
        for tunnel in tunnels.values {
            tunnel.stop()
        }
    }

    func addServer(name: String, sshTarget: String, remotePort: Int) {
        let displayName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = sshTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        let server = DesktopServer(
            name: displayName.isEmpty ? target : displayName,
            sshTarget: target,
            remotePort: remotePort
        )
        servers.append(server)
        selectedServerID = server.id

        Task {
            await prepareAndConnect(server.id)
        }
    }

    func remove(_ server: DesktopServer) {
        disconnect(server.id, cancelReconnect: true)
        servers.removeAll { $0.id == server.id }

        if selectedServerID == server.id {
            selectedServerID = servers.first?.id
        }
    }

    func selectedServer() -> DesktopServer? {
        guard let selectedServerID else {
            return nil
        }

        return servers.first { $0.id == selectedServerID }
    }

    func prepareAndConnect(_ serverID: UUID) async {
        reconnectTasks[serverID]?.cancel()
        reconnectTasks.removeValue(forKey: serverID)
        await connect(serverID, automatic: false)
    }

    func scheduleReconnect(serverID: UUID, reason: String) {
        guard reconnectTasks[serverID] == nil else {
            return
        }

        disconnect(serverID, cancelReconnect: false)
        update(serverID) {
            $0.connectionState = .reconnecting
            $0.localPort = nil
            $0.lastError = reason
            $0.setupLog = appendLog($0.setupLog, "Connection lost. Reconnecting automatically: \(reason)")
        }

        reconnectTasks[serverID] = Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            let delays: [UInt64] = [0, 2, 5, 10, 20, 30]
            var attempt = 0

            while !Task.isCancelled {
                guard self.server(withID: serverID) != nil else {
                    self.reconnectTasks.removeValue(forKey: serverID)
                    return
                }

                let delay = delays[min(attempt, delays.count - 1)]
                if delay > 0 {
                    try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                }

                if Task.isCancelled {
                    return
                }

                self.update(serverID) {
                    $0.connectionState = .reconnecting
                    $0.setupLog = appendLog($0.setupLog, "Reconnect attempt \(attempt + 1).")
                }

                await self.connect(serverID, automatic: true)

                if self.server(withID: serverID)?.connectionState == .connected {
                    self.reconnectTasks.removeValue(forKey: serverID)
                    return
                }

                attempt += 1
            }

            self.reconnectTasks.removeValue(forKey: serverID)
        }
    }

    private func connect(_ serverID: UUID, automatic: Bool) async {
        disconnect(serverID, cancelReconnect: false)
        update(serverID) {
            $0.connectionState = automatic ? .reconnecting : .checking
            $0.lastError = nil
            let mode = $0.devModeEnabled ? "remote dev checkout" : "remote package"
            $0.setupLog = appendLog($0.setupLog, "Checking SSH access and \(mode) state.")
            $0.localPort = nil
            $0.serverVersion = nil
        }

        do {
            guard let server = server(withID: serverID) else {
                return
            }

            if server.devModeEnabled {
                try await prepareDevServer(server, serverID: serverID)
            } else {
                try await preparePackagedServer(server, serverID: serverID)
            }

            update(serverID) {
                $0.connectionState = .connecting
                $0.setupLog = appendLog($0.setupLog, "Opening SSH tunnel to localhost:\($0.remotePort).")
            }
            let release = try await openTunnelAndWait(serverID: serverID)
            update(serverID) {
                $0.connectionState = .connected
                $0.serverVersion = release?.packageLabel
                $0.lastCheckedAt = Date()
                $0.setupLog = appendLog($0.setupLog, "Connected.")
            }
            startHealthMonitor(serverID)
        } catch {
            disconnect(serverID, cancelReconnect: false)
            update(serverID) {
                $0.connectionState = automatic ? .reconnecting : .failed
                $0.localPort = nil
                $0.lastError = error.localizedDescription
                $0.setupLog = appendLog($0.setupLog, error.localizedDescription)
            }
        }
    }

    func refresh(_ serverID: UUID) async {
        update(serverID) {
            $0.connectionState = $0.connectionState == .connected ? .connected : .checking
            $0.lastError = nil
            $0.setupLog = appendLog($0.setupLog, "Refreshing remote status.")
        }

        do {
            guard let server = server(withID: serverID) else {
                return
            }

            let probe = try await probe(server)
            applyProbe(probe, to: serverID)
            update(serverID) {
                $0.lastCheckedAt = Date()
                $0.setupLog = appendLog($0.setupLog, "Refresh complete.")
            }
        } catch {
            update(serverID) {
                $0.lastError = error.localizedDescription
                $0.setupLog = appendLog($0.setupLog, error.localizedDescription)
            }
        }
    }

    func setFirewall(serverID: UUID, enabled: Bool) async {
        update(serverID) {
            $0.setupLog = appendLog($0.setupLog, enabled ? "Enabling UFW firewall." : "Disabling UFW firewall.")
            $0.lastError = nil
        }

        do {
            guard let server = server(withID: serverID) else {
                return
            }

            let output = try await sshClient.setFirewall(target: server.sshTarget, enabled: enabled)
            let probe = try await probe(server)
            applyProbe(probe, to: serverID)
            update(serverID) {
                $0.setupLog = appendLog($0.setupLog, output)
                $0.lastCheckedAt = Date()
            }
        } catch {
            update(serverID) {
                $0.lastError = error.localizedDescription
                $0.setupLog = appendLog($0.setupLog, error.localizedDescription)
            }
        }
    }

    func configureDevMode(serverID: UUID, enabled: Bool, folder: String?) async {
        let previousServer = server(withID: serverID)
        disconnect(serverID, cancelReconnect: true)
        update(serverID) {
            $0.devModeEnabled = enabled
            if let folder {
                $0.devFolder = folder
            }
            $0.lastError = nil
            $0.packageVersion = nil
            $0.serverVersion = nil
            $0.serviceStatus = nil
            $0.setupLog = appendLog(
                $0.setupLog,
                enabled ? "Switched to dev mode at \($0.resolvedDevFolder)." : "Switched to packaged mode."
            )
        }

        if
            enabled == false,
            let previousServer,
            previousServer.devModeEnabled
        {
            do {
                let output = try await sshClient.stopDevServer(
                    target: previousServer.sshTarget,
                    folder: previousServer.resolvedDevFolder
                )
                update(serverID) {
                    $0.setupLog = appendLog($0.setupLog, output)
                }
            } catch {
                update(serverID) {
                    $0.lastError = error.localizedDescription
                    $0.setupLog = appendLog($0.setupLog, error.localizedDescription)
                }
            }
        }

        await prepareAndConnect(serverID)
    }

    private func preparePackagedServer(_ server: DesktopServer, serverID: UUID) async throws {
        var probe = try await sshClient.probe(
            target: server.sshTarget,
            remotePort: server.remotePort
        )
        applyProbe(probe, to: serverID)

        if probe.packageVersion == nil {
            update(serverID) {
                $0.connectionState = .installing
                $0.setupLog = appendLog($0.setupLog, "Parallaize is not installed. Installing the signed APT package.")
            }
            let installOutput = try await sshClient.installParallaize(target: server.sshTarget)
            update(serverID) {
                $0.setupLog = appendLog($0.setupLog, installOutput)
            }
            probe = try await sshClient.probe(target: server.sshTarget, remotePort: server.remotePort)
            applyProbe(probe, to: serverID)
        } else if probe.serviceStatus != "active" {
            update(serverID) {
                $0.connectionState = .installing
                $0.setupLog = appendLog($0.setupLog, "Parallaize is installed but the service is not active. Starting it.")
            }
            let startOutput = try await sshClient.startParallaizeService(target: server.sshTarget)
            update(serverID) {
                $0.setupLog = appendLog($0.setupLog, startOutput)
            }
            probe = try await sshClient.probe(target: server.sshTarget, remotePort: server.remotePort)
            applyProbe(probe, to: serverID)
        }
    }

    private func prepareDevServer(_ server: DesktopServer, serverID: UUID) async throws {
        let folder = server.resolvedDevFolder
        update(serverID) {
            $0.connectionState = .installing
            $0.setupLog = appendLog($0.setupLog, "Syncing local checkout to \(server.sshTarget):\(folder).")
        }
        let syncOutput = try await sshClient.syncDevCheckout(
            target: server.sshTarget,
            folder: folder
        )
        update(serverID) {
            $0.setupLog = appendLog($0.setupLog, syncOutput)
            $0.setupLog = appendLog($0.setupLog, "Building and starting the dev checkout at \(folder).")
        }
        var probe = try await sshClient.probeDev(target: server.sshTarget, folder: folder)
        applyProbe(probe, to: serverID)
        let output = try await sshClient.prepareDevBuild(
            target: server.sshTarget,
            folder: folder,
            remotePort: server.remotePort
        )
        update(serverID) {
            $0.setupLog = appendLog($0.setupLog, output)
        }
        probe = try await sshClient.probeDev(target: server.sshTarget, folder: folder)
        applyProbe(probe, to: serverID)
    }

    private func probe(_ server: DesktopServer) async throws -> ServerProbeResult {
        if server.devModeEnabled {
            return try await sshClient.probeDev(
                target: server.sshTarget,
                folder: server.resolvedDevFolder
            )
        }

        return try await sshClient.probe(
            target: server.sshTarget,
            remotePort: server.remotePort
        )
    }

    private func openTunnelAndWait(serverID: UUID) async throws -> CurrentReleaseMetadata? {
        guard let server = server(withID: serverID) else {
            return nil
        }

        let localPort = try reserveLocalPort()
        let tunnel = try SSHTunnel(
            target: server.sshTarget,
            remotePort: server.remotePort,
            localPort: localPort
        )
        tunnels[serverID] = tunnel
        update(serverID) {
            $0.localPort = localPort
        }

        let deadline = Date().addingTimeInterval(20)
        var lastError: Error?

        while Date() < deadline {
            if !tunnel.isRunning {
                let output = tunnel.errorOutput().trimmingCharacters(in: .whitespacesAndNewlines)
                throw TunnelError.serverDidNotRespond(
                    output.isEmpty ? "The SSH tunnel exited before the server responded." : output
                )
            }

            do {
                if let release = try await fetchCurrentRelease(localPort: localPort) {
                    return release
                }

                if try await fetchAuthStatus(localPort: localPort) {
                    return nil
                }
            } catch {
                lastError = error
            }

            try await Task.sleep(nanoseconds: 500_000_000)
        }

        let message = lastError?.localizedDescription ?? "The forwarded Parallaize server did not respond."
        throw TunnelError.serverDidNotRespond(message)
    }

    private func fetchCurrentRelease(localPort: Int) async throws -> CurrentReleaseMetadata? {
        let url = URL(string: "http://127.0.0.1:\(localPort)/api/version/current")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        let (data, response) = try await URLSession.shared.data(for: request)

        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            return nil
        }

        return try JSONDecoder().decode(ApiEnvelope<CurrentReleaseMetadata>.self, from: data).data
    }

    private func fetchAuthStatus(localPort: Int) async throws -> Bool {
        let url = URL(string: "http://127.0.0.1:\(localPort)/api/auth/status")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    private func startHealthMonitor(_ serverID: UUID) {
        healthTasks[serverID]?.cancel()
        healthTasks[serverID] = Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)

                if Task.isCancelled {
                    return
                }

                guard
                    let server = self.server(withID: serverID),
                    server.connectionState == .connected,
                    let localPort = server.localPort
                else {
                    return
                }

                if self.tunnels[serverID]?.isRunning != true {
                    self.scheduleReconnect(
                        serverID: serverID,
                        reason: "The SSH tunnel exited."
                    )
                    return
                }

                if !(await self.isLocalServerReachable(localPort: localPort)) {
                    self.scheduleReconnect(
                        serverID: serverID,
                        reason: "The forwarded local server stopped responding."
                    )
                    return
                }
            }
        }
    }

    private func isLocalServerReachable(localPort: Int) async -> Bool {
        do {
            if try await fetchCurrentRelease(localPort: localPort) != nil {
                return true
            }

            return try await fetchAuthStatus(localPort: localPort)
        } catch {
            return false
        }
    }

    private func disconnect(_ serverID: UUID, cancelReconnect: Bool) {
        healthTasks[serverID]?.cancel()
        healthTasks.removeValue(forKey: serverID)

        if cancelReconnect {
            reconnectTasks[serverID]?.cancel()
            reconnectTasks.removeValue(forKey: serverID)
        }

        tunnels[serverID]?.stop()
        tunnels.removeValue(forKey: serverID)
        update(serverID) {
            $0.localPort = nil
            if $0.connectionState == .connected {
                $0.connectionState = .idle
            }
        }
    }

    private func server(withID serverID: UUID) -> DesktopServer? {
        servers.first { $0.id == serverID }
    }

    private func applyProbe(_ probe: ServerProbeResult, to serverID: UUID) {
        update(serverID) {
            $0.packageVersion = probe.packageVersion
            $0.serviceStatus = probe.serviceStatus
            $0.firewallEnabled = probe.firewallEnabled
            $0.lastCheckedAt = Date()
        }
    }

    private func update(_ serverID: UUID, mutate: (inout DesktopServer) -> Void) {
        guard let index = servers.firstIndex(where: { $0.id == serverID }) else {
            return
        }

        mutate(&servers[index])
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(servers) else {
            return
        }

        UserDefaults.standard.set(data, forKey: serversKey)
    }

    private static func loadServers(key: String) -> [DesktopServer] {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let servers = try? JSONDecoder().decode([DesktopServer].self, from: data)
        else {
            return []
        }

        return servers.map { server in
            var nextServer = server
            nextServer.localPort = nil
            nextServer.connectionState = .idle
            nextServer.setupLog = trimLog(nextServer.setupLog)
            return nextServer
        }
    }
}

private let maxSetupLogLines = 120

private func appendLog(_ existing: String, _ next: String) -> String {
    let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmed.isEmpty {
        return trimLog(existing)
    }

    let timestamp = ISO8601DateFormatter().string(from: Date())
    let entry = "[\(timestamp)] \(trimmed)"
    return trimLog(existing.isEmpty ? entry : "\(existing)\n\(entry)")
}

private func trimLog(_ log: String) -> String {
    let lines = log.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

    if lines.count <= maxSetupLogLines {
        return log
    }

    return lines.suffix(maxSetupLogLines).joined(separator: "\n")
}
