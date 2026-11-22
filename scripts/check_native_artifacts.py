#!/usr/bin/env python3
"""Verify native definitions in a built MPP and optionally the unsigned patched APK; never installs it."""
import argparse
import hashlib
import pathlib
import re
import struct
import subprocess
import zipfile
import zlib

NATIVE = 'Lapp/dika/greatday/nativebridge/'
COMPONENTS = ['NativeInitProvider', 'AttendanceAlarmReceiver', 'BootReceiver', 'AttendanceForegroundService', 'NativePermissionActivity']


def definitions(data):
    assert data.startswith(b'dex\n'), 'Not a raw DEX'
    assert struct.unpack_from('<I', data, 32)[0] == len(data), 'DEX length mismatch'
    assert data[12:32] == hashlib.sha1(data[32:]).digest(), 'DEX SHA-1 mismatch'
    assert struct.unpack_from('<I', data, 8)[0] == zlib.adler32(data[12:]), 'DEX checksum mismatch'
    string_count, string_offset, type_count, type_offset = struct.unpack_from('<IIII', data, 56)
    class_count, class_offset = struct.unpack_from('<II', data, 96)
    result = set()
    for index in range(class_count):
        type_index = struct.unpack_from('<I', data, class_offset + 32 * index)[0]
        assert type_index < type_count
        string_index = struct.unpack_from('<I', data, type_offset + 4 * type_index)[0]
        assert string_index < string_count
        offset = struct.unpack_from('<I', data, string_offset + 4 * string_index)[0]
        while data[offset] & 128:
            offset += 1
        offset += 1  # Skip the ULEB128 UTF-16 length; descriptors contain no embedded zero.
        result.add(data[offset:data.index(0, offset)].decode('utf-8', errors='replace'))
    return result


def xml_nodes(dump):
    nodes, stack = [], []
    for line in dump.splitlines():
        element = re.match(r'(\s*)E: (\S+)', line)
        if element:
            indent, kind = len(element[1]), element[2]
            while stack and stack[-1][0] >= indent:
                stack.pop()
            node = {'kind': kind, 'attributes': {}}
            nodes.append(node)
            stack.append((indent, node))
        else:
            attribute = re.search(r'A: .*?:([A-Za-z]\w*)(?:\(0x[0-9a-f]+\))?=(.*)', line)
            if attribute and stack:
                value = attribute[2].split(' (Raw:', 1)[0].strip().strip('"')
                stack[-1][1]['attributes'][attribute[1]] = value
    return nodes


def check(bundle, apk=None, aapt2=None):
    with zipfile.ZipFile(bundle) as archive:
        for name in ['classes.dex', 'greatday8/native.js', 'greatday8/native-manifest.xml', 'greatday8/native-attendance.mpe']:
            assert name in archive.namelist(), name
        extension = definitions(archive.read('greatday8/native-attendance.mpe'))
        for name in COMPONENTS + ['GreatDayOfflineHook', 'NativePolicy']:
            assert NATIVE + name + ';' in extension, name
        print(f'PASS MPP: {len(extension)} native class definitions, DEX signatures, bridge and manifest template')
    if apk:
        with zipfile.ZipFile(apk) as archive:
            counts = {}
            for name in archive.namelist():
                if re.fullmatch(r'classes\d*\.dex', name):
                    for descriptor in definitions(archive.read(name)):
                        if descriptor.startswith(NATIVE):
                            counts[descriptor] = counts.get(descriptor, 0) + 1
            assert extension <= counts.keys() and all(value == 1 for value in counts.values()), counts
            flags = archive.read('assets/public/dika/features.js').decode()
            assert 'nativeTrial:true' in flags and 'backgroundKeeper:false' in flags
            assert 'globalThis.DikaOffline?.syncGate(w,H);return;' in archive.read('assets/public/61543.79fad183692bc090.js').decode()
        print(f'PASS APK: all {len(extension)} native definitions appear once; native mode and offline send hold present')
    if apk and aapt2:
        dump = subprocess.run([str(aapt2), 'dump', 'xmltree', '--file', 'AndroidManifest.xml', str(apk)],
                              capture_output=True, text=True, encoding='utf-8', check=True).stdout
        nodes = xml_nodes(dump)
        for name in COMPONENTS:
            matches = [node for node in nodes if node['attributes'].get('name') == 'app.dika.greatday.nativebridge.' + name]
            assert len(matches) == 1, name
            assert matches[0]['attributes'].get('exported') == 'false', name
            if name == 'AttendanceForegroundService':
                assert matches[0]['attributes']['stopWithTask'] == 'false'
                assert int(matches[0]['attributes']['foregroundServiceType'], 0) == 8
        exact = [node for node in nodes if node['kind'] == 'uses-permission'
                 and node['attributes'].get('name') == 'android.permission.SCHEDULE_EXACT_ALARM']
        assert len(exact) == 1 and 'maxSdkVersion' not in exact[0]['attributes']
        print('PASS compiled manifest: private components, location service, stopWithTask=false, uncapped exact-alarm permission')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=pathlib.Path)
    parser.add_argument('--apk', type=pathlib.Path)
    parser.add_argument('--aapt2', type=pathlib.Path)
    args = parser.parse_args()
    check(args.bundle, args.apk, args.aapt2)
