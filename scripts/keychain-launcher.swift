import Foundation
import Security
import Darwin

// Read one explicitly configured item. Never enumerate or change Keychain ACLs.
struct Settings: Decodable {
    let runtimeDirectory: String
    let backendConfig: String
    let keychainService: String
    let keychainAccount: String
    let organizationID: String
    let tunnelID: String
}

enum LaunchFailure: Error { case unavailable, invalid, testFailed }

func privateFile(_ path: String) throws -> Data {
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard fd >= 0 else { throw LaunchFailure.unavailable }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    defer { try? handle.close() }
    var metadata = stat()
    guard fstat(fd, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_mode & 0o777 == 0o600,
          metadata.st_uid == getuid(), metadata.st_size <= 65536,
          let data = try handle.readToEnd(), data.count <= 65536 else {
        throw LaunchFailure.invalid
    }
    return data
}

func validate(_ settings: Settings) throws {
    let values = [settings.runtimeDirectory, settings.backendConfig,
                  settings.keychainService, settings.keychainAccount,
                  settings.organizationID, settings.tunnelID]
    guard values.allSatisfy({ !$0.isEmpty && !$0.contains(where: { $0.isNewline || $0 == "\0" }) }),
          settings.runtimeDirectory.hasPrefix("/"), settings.backendConfig.hasPrefix("/"),
          settings.organizationID.range(of: "^org-[A-Za-z0-9]+$", options: .regularExpression) != nil,
          settings.tunnelID.range(of: "^tunnel_[A-Za-z0-9]+$", options: .regularExpression) != nil else {
        throw LaunchFailure.invalid
    }
}

func readItem(_ settings: Settings) throws -> Data {
    var keychain: SecKeychain?
    guard SecKeychainOpen(NSHomeDirectory() + "/Library/Keychains/login.keychain-db", &keychain) == errSecSuccess,
          let keychain else { throw LaunchFailure.unavailable }
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: settings.keychainService,
        kSecAttrAccount as String: settings.keychainAccount,
        kSecMatchSearchList as String: [keychain],
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: true
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { throw LaunchFailure.unavailable }
    return data
}

func environment(readKey: () throws -> Data, readBearer: () throws -> String) throws -> [String: String] {
    let data = try readKey()
    guard let key = String(data: data, encoding: .utf8), key.hasPrefix("sk-"),
          key.utf8.count > 3, key.utf8.count <= 8192,
          key.utf8.allSatisfy({ $0 >= 33 && $0 <= 126 }) else { throw LaunchFailure.invalid }
    let bearer = try readBearer()
    guard bearer.utf8.count >= 32, bearer.utf8.count <= 4096,
          bearer.utf8.allSatisfy({ $0 >= 33 && $0 <= 126 }) else { throw LaunchFailure.invalid }
    return ["PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "LANG": "en_US.UTF-8",
            "CONTROL_PLANE_API_KEY": key, "DOTG_MCP_AUTHORIZATION": "Bearer " + bearer]
}

func arguments(_ settings: Settings) -> [String] {
    ["run", "--profile", "dotg", "--profile-dir", settings.runtimeDirectory + "/profiles",
     "--control-plane.base-url", "https://api.openai.com",
     "--control-plane.organization-id", settings.organizationID,
     "--control-plane.tunnel-id", settings.tunnelID,
     "--control-plane.api-key", "env:CONTROL_PLANE_API_KEY",
     "--mcp.server-url", "http://127.0.0.1:8787/mcp",
     "--mcp.extra-headers", "Authorization: env:DOTG_MCP_AUTHORIZATION",
     "--mcp.discovery-extra-headers", "Authorization: env:DOTG_MCP_AUTHORIZATION",
     "--health.listen-addr", "127.0.0.1:0",
     "--health.url-file", settings.runtimeDirectory + "/health.url",
     "--open-web-ui=false", "--allow-remote-ui=false", "--tracing.enabled=false"]
}

func configureInteraction(background: Bool) throws {
    // Background retries must never prompt or change the item's access policy.
    // Existing authorization still applies; locked/confirmation-only access fails.
    if background && SecKeychainSetUserInteractionAllowed(false) != errSecSuccess {
        throw LaunchFailure.unavailable
    }
}

func launch(_ settings: Settings, background: Bool = false) throws {
    try validate(settings)
    try configureInteraction(background: background)
    let executable = settings.runtimeDirectory + "/bin/tunnel-client"
    var metadata = stat()
    guard lstat(settings.runtimeDirectory, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFDIR, metadata.st_mode & 0o077 == 0,
          metadata.st_uid == getuid(),
          lstat(executable, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_mode & 0o022 == 0, metadata.st_uid == getuid(),
          access(executable, X_OK) == 0 else { throw LaunchFailure.invalid }
    let env = try environment(readKey: { try readItem(settings) }, readBearer: {
        let object = try JSONSerialization.jsonObject(with: privateFile(settings.backendConfig))
        guard let config = object as? [String: Any], let bearer = config["mcpBearerToken"] as? String else {
            throw LaunchFailure.invalid
        }
        return bearer
    })
    guard chdir(settings.runtimeDirectory) == 0 else { throw LaunchFailure.unavailable }
    // exec preserves the PID and normal signal semantics: no orphan child on stop.
    let argv = ([executable] + arguments(settings)).map { strdup($0) } + [nil]
    let envp = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { for pointer in argv + envp { free(pointer) } }
    // Raw client output may contain sensitive diagnostics; inspect loopback health.
    let null = open("/dev/null", O_RDWR)
    guard null >= 0 else { throw LaunchFailure.unavailable }
    for target in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
        guard dup2(null, target) >= 0 else { close(null); throw LaunchFailure.unavailable }
    }
    if null > STDERR_FILENO { close(null) }
    execve(executable, argv, envp)
    throw LaunchFailure.unavailable
}

func selfTest() throws {
    // Synthetic inputs only: no Keychain reads or client process execution.
    var previous: DarwinBoolean = false
    guard SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess else { throw LaunchFailure.testFailed }
    defer { SecKeychainSetUserInteractionAllowed(previous.boolValue) }
    try configureInteraction(background: true)
    var allowed: DarwinBoolean = true
    guard SecKeychainGetUserInteractionAllowed(&allowed) == errSecSuccess, !allowed.boolValue else { throw LaunchFailure.testFailed }
    let settings = Settings(runtimeDirectory: "/tmp/dotg-synthetic", backendConfig: "/tmp/config-synthetic.json",
                            keychainService: "synthetic-service", keychainAccount: "synthetic-account",
                            organizationID: "org-synthetic", tunnelID: "tunnel_synthetic")
    try validate(settings)
    let key = "sk-public-synthetic", bearer = String(repeating: "synthetic", count: 8)
    var reads = 0
    let env = try environment(readKey: { reads += 1; return Data(key.utf8) }, readBearer: { bearer })
    guard reads == 1, env.count == 5, env["CONTROL_PLANE_API_KEY"] == key,
          env["DOTG_MCP_AUTHORIZATION"] == "Bearer " + bearer,
          !arguments(settings).contains(where: { $0.contains(key) || $0.contains(bearer) }) else {
        throw LaunchFailure.testFailed
    }
    for invalid in ["", "sk-", "wrong-prefix", "sk-has space", "sk-newline\n", "sk-null\0", "sk-é"] {
        do {
            _ = try environment(readKey: { Data(invalid.utf8) }, readBearer: { bearer })
            throw LaunchFailure.testFailed
        } catch LaunchFailure.invalid { }
    }
    for invalid in ["", "short", bearer + "\n", bearer + "\r", bearer + " ", bearer + "é"] {
        do {
            _ = try environment(readKey: { Data(key.utf8) }, readBearer: { invalid })
            throw LaunchFailure.testFailed
        } catch LaunchFailure.invalid { }
    }
    do {
        _ = try environment(readKey: { throw LaunchFailure.unavailable }, readBearer: { bearer })
        throw LaunchFailure.testFailed
    } catch LaunchFailure.unavailable { }
    print("PASS: exact environment, secret-free arguments, background interaction disabled, invalid input and denied-read handling; no Keychain access or process launch.")
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    if args == ["--self-test"] {
        try selfTest()
    } else if args.count == 2 && ["--run", "--run-background"].contains(args[0]) {
        let settings = try JSONDecoder().decode(Settings.self, from: privateFile(args[1]))
        try launch(settings, background: args[0] == "--run-background")
    } else {
        fputs("Usage: dotg-keychain-launcher --self-test | (--run | --run-background) /absolute/path/launcher.local.json\n", stderr)
        exit(2)
    }
} catch {
    fputs("dotg launcher failed closed; no secret diagnostics emitted.\n", stderr)
    exit(78)
}
