# Local fonts

These Latin WOFF2 fonts retain the app's Inter and Instrument Serif typography
while letting Next.js build and serve it without contacting Google Fonts.
They are redistributed under the included SIL Open Font License 1.1 files.

## Source and verification

Downloaded with `npm pack` from the official Fontsource packages on the npm
registry. TLS and npm package integrity verification remained enabled. Each
tarball's SHA-512 was also checked independently against its registry metadata
before copying the files. No package dependencies are required at runtime.

| Files | Package | Verified tarball integrity |
| --- | --- | --- |
| `inter-latin-wght-normal.woff2`, `Inter-LICENSE.txt` | [`@fontsource-variable/inter@5.3.0`](https://www.npmjs.com/package/@fontsource-variable/inter/v/5.3.0) | `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` |
| `instrument-serif-latin-400-normal.woff2`, `instrument-serif-latin-400-italic.woff2`, `Instrument-Serif-LICENSE.txt` | [`@fontsource/instrument-serif@5.3.0`](https://www.npmjs.com/package/@fontsource/instrument-serif/v/5.3.0) | `sha512-mDiaIg0u67sYV59fie92Wz4sM8UiVlbL7fLxnFPCKkX15DMASEnQTREbaP5S5/3DCcsoAOcQ0sV9E4AeY4QqYQ==` |

The Inter file covers variable weights 100–900 in the normal style. Instrument
Serif includes its regular and italic styles at weight 400. The corresponding
CSS variables remain `--font-inter` and `--font-instrument-serif`.
