import SwiftUI

@main
struct ParallaizeDesktopApp: App {
    @StateObject private var store = ServerStore()

    var body: some Scene {
        WindowGroup {
            ZStack {
                ContentView()
                    .environmentObject(store)
                    .frame(minWidth: 1100, maxWidth: .infinity, minHeight: 720, maxHeight: .infinity)
                    .ignoresSafeArea(.container, edges: .top)
                WindowChromeConfigurator()
                    .frame(width: 0, height: 0)
            }
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Reconnect") {
                    if let serverID = store.selectedServerID {
                        Task {
                            await store.prepareAndConnect(serverID)
                        }
                    }
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
    }
}
