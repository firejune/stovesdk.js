#!/bin/sh
# Parses src/stove_pcsdk.cc with clang `-fsyntax-only` on a non-Windows machine, against the real
# SDK headers (STOVE_PCSDK_DIR or ./sdk) and a stub <windows.h>. It catches typos, wrong SDK
# accessor names and N-API misuse before the code reaches a Windows toolchain. It is NOT a build:
# nothing is linked, and MSVC-only behaviour is not exercised.
#
#   sh tools/syntax-check.sh            (needs: clang++, node_modules/node-addon-api, Node headers)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK_DIR=$(node "$ROOT/tools/sdk-dir.js")
NAPI_INC=$(node -p "require('$ROOT/node_modules/node-addon-api').include.replace(/\"/g, '')")
NODE_INC="${NODE_INCLUDE_DIR:-$(dirname "$(dirname "$(command -v node)")")/include/node}"
[ -f "$NODE_INC/node_api.h" ] || { echo "node_api.h not found under $NODE_INC (set NODE_INCLUDE_DIR)" >&2; exit 1; }

STUB=$(mktemp -d)
trap 'rm -rf "$STUB"' EXIT
cat > "$STUB/windows.h" <<'EOF'
// Minimal stand-in for <windows.h>: only what src/stove_pcsdk.cc and the SDK headers touch.
#pragma once
#include <cstdint>
#define __cdecl
#define CP_UTF8 65001
#define __out
extern "C" int WideCharToMultiByte(unsigned, unsigned long, const wchar_t*, int, char*, int, const char*, int*);
EOF

clang++ -fsyntax-only -std=c++17 -fshort-wchar -fdeclspec -fms-extensions \
  -Wno-ignored-attributes -Wno-microsoft -Wno-pragma-pack \
  -DSTOVE_PCSDK_SYNTAX_CHECK -DNAPI_VERSION=8 -DNAPI_DISABLE_CPP_EXCEPTIONS \
  -I "$STUB" -I "$NAPI_INC" -I "$NODE_INC" \
  -I "$SDK_DIR" -I "$SDK_DIR/BaseSDK/Deploy/Include" -I "$SDK_DIR/OwnershipSDK/Deploy/Include" -I "$SDK_DIR/GameSupportSDK/Deploy/Include" \
  "$ROOT/src/stove_pcsdk.cc"
echo "[syntax-check] OK: src/stove_pcsdk.cc parses against the SDK headers at $SDK_DIR"
