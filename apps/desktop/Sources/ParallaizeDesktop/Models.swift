import Foundation

enum ServerConnectionState: String, Codable {
    case idle
    case checking
    case installing
    case connecting
    case connected
    case reconnecting
    case failed
}

struct DesktopServer: Identifiable, Codable, Equatable {
    static let defaultDevFolder = "/home/marius/Projects/Parralaize/parallaize"

    var id: UUID
    var name: String
    var sshTarget: String
    var remotePort: Int
    var devModeEnabled: Bool
    var devFolder: String?
    var localPort: Int?
    var packageVersion: String?
    var serverVersion: String?
    var serviceStatus: String?
    var firewallEnabled: Bool?
    var lastCheckedAt: Date?
    var lastError: String?
    var setupLog: String
    var connectionState: ServerConnectionState

    init(
        id: UUID = UUID(),
        name: String,
        sshTarget: String,
        remotePort: Int = 3000,
        devModeEnabled: Bool = false,
        devFolder: String? = nil
    ) {
        self.id = id
        self.name = name
        self.sshTarget = sshTarget
        self.remotePort = remotePort
        self.devModeEnabled = devModeEnabled
        self.devFolder = devFolder
        self.localPort = nil
        self.packageVersion = nil
        self.serverVersion = nil
        self.serviceStatus = nil
        self.firewallEnabled = nil
        self.lastCheckedAt = nil
        self.lastError = nil
        self.setupLog = ""
        self.connectionState = .idle
    }

    var displayName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? sshTarget : name
    }

    var localURL: URL? {
        guard let localPort else {
            return nil
        }

        return URL(string: "http://127.0.0.1:\(localPort)/")
    }

    var resolvedDevFolder: String {
        let trimmed = devFolder?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? Self.defaultDevFolder : trimmed
    }

    private enum CodingKeys: String, CodingKey {
        case connectionState
        case devFolder
        case devModeEnabled
        case firewallEnabled
        case id
        case lastCheckedAt
        case lastError
        case localPort
        case name
        case packageVersion
        case remotePort
        case serverVersion
        case serviceStatus
        case setupLog
        case sshTarget
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(UUID.self, forKey: .id)
        self.name = try container.decode(String.self, forKey: .name)
        self.sshTarget = try container.decode(String.self, forKey: .sshTarget)
        self.remotePort = try container.decode(Int.self, forKey: .remotePort)
        self.devModeEnabled = try container.decodeIfPresent(Bool.self, forKey: .devModeEnabled) ?? false
        self.devFolder = try container.decodeIfPresent(String.self, forKey: .devFolder)
        self.localPort = try container.decodeIfPresent(Int.self, forKey: .localPort)
        self.packageVersion = try container.decodeIfPresent(String.self, forKey: .packageVersion)
        self.serverVersion = try container.decodeIfPresent(String.self, forKey: .serverVersion)
        self.serviceStatus = try container.decodeIfPresent(String.self, forKey: .serviceStatus)
        self.firewallEnabled = try container.decodeIfPresent(Bool.self, forKey: .firewallEnabled)
        self.lastCheckedAt = try container.decodeIfPresent(Date.self, forKey: .lastCheckedAt)
        self.lastError = try container.decodeIfPresent(String.self, forKey: .lastError)
        self.setupLog = try container.decodeIfPresent(String.self, forKey: .setupLog) ?? ""
        self.connectionState =
            try container.decodeIfPresent(ServerConnectionState.self, forKey: .connectionState) ?? .idle
    }
}

struct ServerProbeResult {
    var packageVersion: String?
    var serviceStatus: String?
    var firewallEnabled: Bool?
}

struct CurrentReleaseMetadata: Decodable {
    var version: String
    var packageRelease: String
    var packageLabel: String
}

struct ApiEnvelope<T: Decodable>: Decodable {
    var ok: Bool
    var data: T
}

struct ProcessResult {
    var status: Int32
    var stdout: String
    var stderr: String

    var combinedOutput: String {
        [stdout, stderr]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
}
