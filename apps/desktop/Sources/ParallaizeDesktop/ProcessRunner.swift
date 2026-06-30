import Darwin
import Foundation

enum ProcessRunnerError: LocalizedError {
    case launchFailed(String)
    case nonZeroExit(command: String, status: Int32, output: String)
    case timeout(command: String, seconds: TimeInterval)

    var errorDescription: String? {
        switch self {
        case let .launchFailed(message):
            return message
        case let .nonZeroExit(command, status, output):
            let details = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if details.isEmpty {
                return "\(command) exited with status \(status)."
            }
            return "\(command) exited with status \(status):\n\(details)"
        case let .timeout(command, seconds):
            return "\(command) did not finish within \(Int(seconds)) seconds."
        }
    }
}

enum ProcessRunner {
    static func run(
        executable: String,
        arguments: [String],
        timeout: TimeInterval
    ) async throws -> ProcessResult {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()
            let command = ([executable] + arguments).joined(separator: " ")
            let completion = ProcessCompletion(continuation: continuation)

            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.standardOutput = stdout
            process.standardError = stderr
            process.terminationHandler = { terminatedProcess in
                let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
                let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
                let result = ProcessResult(
                    status: terminatedProcess.terminationStatus,
                    stdout: String(data: stdoutData, encoding: .utf8) ?? "",
                    stderr: String(data: stderrData, encoding: .utf8) ?? ""
                )
                completion.finish(.success(result))
            }

            do {
                try process.run()
            } catch {
                completion.finish(.failure(ProcessRunnerError.launchFailed(error.localizedDescription)))
                return
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                let shouldTerminate = !completion.isFinished && process.isRunning

                if shouldTerminate {
                    process.terminate()

                    DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                        if process.isRunning {
                            kill(process.processIdentifier, SIGKILL)
                        }
                    }
                }

                DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
                    if !completion.isFinished {
                        completion.finish(.failure(ProcessRunnerError.timeout(command: command, seconds: timeout)))
                    }
                }
            }
        }
    }
}

private final class ProcessCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private let continuation: CheckedContinuation<ProcessResult, Error>

    init(continuation: CheckedContinuation<ProcessResult, Error>) {
        self.continuation = continuation
    }

    var isFinished: Bool {
        lock.lock()
        defer { lock.unlock() }
        return finished
    }

    func finish(_ result: Result<ProcessResult, Error>) {
        lock.lock()
        defer { lock.unlock() }

        if finished {
            return
        }

        finished = true
        continuation.resume(with: result)
    }
}
