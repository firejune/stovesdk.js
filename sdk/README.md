# sdk/

Put your copy of the STOVE PC SDK here. Nothing in this directory except this file is tracked.

Download the SDK from the STOVE developer portal with your own developer account. You can also leave it elsewhere and set `STOVE_PCSDK_DIR` to its location.

## Expected layout

One folder per SDK module, in the shape the vendor zips unpack to:

```
sdk/
├── VERSION                                   # optional, one line (e.g. 3.4.2) — baked into getAddonInfo().sdkVersion
├── BaseSDK/Deploy/
│   ├── Include/BaseSDK.h  (+ Misc/…)
│   ├── Lib/x64/Release/BaseSDK.lib
│   └── Bin/x64/Release/BaseSDK.dll
├── OwnershipSDK/Deploy/
│   ├── Include/OwnershipSDK.h  (+ Misc/…)
│   ├── Lib/x64/Release/OwnershipSDK.lib
│   └── Bin/x64/Release/OwnershipSDK.dll
└── GameSupportSDK/Deploy/
    ├── Include/GameSupportSDK.h  (+ Misc/…)
    ├── Lib/x64/Release/GameSupportSDK.lib
    └── Bin/x64/Release/GameSupportSDK.dll
```

`npm run check-sdk` verifies this layout and lists anything missing. The build links the three `.lib` import libraries; at runtime the three `.dll` files must sit next to the compiled `stove_pcsdk.node` or next to your executable.
