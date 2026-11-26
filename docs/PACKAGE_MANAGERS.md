# Package Managers

ShadowCode ships native installers for macOS, Windows, and Linux alongside ready-to-use package manager manifests:

| Platform | Recommended Install | Manifest / Repo |
|---|---|---|
| **macOS (Apple Silicon & Intel)** | `curl -fsSL https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-macos.sh \| bash` | `packaging/homebrew/shadowcode.rb` |
| **Windows (x64)** | `irm https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-windows.ps1 \| iex` | `packaging/winget/` |
| **Debian / Ubuntu (`amd64`, `arm64`)** | Signed APT repository (`shadowfetchstudio.github.io/ShadowCode/apt`) | `docs/DISTRIBUTING.md` |
| **Linux AppImage (`amd64`, `arm64`)** | Publisher-signed AppImage + `scripts/install-appimage.sh` | `docs/RELEASE_AUTHENTICATION.md` |
| **Linux Flatpak (`x86_64`, `aarch64`)** | `flatpak install --user ShadowCode_<version>_<arch>.flatpak` | `docs/FLATPAK.md` |

## Local Homebrew Cask Install

```bash
brew install --cask packaging/homebrew/shadowcode.rb
```

To publish to a Homebrew tap (`ShadowfetchStudio/homebrew-tap`), copy `packaging/homebrew/shadowcode.rb` into `Casks/shadowcode.rb` and pin the SHA-256 digests from `ShadowCode_<version>_macos.sha256`.

## WinGet Submission

Fill `InstallerSha256` in `packaging/winget/ShadowfetchStudio.ShadowCode.installer.yaml` from `ShadowCode_<version>_windows.sha256` and validate with `winget validate packaging/winget/`.
