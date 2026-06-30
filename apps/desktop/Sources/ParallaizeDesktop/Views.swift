import AppKit
import SwiftUI

private let desktopTitlebarTopPadding: CGFloat = 10
private let desktopTrafficLightInset: CGFloat = 76
private let desktopSidebarWidth: CGFloat = 260
private let desktopCollapsedHeaderDragLeading: CGFloat = 116
private let desktopCollapsedHeaderDragWidth: CGFloat = 150
private let desktopTitlebarDragHeight: CGFloat = 42

struct ContentView: View {
    @EnvironmentObject private var store: ServerStore
    @State private var showingAddServer = false
    @State private var devPromptServerID: UUID?
    @State private var devPromptFolder = DesktopServer.defaultDevFolder
    @State private var sidebarCollapsed = false

    var body: some View {
        HStack(spacing: 0) {
            if !sidebarCollapsed {
                ServerSidebar(
                    showingAddServer: $showingAddServer,
                    devPromptServerID: $devPromptServerID,
                    devPromptFolder: $devPromptFolder,
                    sidebarCollapsed: $sidebarCollapsed
                )
                .frame(width: desktopSidebarWidth)

                Divider()
            }

            ZStack(alignment: .topLeading) {
                if let server = store.selectedServer() {
                    ServerDetailView(server: server, avoidTrafficLights: sidebarCollapsed)
                        .id(server.id)
                } else {
                    EmptyServerView(showingAddServer: $showingAddServer)
                }

                if sidebarCollapsed {
                    WindowDragRegion()
                        .frame(
                            width: desktopCollapsedHeaderDragWidth,
                            height: desktopTitlebarDragHeight
                        )
                        .padding(.leading, desktopCollapsedHeaderDragLeading)

                    OpenSidebarButton(sidebarCollapsed: $sidebarCollapsed)
                }
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        .sheet(isPresented: $showingAddServer) {
            AddServerView()
                .environmentObject(store)
        }
        .sheet(isPresented: devPromptVisible) {
            DevFolderPromptView(
                folder: $devPromptFolder,
                onCancel: {
                    devPromptServerID = nil
                },
                onConfirm: {
                    guard let serverID = devPromptServerID else {
                        return
                    }

                    let folder = devPromptFolder.trimmingCharacters(in: .whitespacesAndNewlines)
                    devPromptServerID = nil
                    Task {
                        await store.configureDevMode(
                            serverID: serverID,
                            enabled: true,
                            folder: folder.isEmpty ? DesktopServer.defaultDevFolder : folder
                        )
                    }
                }
            )
        }
    }

    private var devPromptVisible: Binding<Bool> {
        Binding(
            get: { devPromptServerID != nil },
            set: { visible in
                if !visible {
                    devPromptServerID = nil
                }
            }
        )
    }
}

private struct ServerSidebar: View {
    @EnvironmentObject private var store: ServerStore
    @Binding var showingAddServer: Bool
    @Binding var devPromptServerID: UUID?
    @Binding var devPromptFolder: String
    @Binding var sidebarCollapsed: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Servers")
                    .font(.headline)
                Spacer()
                Button {
                    showingAddServer = true
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.borderless)
                .help("Add Server")
                Button {
                    sidebarCollapsed = true
                } label: {
                    Image(systemName: "sidebar.leading")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.borderless)
                .help("Collapse Sidebar")
            }
            .padding(.top, 10)
            .padding(.leading, desktopTrafficLightInset)
            .padding(.trailing, 10)
            .padding(.bottom, 6)

            SelectedServerActions()
                .padding(.horizontal, 10)
                .padding(.bottom, 8)

            List(selection: serverSelection) {
                ForEach(store.servers) { server in
                    ServerRow(server: server)
                        .tag(server.id)
                        .contextMenu {
                            Button("Reconnect") {
                                Task {
                                    await store.prepareAndConnect(server.id)
                                }
                            }

                            if server.devModeEnabled {
                                Button("Use Packaged Service") {
                                    Task {
                                        await store.configureDevMode(
                                            serverID: server.id,
                                            enabled: false,
                                            folder: nil
                                        )
                                    }
                                }
                            } else {
                                Button("Use Dev Checkout...") {
                                    devPromptFolder = server.resolvedDevFolder
                                    devPromptServerID = server.id
                                }
                            }

                            Button(server.firewallEnabled == true ? "Disable Firewall" : "Enable Firewall") {
                                Task {
                                    await store.setFirewall(
                                        serverID: server.id,
                                        enabled: server.firewallEnabled != true
                                    )
                                }
                            }

                            Button("Remove", role: .destructive) {
                                store.remove(server)
                            }
                        }
                }
            }
            .scrollContentBackground(.hidden)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var serverSelection: Binding<UUID?> {
        Binding(
            get: { store.selectedServerID },
            set: { nextSelection in
                if let nextSelection {
                    store.selectedServerID = nextSelection
                }
            }
        )
    }
}

private struct WindowDragRegion: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        DraggableView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class DraggableView: NSView {
        override var mouseDownCanMoveWindow: Bool {
            true
        }
    }
}

private struct OpenSidebarButton: View {
    @Binding var sidebarCollapsed: Bool

    var body: some View {
        Button {
            sidebarCollapsed = false
        } label: {
            Image(systemName: "sidebar.trailing")
        }
        .buttonStyle(SidebarIconButtonStyle())
        .padding(5)
        .background(.ultraThinMaterial, in: Circle())
        .padding(.top, desktopTitlebarTopPadding)
        .padding(.leading, desktopTrafficLightInset)
        .help("Expand Sidebar")
    }
}

private struct SelectedServerActions: View {
    @EnvironmentObject private var store: ServerStore

    var body: some View {
        if let server = store.selectedServer() {
            HStack(spacing: 8) {
                Button {
                    Task {
                        await store.refresh(server.id)
                    }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .help("Refresh")

                Button {
                    Task {
                        await store.prepareAndConnect(server.id)
                    }
                } label: {
                    Label("Reconnect", systemImage: "bolt.horizontal")
                        .frame(maxWidth: .infinity)
                }
                .help("Reconnect")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }
}

private struct ServerRow: View {
    let server: DesktopServer

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(server.displayName)
                    .lineLimit(1)
                Text(server.sshTarget)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
    }

    private var statusColor: Color {
        switch server.connectionState {
        case .connected:
            return .green
        case .checking, .installing, .connecting, .reconnecting:
            return .orange
        case .failed:
            return .red
        case .idle:
            return .gray
        }
    }
}

private struct ServerDetailView: View {
    @EnvironmentObject private var store: ServerStore
    let server: DesktopServer
    let avoidTrafficLights: Bool

    var body: some View {
        Group {
            if server.connectionState == .connected, let url = server.localURL {
                DesktopWebView(url: url, avoidTrafficLights: avoidTrafficLights) { reason in
                    Task { @MainActor in
                        store.scheduleReconnect(serverID: server.id, reason: reason)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
                .ignoresSafeArea(.container, edges: .top)
            } else {
                ServerSetupView(server: server)
                    .environmentObject(store)
            }
        }
    }
}

private struct SidebarIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(width: 28, height: 28)
            .background(configuration.isPressed ? Color.primary.opacity(0.16) : Color.clear)
            .clipShape(Circle())
            .contentShape(Circle())
    }
}

private struct DevFolderPromptView: View {
    @Binding var folder: String
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Dev Checkout")
                .font(.title2)

            TextField("Remote folder", text: $folder)
                .textFieldStyle(.roundedBorder)

            Text("The desktop app will sync this local checkout to the remote folder, then run pnpm install when needed, pnpm build, and pnpm start over SSH.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                Button("Use Dev Mode") {
                    onConfirm()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 480)
    }
}

private struct ServerSetupView: View {
    @EnvironmentObject private var store: ServerStore
    let server: DesktopServer

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(statusTitle)
                        .font(.title3)
                    Text(statusDetail)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if isBusy {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if let error = server.lastError {
                Text(error)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack {
                Button("Connect") {
                    Task {
                        await store.prepareAndConnect(server.id)
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isBusy)

                Button("Refresh") {
                    Task {
                        await store.refresh(server.id)
                    }
                }
                .disabled(isBusy)
            }

            if !server.setupLog.isEmpty {
                Text("Setup Log")
                    .font(.headline)
                SetupLogView(text: server.setupLog)
                    .frame(maxWidth: .infinity, minHeight: 180, maxHeight: .infinity)
                    .background(Color(nsColor: .textBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var isBusy: Bool {
        switch server.connectionState {
        case .checking, .installing, .connecting, .reconnecting:
            return true
        case .connected, .failed, .idle:
            return false
        }
    }

    private var statusTitle: String {
        switch server.connectionState {
        case .checking:
            return "Checking server"
        case .installing:
            return "Setting up Parallaize"
        case .connecting:
            return "Opening SSH tunnel"
        case .reconnecting:
            return "Reconnecting"
        case .connected:
            return "Connected"
        case .failed:
            return "Connection failed"
        case .idle:
            return "Ready to connect"
        }
    }

    private var statusDetail: String {
        switch server.connectionState {
        case .checking:
            return "Testing SSH and reading package, service, and firewall state."
        case .installing:
            return "Installing or starting the packaged Parallaize service through SSH."
        case .connecting:
            return "Forwarding a local port to the remote server."
        case .reconnecting:
            return "Re-establishing the SSH tunnel automatically."
        case .connected:
            return "The web dashboard is available through the local SSH tunnel."
        case .failed:
            return "Fix the SSH or sudo issue and reconnect."
        case .idle:
            return "Connect to open the dashboard in the desktop webview."
        }
    }
}

private struct SetupLogView: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder

        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.font = .monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: scrollView.contentSize.width, height: .greatestFiniteMagnitude)
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        scrollView.documentView = textView
        context.coordinator.textView = textView
        updateTextView(textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = context.coordinator.textView else {
            return
        }

        updateTextView(textView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func updateTextView(_ textView: NSTextView) {
        if textView.string != text {
            textView.string = text
        }

        DispatchQueue.main.async {
            textView.scrollRangeToVisible(NSRange(location: (textView.string as NSString).length, length: 0))
        }
    }

    final class Coordinator {
        weak var textView: NSTextView?
    }
}

private struct EmptyServerView: View {
    @Binding var showingAddServer: Bool

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "rectangle.connected.to.line.below")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("No Server Selected")
                .font(.title2)
            Button("Add Server") {
                showingAddServer = true
            }
            .keyboardShortcut(.defaultAction)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AddServerView: View {
    @EnvironmentObject private var store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var sshTarget = ""
    @State private var remotePort = "3000"

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add Server")
                .font(.title2)

            Form {
                TextField("Name", text: $name)
                TextField("SSH target", text: $sshTarget)
                    .textFieldStyle(.roundedBorder)
                TextField("Remote port", text: $remotePort)
                    .textFieldStyle(.roundedBorder)
            }

            Text("Use the same target you would pass to ssh, such as monster or ubuntu@203.0.113.10. SSH config and agent keys are used automatically.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Add") {
                    store.addServer(
                        name: name,
                        sshTarget: sshTarget,
                        remotePort: Int(remotePort) ?? 3000
                    )
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(sshTarget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 420)
    }
}
