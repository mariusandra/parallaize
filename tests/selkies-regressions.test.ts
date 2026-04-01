import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hasReachableVncSession } from "../apps/control/src/manager-core.js";
import { createProvider } from "../apps/control/src/providers.js";
import {
  buildExpectedGuestDesktopBridgeVersionRecord,
  buildEnsureGuestDesktopBootstrapScript,
  buildGuestSelkiesCloudInit,
} from "../apps/control/src/ubuntu-guest-init.js";

function readCommandInput(
  options?: { input?: Buffer | string },
): string {
  if (typeof options?.input === "string") {
    return options.input;
  }

  return Buffer.isBuffer(options?.input) ? options.input.toString("utf8") : "";
}

function extractEmbeddedPythonBlock(
  script: string,
  shellVariable: string,
  nextShellVariable: string,
): string {
  const startMarker = `python3 - "$${shellVariable}" <<'PY'\n`;
  const start = script.indexOf(startMarker);
  assert.notEqual(start, -1, `missing embedded Python block for ${shellVariable}`);
  const endMarker = `\nPY\n  fi\n  ${nextShellVariable}=`;
  const end = script.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker after ${shellVariable}`);
  return script.slice(start + startMarker.length, end);
}

function extractRawEmbeddedPythonBlock(
  script: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = script.indexOf(startMarker);
  assert.notEqual(start, -1, `missing embedded Python block starting at ${startMarker}`);
  const end = script.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing embedded Python block ending at ${endMarker}`);
  return script.slice(start + startMarker.length, end);
}

test("Selkies bootstrap repair keeps the guest bootstrap script on Selkies", () => {
  const expectedDesktopBridgeVersion =
    buildExpectedGuestDesktopBridgeVersionRecord("selkies");
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );

  assert.match(script, /DESKTOP_SERVICE_NAME="parallaize-selkies\.service"/);
  assert.match(script, /LAUNCHER_FILE="\/usr\/local\/bin\/parallaize-selkies"/);
  assert.match(script, /After=display-manager\.service\nWants=display-manager\.service\nConditionPathExists=\/usr\/local\/bin\/parallaize-selkies/);
  assert.match(script, /def schedule_setup_call\(signalling_client, retry_key, delay=0\.0\):/);
  assert.match(script, /schedule_setup_call\(signalling, "video", 1\.5\)/);
  assert.match(script, /parallaizePreviewMode/);
  assert.match(script, /preview_peer_id = 11/);
  assert.match(script, /preview_signalling = WebRTCSignalling/);
  assert.match(
    script,
    /if ! command -v import >\/dev\/null 2>&1; then\n  MISSING_PACKAGES="\$MISSING_PACKAGES imagemagick"\nfi/,
  );
  assert.match(
    script,
    /if ! command -v xsel >\/dev\/null 2>&1; then\n  MISSING_PACKAGES="\$MISSING_PACKAGES xsel"\nfi/,
  );
  assert.match(script, /main_loop = asyncio\.get_event_loop\(\)/);
  assert.match(script, /browserVideoPeerId = parallaizePreviewMode \? 11 : 1/);
  assert.match(
    script,
    /this\.peer_id = new URLSearchParams\(window\.location\.search\)\.get\("parallaize_preview"\) === "1" \? 11 : 1/,
  );
  assert.match(
    script,
    /videoElement\.autoplay = true;\nvideoElement\.muted = true;\nvideoElement\.playsInline = true;\nif \(parallaizePreviewMode\) \{\n    audioElement\.muted = true;\n\}/,
  );
  assert.match(script, /var parallaizeVideoPlayRetryTimer = null;/);
  assert.match(script, /var parallaizeVideoPlayRetryCount = 0;/);
  assert.match(script, /var parallaizeDataChannelOpen = false;/);
  assert.match(script, /var parallaizePendingDataChannelMessages = \[\];/);
  assert.match(script, /function parallaizeHasRenderableVideo\(\) \{/);
  assert.match(script, /function parallaizeHasActiveVideoPlayback\(\) \{/);
  assert.match(script, /function parallaizeSyncPlayableStreamState\(\) \{/);
  assert.match(script, /function parallaizeSendDataChannelMessage\(message, queueIfUnavailable = true\) \{/);
  assert.match(script, /function parallaizeFlushPendingDataChannelMessages\(\) \{/);
  assert.match(script, /function parallaizeScheduleAutoplayRetry\(delay\) \{/);
  assert.match(script, /var parallaizeAudioActivationPending = !parallaizePreviewMode;/);
  assert.match(script, /var parallaizeAudioConnectRequested = parallaizePreviewMode;/);
  assert.match(script, /function parallaizeMaybeConnectAudio\(\) \{/);
  assert.match(script, /function parallaizeMaybeActivateAudio\(\) \{/);
  assert.match(script, /window\.addEventListener\("pointerdown", parallaizeMaybeActivateAudio, \{ capture: true \}\);/);
  assert.match(
    script,
    /function parallaizeMaybeAutoplayVideo\(delay = 0\) \{\n    if \(parallaizePreviewMode\) \{\n        return;\n    \}/,
  );
  assert.match(script, /if \(videoElement\.srcObject === null\) \{/);
  assert.match(script, /const playPromise = videoElement\.play\(\);/);
  assert.match(script, /parallaizeSyncPlayableStreamState\(\);\n            parallaizeMaybeConnectAudio\(\);/);
  assert.match(
    script,
    /videoElement\.addEventListener\('playing', \(\) => \{\n    if \(parallaizePreviewMode\) \{\n        return;\n    \}\n    parallaizeSyncPlayableStreamState\(\);\n    parallaizeMaybeConnectAudio\(\);\n    parallaizeMaybeActivateAudio\(\);\n\}\)/,
  );
  assert.match(script, /connectionType: "preview"/);
  assert.match(script, /async def on_audio_signalling_connect\(\):\n       return/);
  assert.match(script, /async def on_preview_signalling_connect\(\):\n       return/);
  assert.match(script, /audio_signalling\.on_connect = on_audio_signalling_connect/);
  assert.match(script, /preview_signalling\.on_connect = on_preview_signalling_connect/);
  assert.match(script, /preview_app = GSTWebRTCApp/);
  assert.match(script, /def schedule_signalling_restart\(signalling_client, retry_key, delay=0\.0\):/);
  assert.match(script, /main_loop\.call_soon_threadsafe\(\n\s+schedule_setup_call,/);
  assert.match(script, /def on_preview_signalling_disconnect\(\):/);
  assert.match(script, /preview_signalling\.on_sdp = preview_app\.set_sdp/);
  assert.match(script, /preview_signalling\.on_ice = preview_app\.set_ice/);
  assert.match(script, /logger\.warning\("Replacing existing peer %r at %r with a new connection from %r", uid, self\.peers\[uid\]\[1\], raddr\)/);
  assert.match(script, /async def remove_peer\(self, uid, ws=None\):/);
  assert.match(script, /logger\.info\("Ignoring stale disconnect for peer %r at %r", uid, raddr\)/);
  assert.match(script, /await self\.remove_peer\(uid\)/);
  assert.match(script, /await self\.remove_peer\(peer_id, ws\)/);
  assert.match(script, /enable_desktop_service\(\) \{/);
  assert.match(script, /ln -sf "\$SERVICE_FILE" "\/etc\/systemd\/system\/multi-user\.target\.wants\/\$DESKTOP_SERVICE_NAME"/);
  assert.match(script, /var checkconnect = app\.status === "checkconnect";/);
  assert.match(
    script,
    /signalling\.ondisconnect = \(\) => \{\n    console\.log\("signalling disconnected"\);\n    const activeVideoPlayback = parallaizeHasActiveVideoPlayback\(\);\n    const peerConnectionState =\n        webrtc\.peerConnection !== null \? webrtc\.peerConnection\.connectionState : "";\n    const iceConnectionState =\n        webrtc\.peerConnection !== null \? webrtc\.peerConnection\.iceConnectionState : "";\n    if \(\n        videoConnected === "connected" \|\|\n        activeVideoPlayback \|\|\n        peerConnectionState === "connecting" \|\|\n        peerConnectionState === "connected" \|\|\n        iceConnectionState === "checking" \|\|\n        iceConnectionState === "connected" \|\|\n        iceConnectionState === "completed"\n    \) \{\n        if \(videoConnected === "connected" \|\| activeVideoPlayback\) \{\n            app\.status = "connected";\n            app\.showStart = false;\n            app\.loadingText = "";\n        \}\n        return;\n    \}\n    var checkconnect = app\.status === "checkconnect";\n    app\.status = 'connecting';\n    videoElement\.style\.cursor = "auto";\n    webrtc\.reset\(\);\n    app\.status = 'checkconnect';\n    if \(!checkconnect\) audio_signalling\.disconnect\(\);\n\}/,
  );
  assert.match(script, /elif str\(session_peer_id\) == str\(preview_peer_id\):/);
  assert.match(script, /clear_setup_call_retry\("preview"\)/);
  assert.match(script, /preview_app\.on_sdp = preview_signalling\.send_sdp/);
  assert.match(script, /preview_app\.on_ice = preview_signalling\.send_ice/);
  assert.match(
    script,
    /preview_app\.on_data_close = lambda: None/,
  );
  assert.match(
    script,
    /def on_preview_signalling_disconnect\(\):\n        clear_setup_call_retry\("preview"\)\n        preview_app\.stop_pipeline\(\)\n\n    signalling\.on_disconnect = lambda: app\.stop_pipeline\(\)/,
  );
  assert.match(
    script,
    /preview_app\.on_data_close = lambda: None\n    preview_app\.on_data_error = lambda: None/,
  );
  assert.match(script, /self\._stopping_pipeline = False/);
  assert.match(script, /if self\._stopping_pipeline:\n            logger\.info\("pipeline stop already in progress"\)\n            return/);
  assert.match(script, /data_channel = self\.data_channel\n                self\.data_channel = None\n                data_channel\.emit\('close'\)/);
  assert.match(script, /starting preview video pipeline/);
  assert.match(script, /asyncio\.ensure_future\(preview_app\.handle_bus_calls\(\), loop=loop\)/);
  assert.match(
    script,
    /finally:\n        app\.stop_pipeline\(\)\n        preview_app\.stop_pipeline\(\)\n        audio_app\.stop_pipeline\(\)/,
  );
  assert.match(script, /loop\.run_until_complete\(preview_signalling\.connect\(\)\)/);
  assert.match(script, /asyncio\.ensure_future\(preview_signalling\.start\(\), loop=loop\)/);
  assert.match(script, /if \(videoConnected === "connected"\) \{\n        app\.status = "connected"/);
  assert.match(
    script,
    /if \(videoConnected === "connected"\) \{\n        webrtc\.playStream\(\);\n        parallaizeMaybeAutoplayVideo\(50\);\n        app\.status = "connected";\n        if \(parallaizePreviewMode\) \{\n            app\.showStart = false;\n        \}/,
  );
  assert.match(script, /parallaizeMaybeConnectAudio\(\);/);
  assert.match(
    script,
    /audio_webrtc\.onplaystreamrequired = \(\) => \{\n    if \(parallaizePreviewMode \|\| videoConnected === "connected" \|\| parallaizeHasActiveVideoPlayback\(\)\) \{/,
  );
  assert.match(
    script,
    /webrtc\.onplaystreamrequired = \(\) => \{\n    if \(parallaizePreviewMode\) \{\n        webrtc\.playStream\(\);\n        app\.showStart = false;\n        return;\n    \}\n    parallaizeMaybeAutoplayVideo\(250\);/,
  );
  assert.match(script, /this\._setStatus\("Connection error, retrying\."\);/);
  assert.match(script, /shutdownSelkiesStream/);
  assert.match(script, /window\.addEventListener\("pagehide", shutdownSelkiesStream\);/);
  assert.match(script, /this\._suppressDisconnect = true;/);
  assert.match(script, /this\._retryTimer = null;/);
  assert.match(script, /function parallaizeApplyTransientStreamProfile\(profile\) \{/);
  assert.match(script, /function parallaizeApplyBackgroundStreamProfile\(\) \{/);
  assert.match(script, /function parallaizeSetBackgroundMode\(background\) \{/);
  assert.match(script, /var parallaizeGuestClipboardListeners = new Set\(\);/);
  assert.match(script, /window\.parallaizeWriteGuestClipboard = \(text\) => \{/);
  assert.match(script, /window\.parallaizeGetStreamScale = \(\) => \{/);
  assert.match(script, /window\.parallaizeSetStreamScale = \(scale\) => \{/);
  assert.match(script, /window\.parallaizeRequestGuestClipboard = \(\) => \{/);
  assert.match(script, /window\.parallaizeTriggerGuestPaste = \(\) => \{/);
  assert.match(script, /window\.parallaizeSubscribeGuestClipboard = \(listener\) => \{/);
  assert.match(script, /window\.parallaizeGetStreamState = \(\) => \{/);
  assert.match(script, /const activeVideoPlayback = parallaizeHasActiveVideoPlayback\(\);/);
  assert.match(script, /window\.parallaizeKickStream = \(reason = 'manual'\) => \{/);
  assert.match(script, /function parallaizeResolveStreamScale\(\) \{/);
  assert.match(script, /function parallaizeApplyStreamPixelation\(\) \{/);
  assert.match(script, /function parallaizeSyncStreamScale\(sendResolution = true\) \{/);
  assert.match(script, /parallaizeNotifyGuestClipboardListeners\(content\);/);
  assert.match(script, /export SELKIES_CURSOR_SIZE="\$\{SELKIES_CURSOR_SIZE:-24\}"/);
  assert.match(script, /SELKIES_PATCH_LEVEL="2026-04-01-1"/);
  assert.match(script, /SELKIES_PATCH_LEVEL_FILE="\$SELKIES_INSTALL_DIR\/\.parallaize-selkies-patch-level"/);
  assert.match(script, /DESKTOP_BRIDGE_VERSION_FILE="\/var\/lib\/parallaize\/desktop-bridge-version\.json"/);
  assert.match(script, /DESKTOP_USER="ubuntu"/);
  assert.match(script, /export HOME="\$DESKTOP_HOME"/);
  assert.match(script, /export XDG_RUNTIME_DIR="\/run\/user\/\$DESKTOP_UID"/);
  assert.match(script, /exec runuser --preserve-environment -u "\$DESKTOP_USER" --/);
  assert.match(script, /env\s+DISPLAY="\$DISPLAY"\s+XAUTHORITY="\$XAUTHORITY"/);
  assert.match(script, /STREAM_HEALTH_SERVICE_NAME="parallaize-selkies-heartbeat\.service"/);
  assert.match(script, /Description=Parallaize Selkies stream health/);
  assert.match(script, /if ! python3 -c 'import websockets' >\/dev\/null 2>&1; then/);
  assert.match(script, /SOURCE = "parallaize-selkies-heartbeat"/);
  assert.match(script, /enable_stream_health_service\(\) \{/);
  assert.match(script, /systemctl restart --no-block "\$STREAM_HEALTH_SERVICE_NAME" \|\| true/);
  assert.match(script, /RESET_DISPLAY_STATE_ON_REPAIR=0/);
  assert.equal(script.includes(`"label": "${expectedDesktopBridgeVersion.label}"`), true);
  assert.match(script, /validate_selkies_bundle\(\) \{/);
  assert.match(script, /Selkies patch-level drift detected, reinstalling runtime from a clean archive\./);
  assert.match(script, /Selkies bundle validation failed, reinstalling runtime from a clean archive\./);
  assert.match(script, /except \(subprocess\.SubprocessError, OSError\) as e:/);
  assert.doesNotMatch(script, /function parallaizeBuildCursorUrl\(curdata\) \{/);
  assert.doesNotMatch(script, /const cursorDevicePixelRatio = parallaizeCursorDevicePixelRatio\(\);/);
  assert.doesNotMatch(script, /parallaizeScaleCursorHotspotCoordinate\(hotspot\.x, cursorDevicePixelRatio\)/);
  assert.match(script, /parallaizeSendDataChannelMessage\('vb,' \+ profile\.videoBitRate\);/);
  assert.match(script, /parallaizeSendDataChannelMessage\('_arg_fps,' \+ profile\.videoFramerate\);/);
  assert.match(script, /parallaizeSendDataChannelMessage\('ab,' \+ profile\.audioBitRate\);/);
  assert.match(
    script,
    /webrtc\.ondatachannelopen = \(\) => \{\n    if \(parallaizePreviewMode\) \{\n        return;\n    \}\n    parallaizeDataChannelOpen = true;\n    parallaizeSyncStreamScale\(true\);\n    if \(parallaizeBackgroundMode\) \{\n        parallaizeApplyBackgroundStreamProfile\(\);\n    \}\n    parallaizeFlushPendingDataChannelMessages\(\);/,
  );
  assert.match(script, /webrtc\.ondatachannelclose = \(\) => \{\n    parallaizeDataChannelOpen = false;/);
  assert.match(
    script,
    /if \(!parallaizeBackgroundMode\) {\n\s+parallaizeBackgroundRestoreProfile = {\n\s+audioBitRate: app\.audioBitRate,/,
  );
  assert.match(script, /if \(parallaizeBackgroundMode\) {\n\s+parallaizeApplyBackgroundStreamProfile\(\);\n\s+}/);
  assert.match(script, /window\.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;/);
  assert.match(
    script,
    /signalling\.onstatus = \(message\) => \{\n    if \(!parallaizeHasActiveVideoPlayback\(\)\) \{\n        app\.loadingText = message;\n    \}/,
  );
  assert.match(
    script,
    /audio_signalling\.onstatus = \(message\) => \{\n    if \(!parallaizeHasActiveVideoPlayback\(\)\) \{\n        app\.loadingText = message;\n    \}/,
  );
  assert.match(
    script,
    /audio_signalling\.ondisconnect = \(\) => \{\n    console\.log\("audio signalling disconnected"\);\n    audioConnected = "";\n    if \(videoConnected === "connected"\) \{\n        app\.status = "connected";\n        app\.showStart = false;\n        app\.loadingText = "";\n    \}\n\}/,
  );
  assert.match(script, /}, 1500\);/);
  assert.match(script, /}, 1000\);/);
  assert.match(script, /SELKIES_ENABLE_RESIZE="true"/);
  assert.match(
    script,
    /webrtc\.input\.onresizeend = \(\) => \{\n    if \(parallaizePreviewMode \|\| app\.resizeRemote !== true\) \{\n        return;\n    \}/,
  );
  assert.match(script, /parallaizeSyncStreamScale\(true\);/);
  assert.match(script, /parallaizeSendDataChannelMessage\("r," \+ newRes\);/);
  assert.match(script, /parallaizeSendDataChannelMessage\("s," \+ parallaizeResolveStreamScale\(\)\);/);
  assert.match(script, /parallaizeDataChannelOpen = false;\n    parallaizePendingDataChannelMessages = \[\];/);
  assert.match(script, /:root\[data-parallaize-stream-pixelated="true"\] \.video \{ image-rendering: crisp-edges; image-rendering: pixelated; \}/);
  assert.match(script, /document\.documentElement\.dataset\.parallaizeStreamPixelated = pixelated \? "true" : "false";/);
  assert.match(script, /NETWORK_WAIT_ONLINE_OVERRIDE_FILE="\/etc\/systemd\/system\/systemd-networkd-wait-online\.service\.d\/10-parallaize\.conf"/);
  assert.match(script, /PLYMOUTH_QUIT_WAIT_OVERRIDE_FILE="\/etc\/systemd\/system\/plymouth-quit-wait\.service\.d\/10-parallaize\.conf"/);
  assert.match(script, /ExecStart=\/bin\/true/);
  assert.match(script, /systemctl stop --no-block plymouth-quit-wait\.service >\/dev\/null 2>&1 \|\| true/);
  assert.doesNotMatch(script, /network-online\.target/);
  assert.doesNotMatch(script, /After=display-manager\.service parallaize-desktop-bootstrap\.service/);
  assert.doesNotMatch(script, /DESKTOP_SERVICE_NAME="parallaize-x11vnc\.service"/);
  assert.doesNotMatch(script, /LAUNCHER_FILE="\/usr\/local\/bin\/parallaize-x11vnc"/);
  assert.doesNotMatch(script, /time\.sleep\(2\)\n           await signalling\.setup_call\(\)/);
});

test("Aggressive desktop bridge repair resets stale monitor layout", () => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "aggressive",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );

  assert.match(script, /RESET_DISPLAY_STATE_ON_REPAIR=1/);
  assert.match(script, /GUEST_MONITORS_FILE="\/home\/ubuntu\/\.config\/monitors\.xml"/);
  assert.match(script, /GDM_MONITORS_FILE="\/var\/lib\/gdm3\/\.config\/monitors\.xml"/);
  assert.match(script, /reset_guest_display_state\(\) \{/);
  assert.match(
    script,
    /for DISPLAY_STATE_FILE in "\$GUEST_MONITORS_FILE" "\$GDM_MONITORS_FILE"; do/,
  );
  assert.match(script, /rm -f "\$DISPLAY_STATE_FILE"/);
  assert.match(script, /rm -f "\$DESKTOP_HEALTH_PENDING_FILE" "\$DESKTOP_GDM_RESTART_FILE"/);
  assert.match(script, /RESTART_GDM=1\n    RESTART_DESKTOP=1/);
  assert.match(script, /reset_guest_display_state\nif \[ "\$CURRENT_DESKTOP_BRIDGE_VERSION" != "\$DESIRED_DESKTOP_BRIDGE_VERSION" \]; then/);
});

test("Selkies embedded Python patches stay syntactically valid", () => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );
  const mainPythonBlock = extractEmbeddedPythonBlock(
    script,
    "SELKIES_MAIN_FILE",
    "SELKIES_SIGNALING_SERVER_FILE",
  );
  const signallingPythonBlock = extractEmbeddedPythonBlock(
    script,
    "SELKIES_SIGNALING_SERVER_FILE",
    "SELKIES_SIGNALING_CLIENT_FILE",
  );
  const signallingClientPythonBlock = extractEmbeddedPythonBlock(
    script,
    "SELKIES_SIGNALING_CLIENT_FILE",
    "SELKIES_GST_APP_FILE",
  );

  assert.doesNotMatch(
    signallingPythonBlock,
    /contents = contents\.replace\(\n\s+"[^"]*\n",\n\s+"[^"]*\n",\n\s+\)/,
  );

  for (const pythonBlock of [mainPythonBlock, signallingPythonBlock, signallingClientPythonBlock]) {
    const parseResult = spawnSync(
      "python3",
      ["-c", "import ast,sys; ast.parse(sys.stdin.read())"],
      {
        encoding: "utf8",
        input: pythonBlock,
      },
    );

    assert.equal(parseResult.error, undefined);
    assert.equal(parseResult.status, 0, parseResult.stderr || parseResult.stdout);
  }
});

test("Selkies web app patch upgrades current autoplay audio hooks into the managed stream bridge", (context) => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );
  const appPythonBlock = extractEmbeddedPythonBlock(
    script,
    "SELKIES_APP_FILE",
    "SELKIES_SIGNALING_FILE",
  );
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-app-patch-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const appFile = join(tempDir, "app.js");
  writeFileSync(
    appFile,
    `audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    parallaizeMaybeAutoplayVideo(250);
    app.showStart = true;
}

// Actions to take whenever window changes focus
window.addEventListener('focus', () => {
    webrtc.sendDataChannelMessage("kr");
});
window.addEventListener('blur', () => {
    webrtc.sendDataChannelMessage("kr");
});

webrtc.onclipboardcontent = (content) => {
    if (app.clipboardStatus === 'enabled') {
        navigator.clipboard.writeText(content);
    }
}
`,
    "utf8",
  );

  const patchResult = spawnSync("python3", ["-c", appPythonBlock, appFile], {
    encoding: "utf8",
  });
  assert.equal(patchResult.error, undefined);
  assert.equal(patchResult.status, 0, patchResult.stderr || patchResult.stdout);

  const patchedContents = readFileSync(appFile, "utf8");
  assert.match(
    patchedContents,
    /audio_webrtc\.onplaystreamrequired = \(\) => \{\n    if \(parallaizePreviewMode \|\| videoConnected === "connected" \|\| parallaizeHasActiveVideoPlayback\(\)\) \{/,
  );
  assert.match(patchedContents, /window\.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;/);
  assert.match(patchedContents, /window\.addEventListener\("pagehide", shutdownSelkiesStream\);/);
});

test("Selkies index patch removes the return-to-launcher button", (context) => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );
  const indexPythonBlock = extractRawEmbeddedPythonBlock(
    script,
    `python3 - "$SELKIES_INDEX_FILE" <<'PY'\n`,
    "\nPY\n  fi\n}\nvalidate_selkies_bundle() {",
  );
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-index-patch-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const indexFile = join(tempDir, "index.html");
  writeFileSync(
    indexFile,
    `<v-tooltip bottom>
  <template v-slot:activator="{ on }">
    <v-btn icon href="/">
      <v-icon color="black" v-on="on">home</v-icon>
    </v-btn>
  </template>
  <span>Return to launcher</span>
</v-tooltip>
`,
    "utf8",
  );

  const patchResult = spawnSync("python3", ["-c", indexPythonBlock, indexFile], {
    encoding: "utf8",
  });
  assert.equal(patchResult.error, undefined);
  assert.equal(patchResult.status, 0, patchResult.stderr || patchResult.stdout);

  const patchedContents = readFileSync(indexFile, "utf8");
  assert.doesNotMatch(patchedContents, /Return to launcher/);
  assert.doesNotMatch(patchedContents, /href="\//);
});

test("Selkies bundle validation rejects stale patched web bundles", (context) => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );
  const validationPythonBlock = extractRawEmbeddedPythonBlock(
    script,
    `validate_selkies_bundle() {\n  python3 - "$SELKIES_INSTALL_DIR/share/selkies-web/app.js" "$SELKIES_INSTALL_DIR/share/selkies-web/signalling.js" "$SELKIES_INSTALL_DIR/share/selkies-web/index.html" <<'PY'\n`,
    "\nPY\n}\nensure_selkies_bundle() {",
  );
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-bundle-validation-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const appFile = join(tempDir, "app.js");
  const signallingFile = join(tempDir, "signalling.js");
  const indexFile = join(tempDir, "index.html");
  writeFileSync(
    appFile,
    `var parallaizeGuestClipboardListeners = new Set();
function parallaizeMaybeConnectAudio() {
}
window.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;
webrtc.onconnectionstatechange = (state) => {
    if (videoConnected === "connected") {
        parallaizeMaybeConnectAudio();
        parallaizeMaybeConnectAudio();
    }
};
window.parallaizeWriteGuestClipboard = (text) => {
    return true;
};
`,
    "utf8",
  );
  writeFileSync(
    signallingFile,
    `class WebRTCDemoSignalling {
    constructor() {
        this._retryTimer = null;
        this._suppressDisconnect = false;
    }

    _onServerError() {
        this._setStatus("Connection error, retry in 3 seconds.");
    }
}
`,
    "utf8",
  );
  writeFileSync(
    indexFile,
    `<v-tooltip bottom>
  <template v-slot:activator="{ on }">
    <v-btn icon href="/">
      <v-icon color="black" v-on="on">home</v-icon>
    </v-btn>
  </template>
  <span>Return to launcher</span>
</v-tooltip>
`,
    "utf8",
  );

  const validationResult = spawnSync(
    "python3",
    ["-c", validationPythonBlock, appFile, signallingFile, indexFile],
    {
      encoding: "utf8",
    },
  );
  assert.equal(validationResult.error, undefined);
  assert.notEqual(validationResult.status, 0);
  assert.match(
    `${validationResult.stderr}${validationResult.stdout}`,
    /missing token|duplicated audio-connect insertions|launcher shortcut/,
  );
});

test("Selkies signalling client patch keeps start() syntactically valid after rewrite", (context) => {
  const script = buildEnsureGuestDesktopBootstrapScript(
    5900,
    false,
    "clever-sloth",
    "standard",
    "selkies",
    6080,
    null,
    "vm-0001",
    "stream-health-token",
    3000,
  );
  const signallingClientPythonBlock = extractEmbeddedPythonBlock(
    script,
    "SELKIES_SIGNALING_CLIENT_FILE",
    "SELKIES_GST_APP_FILE",
  );
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-signalling-client-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleFile = join(tempDir, "webrtc_signalling.py");
  writeFileSync(
    sampleFile,
    `import base64
import json
import logging

logger = logging.getLogger(__name__)

class WebRTCSignallingError(Exception):
    pass

class WebRTCSignallingErrorNoPeer(WebRTCSignallingError):
    pass

class WebRTCSignalling:
    async def start(self):
        """Handles messages from the signalling server websocket.

        Message types:
          HELLO: response from server indicating peer is registered.
          ERROR*: error messages from server.
          {"sdp": ...}: JSON SDP message
          {"ice": ...}: JSON ICE message

        Callbacks:

        on_connect: fired when HELLO is received.
        on_session: fired after setup_call() succeeds and SESSION_OK is received.
        on_error(WebRTCSignallingErrorNoPeer): fired when setup_call() fails and peer not found message is received.
        on_error(WebRTCSignallingError): fired when message parsing fails or unexpected message is received.

        """
        async for message in self.conn:
            if message == 'HELLO':
                logger.info("connected")
                await self.on_connect()
            elif message.startswith('SESSION_OK'):
                toks = message.split()
                meta = {}
                if len(toks) > 1:
                    meta = json.loads(base64.b64decode(toks[1]))
                logger.info("started session with peer: %s, meta: %s", self.peer_id, json.dumps(meta))
                self.on_session(self.peer_id, (meta))
            elif message.startswith('ERROR'):
                if message == "ERROR peer '%s' not found" % self.peer_id:
                    await self.on_error(WebRTCSignallingErrorNoPeer("'%s' not found" % self.peer_id))
                else:
                    await self.on_error(WebRTCSignallingError("unhandled signalling message: %s" % message))
            else:
                # Attempt to parse JSON SDP or ICE message
                data = None
                try:
                    data = json.loads(message)
                except Exception as e:
                    if isinstance(e, json.decoder.JSONDecodeError):
                        await self.on_error(WebRTCSignallingError("error parsing message as JSON: %s" % message))
                    else:
                        await self.on_error(WebRTCSignallingError("failed to prase message: %s" % message))
                    continue
                if data.get("sdp", None):
                    logger.info("received SDP")
                    logger.debug("SDP:\\n%s" % data["sdp"])
                    self.on_sdp(data['sdp'].get('type'),
                                data['sdp'].get('sdp'))
                elif data.get("ice", None):
                    logger.info("received ICE")
                    logger.debug("ICE:\\n%s" % data.get("ice"))
                    self.on_ice(data['ice'].get('sdpMLineIndex'),
                                data['ice'].get('candidate'))
                else:
                    await self.on_error(WebRTCSignallingError("unhandled JSON message: %s", json.dumps(data)))
`,
    "utf8",
  );

  const patchResult = spawnSync("python3", ["-c", signallingClientPythonBlock, sampleFile], {
    encoding: "utf8",
  });
  assert.equal(patchResult.error, undefined);
  assert.equal(patchResult.status, 0, patchResult.stderr || patchResult.stdout);

  const parseResult = spawnSync(
    "python3",
    ["-c", "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())", sampleFile],
    {
      encoding: "utf8",
    },
  );
  assert.equal(parseResult.error, undefined);
  assert.equal(parseResult.status, 0, parseResult.stderr || parseResult.stdout);

  const patchedContents = readFileSync(sampleFile, "utf8");
  assert.match(patchedContents, /try:\n            async for message in self\.conn:\n                if message == 'HELLO':/);
  assert.match(patchedContents, /finally:\n            self\.on_disconnect\(\)\n$/);
});

test("reachable Selkies sessions count as attached browser desktops", () => {
  assert.equal(
    hasReachableVncSession({
      kind: "selkies",
      host: "10.0.0.15",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-1/",
      display: "10.0.0.15:6080",
    }),
    true,
  );
});

test("Selkies cloud-init seeds early wait-online and plymouth overrides before first boot settles", () => {
  const cloudInit = buildGuestSelkiesCloudInit(6080, {
    maxUserWatches: 1_048_576,
    maxUserInstances: 2_048,
  }, undefined, {
    stunHost: "stun.example.com",
    stunPort: 3478,
    turnHost: "turn.example.com",
    turnPort: 5349,
    turnProtocol: "tcp",
    turnTls: true,
    turnSharedSecret: "shared-secret",
  });

  assert.match(
    cloudInit,
    /path: \/etc\/systemd\/system\/systemd-networkd-wait-online\.service\.d\/10-parallaize\.conf/,
  );
  assert.match(cloudInit, /ExecStart=\/bin\/true/);
  assert.match(
    cloudInit,
    /path: \/etc\/systemd\/system\/plymouth-quit-wait\.service\.d\/10-parallaize\.conf/,
  );
  assert.match(cloudInit, /bootcmd:\n  - \|/);
  assert.match(cloudInit, /systemctl stop --no-block plymouth-quit-wait\.service \|\| true/);
  assert.match(cloudInit, /systemctl restart systemd-networkd-wait-online\.service \|\| true/);
  assert.match(cloudInit, /export SELKIES_STUN_HOST="stun\.example\.com"/);
  assert.match(cloudInit, /export SELKIES_STUN_PORT="3478"/);
  assert.match(cloudInit, /export SELKIES_TURN_HOST="turn\.example\.com"/);
  assert.match(cloudInit, /export SELKIES_TURN_PORT="5349"/);
  assert.match(cloudInit, /export SELKIES_TURN_PROTOCOL="tcp"/);
  assert.match(cloudInit, /export SELKIES_TURN_TLS="true"/);
  assert.match(cloudInit, /export SELKIES_TURN_SHARED_SECRET="shared-secret"/);
});

test("Selkies session probing accepts the browser root when /health is absent", async (context) => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Selkies</title>");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  context.after(() => {
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const instanceName = "parallaize-vm-9999-selkies-probe";
  const provider = createProvider("incus", "incus", {
    guestSelkiesPort: port,
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return {
            args,
            status: 0,
            stdout: "[]",
            stderr: "",
          };
        }

        if (
          args[0] === "list" &&
          args[1] === instanceName &&
          args[2] === "--format" &&
          args[3] === "json"
        ) {
          return {
            args,
            status: 0,
            stdout: JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "127.0.0.1",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            stderr: "",
          };
        }

        return {
          args,
          status: 0,
          stdout: "",
          stderr: "",
        };
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-9999",
    name: "selkies-probe",
    wallpaperName: "Selkies_probe.jpg",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/root",
    desktopTransport: "selkies",
    networkMode: "default",
    session: null,
    desktopReadyAt: null,
    desktopReadyMs: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.equal(session?.kind, "selkies");
  assert.equal(session?.host, "127.0.0.1");
  assert.equal(session?.port, port);
});

test("Selkies refresh repairs the guest bundle even when the browser session is already reachable", async (context) => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Selkies</title>");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  context.after(() => {
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const instanceName = "parallaize-vm-9998-selkies-maintenance";
  let bootstrapScript = "";
  const provider = createProvider("incus", "incus", {
    guestSelkiesPort: port,
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        const input = readCommandInput(options);

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          bootstrapScript = input;
          return {
            args,
            status: 0,
            stdout: "",
            stderr: "",
          };
        }

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return {
            args,
            status: 0,
            stdout: "[]",
            stderr: "",
          };
        }

        if (
          args[0] === "list" &&
          args[1] === instanceName &&
          args[2] === "--format" &&
          args[3] === "json"
        ) {
          return {
            args,
            status: 0,
            stdout: JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "127.0.0.1",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            stderr: "",
          };
        }

        return {
          args,
          status: 0,
          stdout: "",
          stderr: "",
        };
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-9998",
    name: "selkies-maintenance",
    wallpaperName: "Selkies_maintenance.jpg",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/root",
    desktopTransport: "selkies",
    networkMode: "default",
    session: null,
    desktopReadyAt: null,
    desktopReadyMs: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.equal(session?.kind, "selkies");
  assert.notEqual(bootstrapScript, "");
  assert.match(bootstrapScript, /var checkconnect = app\.status === "checkconnect";/);
});

test("Selkies refresh stages the host cache into the guest before bootstrap repair", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-cache-"));
  context.after(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  const cacheFile = join(tempDir, "v1.6.2.tar.gz");
  writeFileSync(cacheFile, "cached archive");

  const calls: string[][] = [];
  const commandInputs = new Map<string[], string>();
  const instanceName = "parallaize-vm-7777-selkies-cache";
  let bootstrapScript = "";
  let bootstrapCallIndex = -1;
  const provider = createProvider("incus", "incus", {
    guestSelkiesPort: 6553,
    selkiesHostCacheDir: tempDir,
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        commandInputs.set(args, readCommandInput(options));
        const input = readCommandInput(options);

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return {
            args,
            status: 0,
            stdout: "[]",
            stderr: "",
          };
        }

        if (
          args[0] === "list" &&
          args[1] === instanceName &&
          args[2] === "--format" &&
          args[3] === "json"
        ) {
          return {
            args,
            status: 0,
            stdout: JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "127.0.0.1",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            stderr: "",
          };
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          args[2] === "--" &&
          args[3] === "test" &&
          args[4] === "-s"
        ) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr: "",
          };
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          bootstrapScript = input;
          bootstrapCallIndex = calls.length - 1;
          return {
            args,
            status: 0,
            stdout: "",
            stderr: "",
          };
        }

        return {
          args,
          status: 0,
          stdout: "",
          stderr: "",
        };
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-7777",
    name: "selkies-cache",
    wallpaperName: "Selkies_cache.jpg",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/root",
    desktopTransport: "selkies",
    networkMode: "default",
    session: null,
    desktopReadyAt: null,
    desktopReadyMs: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.equal(session, null);
  const pushCall = calls.find(
    (args) =>
      args[0] === "file" &&
      args[1] === "push" &&
      args[2] === "--create-dirs",
  );
  assert.deepEqual(pushCall, [
    "file",
    "push",
    "--create-dirs",
    cacheFile,
    `${instanceName}/var/cache/parallaize/selkies/v1.6.2.tar.gz`,
  ]);
  assert.notEqual(bootstrapScript, "");
  assert.ok(calls.indexOf(pushCall!) < bootstrapCallIndex);
});

test("Selkies create launches directly from the selected source image", async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(request.url === "/" ? "ok" : "not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  context.after(() => {
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const calls: string[][] = [];
  const commandInputs = new Map<string[], string>();
  const instanceName = "parallaize-vm-8888-selkies-direct";
  const templateLaunchSource = "images:ubuntu/noble/desktop";

  const provider = createProvider("incus", "incus", {
    guestSelkiesPort: address.port,
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        commandInputs.set(args, readCommandInput(options));

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
          return ok(JSON.stringify({
            expanded_devices: {
              osdisk: {
                type: "disk",
                path: "/",
              },
            },
          }), args);
        }

        if (
          args[0] === "list" &&
          args[1] === instanceName &&
          args[2] === "--format" &&
          args[3] === "json"
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "127.0.0.1",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
  });

  const mutation = await provider.createVm(
    {
      id: "vm-8888",
      name: "direct-selkies",
      templateId: "tpl-8888",
      provider: "incus",
      providerRef: instanceName,
      status: "creating",
      resources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      liveSince: null,
      lastAction: "Queued",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 1,
      activeWindow: "editor",
      workspacePath: "/root",
      desktopTransport: "selkies",
      session: null,
      forwardedPorts: [],
      activityLog: [],
      commandHistory: [],
    },
    {
      id: "tpl-8888",
      name: "Selkies Template",
      description: "Uses a remote source image",
      launchSource: templateLaunchSource,
      defaultResources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
      defaultForwardedPorts: [],
      initCommands: [],
      tags: [],
      notes: [],
      snapshotIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  );

  const userInitCall = calls.find(
    (args) =>
      args[0] === "init" &&
      args[1] === templateLaunchSource &&
      args[2] === instanceName,
  );
  const userCloudInitCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName &&
      args[3] === "cloud-init.user-data",
  );
  const preparedImageQueryCall = calls.find(
    (args) =>
      args[0] === "query" &&
      args[1]?.startsWith("/1.0/images/aliases/"),
  );
  const publishCall = calls.find(
    (args) =>
      args[0] === "publish",
  );
  const builderInitCall = calls.find(
    (args) =>
      args[0] === "init" &&
      args[2]?.startsWith("ps-selkies-prep-"),
  );

  assert.ok(userInitCall);
  assert.deepEqual(userCloudInitCall, [
    "config",
    "set",
    instanceName,
    "cloud-init.user-data",
    "-",
  ]);
  const userCloudInitInput = commandInputs.get(userCloudInitCall ?? []) ?? "";
  assert.match(userCloudInitInput, /parallaize-desktop-bootstrap\.service/);
  assert.match(userCloudInitInput, /parallaize-selkies\.service/);
  assert.equal(preparedImageQueryCall, undefined);
  assert.equal(publishCall, undefined);
  assert.equal(builderInitCall, undefined);
  assert.equal(mutation.session?.kind, "selkies");
  assert.equal(mutation.session?.host, "127.0.0.1");
  assert.equal(mutation.activity.some((entry) => entry.startsWith("selkies-image:")), false);
  assert.ok(
    mutation.activity.includes(
      `incus: launched ${instanceName} from ${templateLaunchSource}`,
    ),
  );
});

function ok(stdout: string, args: string[]) {
  return {
    args,
    status: 0,
    stdout,
    stderr: "",
  };
}
