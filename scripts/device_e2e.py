"""Drive PRESENCE + Solana Mobile fakewallet on a USB-connected Android device (adb), end to end.

    python3 scripts/device_e2e.py <serial> [happy|again|leave|skip ...]

Needs: ATTEST running on the host (:8787), `adb reverse tcp:8787 tcp:8787`, both apps installed.
"""
import re
import subprocess
import sys
import time

SERIAL = sys.argv[1]
WALLET = "com.solana.mobilewalletadapter.fakewallet"
WALLET_APK = ".dev/fakewallet.apk"  # fakewallet-v1-debug.apk from the mobile-wallet-adapter releases
APP_APK = "app/build/outputs/apk/debug/app-debug.apk"


def adb(*args: str) -> str:
    return subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, text=True).stdout


def screen() -> list[tuple[str, tuple[int, int]]]:
    adb("shell", "uiautomator", "dump", "/sdcard/u.xml")
    xml = adb("shell", "cat", "/sdcard/u.xml")
    out = []
    for text, x1, y1, x2, y2 in re.findall(
            r'text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        out.append((text.replace("&#10;", " "), ((int(x1) + int(x2)) // 2, (int(y1) + int(y2)) // 2)))
    return out


def texts() -> str:
    return " | ".join(t for t, _ in screen() if t)


def find(label: str):
    items = screen()
    exact = next((xy for t, xy in items if t.lower() == label.lower()), None)  # "AUTHORIZE" ≠ "AUTHORIZE DAPP"
    return exact or next((xy for t, xy in items if label.lower() in t.lower()), None)


def wait_for(label: str, timeout: float = 30):
    end = time.time() + timeout
    while time.time() < end:
        items = dict((t, xy) for t, xy in screen())
        if "Don't send" in items:  # Play Protect asks to upload the sideloaded test wallet; decline
            adb("shell", "input", "tap", *map(str, items["Don't send"]))
            time.sleep(1)
            continue
        if (xy := find(label)):
            return xy
        time.sleep(0.5)
    raise SystemExit(f"timeout waiting for {label!r}; screen: {texts()}")


def tap(label: str, timeout: float = 30) -> None:
    x, y = wait_for(label, timeout)
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(0.8)


def fresh_identity() -> None:
    """New throwaway wallet key and a logged-out PRESENCE (clears both apps' local data)."""
    # Reinstall instead of `pm clear` (some OEMs, e.g. realme, deny CLEAR_APP_USER_DATA to adb).
    for pkg, apk in ((WALLET, WALLET_APK), ("com.presence", APP_APK)):
        adb("uninstall", pkg)
        adb("install", apk)
    time.sleep(2)
    adb("shell", "input", "keyevent", "KEYCODE_HOME")  # dismiss OEM post-install screens
    time.sleep(1)
    adb("shell", "am", "start", "-n", "com.presence/.MainActivity")
    tap("Connect wallet")
    tap("AUTHORIZE")
    wait_for("Attest now")


def run_mission(skip_window: int | None = None, leave_at: float | None = None) -> str:
    tap("Attest now")
    tap("For 60 seconds only")       # consent row
    tap("Start mission")
    tap("AUTHORIZE")                  # wallet signs the SIWS message
    circle = wait_for("TAP TO", 20)   # countdown, then the active session
    start = time.time()
    left = False
    while time.time() - start < 62:  # the session is 60 s; taps every 2.5 s cover each window
        elapsed = time.time() - start
        if leave_at is not None and not left and elapsed > leave_at:
            adb("shell", "input", "keyevent", "KEYCODE_HOME")
            time.sleep(4)
            adb("shell", "am", "start", "-n", "com.presence/.MainActivity")
            left = True
            time.sleep(1)
        if skip_window is None or int(elapsed // 10) != skip_window:
            adb("shell", "input", "tap", str(circle[0]), str(circle[1]))
        time.sleep(2.5)
    end = time.time() + 60
    while time.time() < end:
        t = texts()
        if "VERIFIED ✓" in t or "NOT VERIFIED" in t:
            return t
        time.sleep(1)
    raise SystemExit(f"no result; screen: {texts()}")


def main() -> None:
    adb("shell", "svc", "power", "stayon", "usb")
    for scenario in sys.argv[2:] or ["happy", "again", "leave", "skip"]:
        print(f"\n=== {scenario}", flush=True)
        if scenario == "happy":
            fresh_identity()
            print(run_mission())
            tap("Done")
            time.sleep(2)
            print("home:", texts())
        elif scenario == "again":      # same wallet, same day
            adb("shell", "am", "start", "-n", "com.presence/.MainActivity")
            time.sleep(2)
            print("home:", texts())
        elif scenario == "leave":
            fresh_identity()
            print(run_mission(leave_at=25))
            tap("Home")
        elif scenario == "skip":
            fresh_identity()
            print(run_mission(skip_window=3))
            tap("Home")
    adb("shell", "svc", "power", "stayon", "false")


if __name__ == "__main__":
    main()
