{
  # stovesdk.js — N-API addon build (Windows x64 only).
  #
  # Why node-gyp (and not cmake-js / napi-rs):
  #   - The SDK ships as MSVC C++ headers + import libs + DLLs, and its structs have their
  #     ctors/dtors inside the DLLs. Wrapping that from C++ with node-addon-api is a direct call.
  #   - node-gyp finds MSVC via vswhere on its own, needs no CMake, and injects the
  #     win_delay_load_hook that lets a module built against Node headers load inside electron.exe.
  #     N-API (NAPI_VERSION=8) is the ABI-stable surface, so one .node loads in Node and Electron.
  #
  # The SDK is never part of this repository: tools/sdk-dir.js resolves it from STOVE_PCSDK_DIR
  # or ./sdk and fails with a readable message when the layout is incomplete.
  'variables': {
    'stove_pcsdk_dir%': '<!(node tools/sdk-dir.js)',
    'stove_pcsdk_sdk_version%': '<!(node tools/sdk-dir.js version)',
  },
  'targets': [
    {
      'target_name': 'stovesdk',
      'conditions': [
        ['OS=="win"', {
          'sources': ['src/stovesdk.cc'],
          'include_dirs': [
            "<!@(node -p \"require('node-addon-api').include\")",
            # Root first: OwnershipSDK/GameSupportSDK headers include
            # "BaseSDK/Deploy/Include/Misc/Structures.h" relative to this root.
            '<(stove_pcsdk_dir)',
            '<(stove_pcsdk_dir)/BaseSDK/Deploy/Include',
            '<(stove_pcsdk_dir)/OwnershipSDK/Deploy/Include',
            '<(stove_pcsdk_dir)/GameSupportSDK/Deploy/Include',
          ],
          'libraries': [
            # Import libraries: the .node then hard-imports BaseSDK.dll / OwnershipSDK.dll /
            # GameSupportSDK.dll. Intentional — a missing DLL fails at require() time as a
            # catchable JS error instead of an SEH crash on first call that /DELAYLOAD would give.
            '<(stove_pcsdk_dir)/BaseSDK/Deploy/Lib/x64/Release/BaseSDK.lib',
            '<(stove_pcsdk_dir)/OwnershipSDK/Deploy/Lib/x64/Release/OwnershipSDK.lib',
            '<(stove_pcsdk_dir)/GameSupportSDK/Deploy/Lib/x64/Release/GameSupportSDK.lib',
          ],
          'defines': [
            'NAPI_VERSION=8',
            'NAPI_DISABLE_CPP_EXCEPTIONS',
            'NOMINMAX',
            'WIN32_LEAN_AND_MEAN',
            'UNICODE',
            '_UNICODE',
            'STOVE_PCSDK_SDK_VERSION="<(stove_pcsdk_sdk_version)"',
          ],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'ExceptionHandling': 1,
              'AdditionalOptions': ['/std:c++17', '/utf-8'],
            },
          },
          'configurations': {
            'Release': {
              'msvs_settings': {
                'VCCLCompilerTool': {
                  # /MD (dynamic CRT): the SDK DLLs themselves require the VC++ redistributable
                  # (MSVCP140 / VCRUNTIME140), so matching them adds no new runtime dependency.
                  'RuntimeLibrary': 2,
                },
              },
            },
          },
        }, {
          # Nothing to build off Windows; keep the target so `node-gyp configure` still succeeds.
          'type': 'none',
        }],
      ],
    },
  ],
}
