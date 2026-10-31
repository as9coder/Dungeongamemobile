#!/usr/bin/env python3
"""
Dependency-light APK builder (no Android SDK required).

Pipeline
  1. javac  : MainActivity.java      -> .class   (against android.jar)
  2. dx     : .class                 -> classes.dex
  3. AXML   : AndroidManifest.xml    -> binary XML (hand-rolled encoder)
  4. ARSC   : resources.arsc         -> one drawable (launcher icon)
  5. zip    : assets/www/** + dex + manifest + arsc  (4-byte aligned stored arsc)
  6. apksig : v1 + v2 signature, then verification

Usage: build_apk.py <out.apk>   (env: TOOLCHAIN=<dir with android-all.jar dx.jar apksig.jar>)
"""
import os, struct, subprocess, sys, zipfile, shutil, glob, io

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TC = os.environ.get("TOOLCHAIN", os.path.join(ROOT, ".toolchain"))
PKG = "com.voxeldelvers.game"
APP_LABEL = "Voxel Delvers"
VERSION_CODE = int(os.environ.get("VERSION_CODE", "1"))
VERSION_NAME = os.environ.get("VERSION_NAME", "1.0.0")
MIN_SDK, TARGET_SDK = 24, 33
BUILD = os.path.join(ROOT, "build")

# ---------------------------------------------------------------- AXML ----
RES_XML, RES_STRING_POOL, RES_XML_RESMAP = 0x0003, 0x0001, 0x0180
NS_START, NS_END, EL_START, EL_END = 0x0100, 0x0101, 0x0102, 0x0103
T_REF, T_STR, T_DEC, T_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12
NO = 0xFFFFFFFF
ANDROID_NS = "http://schemas.android.com/apk/res/android"

# android.R.attr ids
ATTR = dict(
    theme=0x01010000, label=0x01010001, icon=0x01010002, name=0x01010003,
    debuggable=0x0101000F, exported=0x01010010, launchMode=0x0101001D,
    screenOrientation=0x0101001E, configChanges=0x0101001F,
    versionCode=0x0101021B, versionName=0x0101021C, minSdkVersion=0x0101020C,
    targetSdkVersion=0x01010270, allowBackup=0x01010280, glEsVersion=0x01010281,
    hardwareAccelerated=0x010102D3, largeHeap=0x0101035A, required=0x0101028E,
    usesCleartextTraffic=0x010104EC, resizeableActivity=0x010104F6,
)


class StrPool:
    def __init__(self, fixed):
        self.items = list(fixed)  # attribute-name strings with resource ids first

    def idx(self, s):
        if s not in self.items:
            self.items.append(s)
        return self.items.index(s)

    def chunk(self):
        offs, blob = [], b""
        for s in self.items:
            offs.append(len(blob))
            enc = s.encode("utf-16-le")
            blob += struct.pack("<H", len(s)) + enc + b"\0\0"
        while len(blob) % 4:
            blob += b"\0"
        hdr = 28
        strings_start = hdr + 4 * len(offs)
        size = strings_start + len(blob)
        out = struct.pack("<HHIIIIII", RES_STRING_POOL, hdr, size, len(self.items), 0, 0, strings_start, 0)
        out += b"".join(struct.pack("<I", o) for o in offs) + blob
        return out


def build_manifest():
    """Return binary AndroidManifest.xml bytes."""
    # tree: (ns?, tag, [attrs], [children]); attr = (name, kind, value)
    def A(name, kind, value): return (name, kind, value)
    cfg = 0x80 | 0x20 | 0x400 | 0x800 | 0x100 | 0x200 | 0x1000 | 0x10 | 0x40 | 0x4
    activity = ("activity", [
        A("name", "str", PKG + ".MainActivity"),
        A("exported", "bool", True),
        A("screenOrientation", "hex", 6),  # sensorLandscape
        A("configChanges", "hex", cfg),
        A("launchMode", "hex", 2),  # singleTask
    ], [("intent-filter", [], [
        ("action", [A("name", "str", "android.intent.action.MAIN")], []),
        ("category", [A("name", "str", "android.intent.category.LAUNCHER")], []),
    ])])
    app = ("application", [
        A("label", "str", APP_LABEL),
        A("icon", "ref", 0x7F010000),
        A("theme", "ref", 0x0103000A),  # android:style/Theme.Black.NoTitleBar.Fullscreen
        A("allowBackup", "bool", True),
        A("hardwareAccelerated", "bool", True),
        A("largeHeap", "bool", True),
        A("usesCleartextTraffic", "bool", False),
        A("resizeableActivity", "bool", True),
    ], [activity])
    manifest = ("manifest", [
        ("package", "str_noattr", PKG),
        A("versionCode", "dec", VERSION_CODE),
        A("versionName", "str", VERSION_NAME),
    ], [
        ("uses-sdk", [A("minSdkVersion", "dec", MIN_SDK), A("targetSdkVersion", "dec", TARGET_SDK)], []),
        ("uses-feature", [A("glEsVersion", "hex", 0x00020000), A("required", "bool", True)], []),
        ("uses-permission", [A("name", "str", "android.permission.VIBRATE")], []),
        app,
    ])

    # attribute names with ids go first in the pool, ordered by id
    names = sorted(ATTR, key=lambda k: ATTR[k])
    pool = StrPool(names)
    pool.idx("android"); pool.idx(ANDROID_NS)
    res_ids = [ATTR[n] for n in names]
    body = b""
    line = [1]

    def hdr(t, size, ln): return struct.pack("<HHIII", t, 16, size, ln, NO)

    prefix, uri = pool.idx("android"), pool.idx(ANDROID_NS)
    body += hdr(NS_START, 24, 1) + struct.pack("<II", prefix, uri)

    def emit(node):
        nonlocal body
        tag, attrs, kids = node
        line[0] += 1
        enc = []
        for a in attrs:
            name, kind, val = a
            if kind == "str_noattr":
                enc.append((NO, 0, pool.idx(name), pool.idx(val), (T_STR, pool.idx(val)), False))
                continue
            rid = ATTR[name]
            nidx = pool.idx(name)
            if kind == "str":
                si = pool.idx(val); enc.append((uri, rid, nidx, si, (T_STR, si), True))
            elif kind == "dec":
                enc.append((uri, rid, nidx, NO, (T_DEC, val), True))
            elif kind == "hex":
                enc.append((uri, rid, nidx, NO, (T_HEX, val), True))
            elif kind == "bool":
                enc.append((uri, rid, nidx, NO, (T_BOOL, 0xFFFFFFFF if val else 0), True))
            elif kind == "ref":
                enc.append((uri, rid, nidx, NO, (T_REF, val), True))
        # sort: attributes having resource ids ascending by id, then others
        enc.sort(key=lambda e: e[1])
        ext = struct.pack("<IIHHHHHH", NO, pool.idx(tag), 20, 20, len(enc), 0, 0, 0)
        ab = b""
        for ns, rid, nidx, raw, (dt, data), _ in enc:
            ab += struct.pack("<IIIHBBI", ns, nidx, raw, 8, 0, dt, data)
        size = 16 + len(ext) + len(ab)
        body += hdr(EL_START, size, line[0]) + ext + ab
        for k in kids:
            emit(k)
        line[0] += 1
        body += hdr(EL_END, 24, line[0]) + struct.pack("<II", NO, pool.idx(tag))

    emit(manifest)
    body += hdr(NS_END, 24, line[0] + 1) + struct.pack("<II", prefix, uri)

    sp = pool.chunk()
    rm = struct.pack("<HHI", RES_XML_RESMAP, 8, 8 + 4 * len(res_ids)) + b"".join(struct.pack("<I", r) for r in res_ids)
    total = 8 + len(sp) + len(rm) + len(body)
    return struct.pack("<HHI", RES_XML, 8, total) + sp + rm + body


# ---------------------------------------------------------------- ARSC ----
def utf8_pool(strings):
    """UTF-8 string pool chunk (flags=0x100), like aapt2 writes."""
    offs, blob = [], b""
    for s in strings:
        offs.append(len(blob))
        b = s.encode("utf-8")
        def ln(n): return bytes([n]) if n < 0x80 else bytes([0x80 | (n >> 8), n & 0xFF])
        blob += ln(len(s)) + ln(len(b)) + b + b"\0"
    while len(blob) % 4:
        blob += b"\0"
    hdr = 28
    ss = hdr + 4 * len(offs)
    out = struct.pack("<HHIIIIII", RES_STRING_POOL, hdr, ss + len(blob), len(strings), 0, 0x100, ss, 0)
    return out + b"".join(struct.pack("<I", o) for o in offs) + blob


def build_arsc(icon_path_in_apk):
    global_pool = utf8_pool([icon_path_in_apk])
    type_pool = utf8_pool(["drawable"])
    key_pool = utf8_pool(["ic_launcher"])

    # ResTable_type: header(8) id,flags,reserved(4) entryCount(4) entriesStart(4) config(64) = 84
    cfg = struct.pack("<I", 64) + b"\0" * 60
    entries = struct.pack("<HHI", 8, 0, 0) + struct.pack("<HBBI", 8, 0, T_STR, 0)  # key idx 0, value string idx 0
    type_hdr = 84
    entries_start = type_hdr + 4  # one offset slot
    type_chunk = struct.pack("<HHIBBHII", 0x0201, type_hdr, entries_start + len(entries), 1, 0, 0, 1, entries_start)
    type_chunk += cfg + struct.pack("<I", 0) + entries

    spec_chunk = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack("<I", 0)

    pkg_hdr = 288
    type_off = pkg_hdr
    key_off = type_off + len(type_pool)
    body = type_pool + key_pool + spec_chunk + type_chunk
    name = PKG.encode("utf-16-le")
    name = name + b"\0" * (256 - len(name))
    pkg = struct.pack("<HHII", 0x0200, pkg_hdr, pkg_hdr + len(body), 0x7F) + name
    pkg += struct.pack("<IIIII", type_off, 1, key_off, 1, 0)
    pkg += body
    assert len(pkg) == pkg_hdr + len(body)
    total = 12 + len(global_pool) + len(pkg)
    return struct.pack("<HHII", 0x0002, 12, total, 1) + global_pool + pkg


# ----------------------------------------------------------------- zip ----
def add_aligned(zf, name, data, align=4, compress=False):
    zi = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
    zi.external_attr = 0o644 << 16
    if not compress:
        pos = zf.fp.tell()
        hdr_len = 30 + len(name.encode())
        pad = (-(pos + hdr_len)) % align
        if pad:
            if pad < 4:
                pad += align
            zi.extra = struct.pack("<HH", 0xD935, pad - 4) + b"\0" * (pad - 4)
    zf.writestr(zi, data)


def run(cmd, **kw):
    print("+", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, **kw)


def main():
    out_apk = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "releases", "VoxelDelvers.apk"))
    www = os.path.join(ROOT, "game", "dist")
    if not os.path.exists(os.path.join(www, "index.html")):
        sys.exit("game/dist/index.html missing - run the game build first")
    shutil.rmtree(BUILD, ignore_errors=True)
    os.makedirs(BUILD + "/classes")
    android_jar = os.path.join(TC, "android-all.jar")

    # 1. javac
    srcs = glob.glob(os.path.join(ROOT, "android/src/**/*.java"), recursive=True)
    run(["javac", "--release", "8", "-Xlint:-options", "-cp", android_jar, "-d", BUILD + "/classes"] + srcs)
    # 2. dx
    run(["java", "-cp", os.path.join(TC, "dx.jar"), "com.android.dx.command.Main", "--dex",
         "--min-sdk-version=%d" % MIN_SDK, "--output=" + BUILD + "/classes.dex", BUILD + "/classes"])
    # 3/4. manifest + resources
    icon = os.path.join(ROOT, "android", "res", "ic_launcher.png")
    manifest = build_manifest()
    arsc = build_arsc("res/drawable/ic_launcher.png")
    open(BUILD + "/AndroidManifest.xml", "wb").write(manifest)
    # 5. zip
    unsigned = BUILD + "/unsigned.apk"
    with zipfile.ZipFile(unsigned, "w") as zf:
        add_aligned(zf, "AndroidManifest.xml", manifest, compress=True)
        add_aligned(zf, "classes.dex", open(BUILD + "/classes.dex", "rb").read(), compress=True)
        add_aligned(zf, "resources.arsc", arsc, compress=False)  # must be stored + aligned for targetSdk>=30
        add_aligned(zf, "res/drawable/ic_launcher.png", open(icon, "rb").read(), compress=False)
        for base, _, files in os.walk(www):
            for f in sorted(files):
                full = os.path.join(base, f)
                rel = os.path.relpath(full, www).replace(os.sep, "/")
                add_aligned(zf, "assets/www/" + rel, open(full, "rb").read(), compress=True)
    # 6. sign
    ks = os.path.join(ROOT, "tools", "debug.p12")
    if not os.path.exists(ks):
        run(["keytool", "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-storepass", "voxeldelvers",
             "-keypass", "voxeldelvers", "-alias", "voxel", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-dname", "CN=Voxel Delvers, O=Voxel Delvers, C=US"])
    run(["javac", "-cp", os.path.join(TC, "apksig.jar"), "-d", BUILD, os.path.join(ROOT, "tools", "Signer.java")])
    cp = BUILD + os.pathsep + os.path.join(TC, "apksig.jar")
    os.makedirs(os.path.dirname(out_apk), exist_ok=True)
    exports = ["--add-exports=java.base/sun.security.%s=ALL-UNNAMED" % m for m in ("x509", "pkcs", "util")]
    run(["java"] + exports + ["-cp", cp, "Signer", "sign", ks, "voxeldelvers", "voxel", unsigned, out_apk])
    run(["java"] + exports + ["-cp", cp, "Signer", "verify", out_apk])
    print("APK:", out_apk, os.path.getsize(out_apk) // 1024, "KB")


if __name__ == "__main__":
    main()
