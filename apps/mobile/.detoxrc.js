/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: { $0: "jest", config: "e2e/jest.config.js" },
    jest: { setupTimeout: 120000 }
  },
  apps: {
    // ponytail: no @config-plugins/detox — its peerDependency (expo ^53)
    // doesn't cover this app's SDK 55, and the only native config it would
    // otherwise generate (ATS/cleartext) is already hand-written into
    // app.json. `expo prebuild` regenerates ios/ and android/ from that.
    "ios.debug": {
      type: "ios.app",
      binaryPath: "ios/build/Build/Products/Debug-iphonesimulator/Lyra.app",
      build:
        "xcodebuild -workspace ios/Lyra.xcworkspace -scheme Lyra " +
        "-configuration Debug -sdk iphonesimulator -derivedDataPath ios/build " +
        "-quiet CODE_SIGNING_ALLOWED=NO"
    },
    "android.debug": {
      type: "android.apk",
      binaryPath: "android/app/build/outputs/apk/debug/app-debug.apk",
      testBinaryPath: "android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
      build:
        "cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..",
      reversePorts: [8788]
    }
  },
  devices: {
    simulator: { type: "ios.simulator", device: { type: "iPhone 16" } },
    emulator: { type: "android.emulator", device: { avdName: "Pixel_7_API_34" } }
  },
  configurations: {
    "ios.sim.debug": { device: "simulator", app: "ios.debug" },
    "android.emu.debug": { device: "emulator", app: "android.debug" }
  }
};
