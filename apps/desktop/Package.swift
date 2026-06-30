// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ParallaizeDesktop",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "Parallaize", targets: ["ParallaizeDesktop"])
    ],
    targets: [
        .executableTarget(name: "ParallaizeDesktop")
    ]
)
