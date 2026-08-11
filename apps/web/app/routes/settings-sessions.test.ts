import { describe, expect, it } from "vitest";
import { deviceName } from "./settings";

// "Where you are signed in" is how somebody spots a session that is not theirs,
// and every row of it printed the raw user agent — identical for the first
// eighty characters, wrapped over three lines.
describe("deviceName", () => {
  const unknown = "Unknown";

  it("says the browser and the machine it runs on", () => {
    expect(
      deviceName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        unknown
      )
    ).toBe("Chrome on macOS");
  });

  it("does not call Edge or Opera Chrome", () => {
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/125.0.0.0 Safari/537.36 Edg/125.0", unknown)).toBe(
      "Edge on Windows"
    );
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/125 Safari/537.36 OPR/110.0", unknown)).toBe(
      "Opera on Windows"
    );
  });

  it("recognises a phone", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Safari/604.1", unknown)).toBe(
      "Safari on iOS"
    );
  });

  it("says what it can when it only recognises one half", () => {
    expect(deviceName("curl/8.4.0", unknown)).toBe(unknown);
    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64) SomeBot/1.0", unknown)).toBe("Linux");
  });

  it("says the session is unrecognised rather than nothing", () => {
    expect(deviceName(null, unknown)).toBe(unknown);
  });
});
