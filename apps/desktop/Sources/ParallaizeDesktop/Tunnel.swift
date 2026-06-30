import Darwin
import Foundation

enum TunnelError: LocalizedError {
    case noAvailablePort
    case serverDidNotRespond(String)

    var errorDescription: String? {
        switch self {
        case .noAvailablePort:
            return "Could not reserve a local tunnel port."
        case let .serverDidNotRespond(message):
            return message
        }
    }
}

final class SSHTunnel {
    let localPort: Int
    private let process: Process
    private let stderr: Pipe

    init(target: String, remotePort: Int, localPort: Int) throws {
        self.localPort = localPort
        self.process = Process()
        self.stderr = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-N",
            "-L", "127.0.0.1:\(localPort):127.0.0.1:\(remotePort)",
            "-o", "BatchMode=yes",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "LogLevel=ERROR",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=2",
            target
        ]
        process.standardError = stderr
        try process.run()
    }

    var isRunning: Bool {
        process.isRunning
    }

    func stop() {
        if process.isRunning {
            process.terminate()
        }
    }

    func errorOutput() -> String {
        let data = stderr.fileHandleForReading.availableData
        return String(data: data, encoding: .utf8) ?? ""
    }
}

func reserveLocalPort() throws -> Int {
    let fileDescriptor = socket(AF_INET, SOCK_STREAM, 0)

    if fileDescriptor < 0 {
        throw TunnelError.noAvailablePort
    }

    defer {
        close(fileDescriptor)
    }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(0).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            bind(fileDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }

    if bindResult != 0 {
        throw TunnelError.noAvailablePort
    }

    var boundAddress = sockaddr_in()
    var boundAddressLength = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameResult = withUnsafeMutablePointer(to: &boundAddress) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            getsockname(fileDescriptor, sockaddrPointer, &boundAddressLength)
        }
    }

    if nameResult != 0 {
        throw TunnelError.noAvailablePort
    }

    return Int(UInt16(bigEndian: boundAddress.sin_port))
}
