# Package Managers

ShadowCode ships native installers for macOS, Windows, and Linux alongside ready-to-use package manager manifests:

| Platform | Recommended Install | Manifest / Repo |
|---|---|---|
| **macOS (Apple Silicon & Intel)** | `curl -fsSL https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-macos.sh \| bash` | `Casks/shadowcode.rb` |
| **Windows (x64)** | `irm https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-windows.ps1 \| iex` | `packaging/winget/` |
| **Debian / Ubuntu (`amd64`, `arm64`)** | Signed APT repository (`shadowfetchstudio.github.io/ShadowCode/apt`) | `docs/DISTRIBUTING.md` |
| **Linux AppImage (`amd64`, `arm64`)** | Publisher-signed AppImage + `scripts/install-appimage.sh` | `docs/RELEASE_AUTHENTICATION.md` |
| **Linux Flatpak (`x86_64`, `aarch64`)** | `flatpak install --user ShadowCode_<version>_<arch>.flatpak` | `docs/FLATPAK.md` |

## Homebrew

Register this repository as a tap. Homebrew 7 requires you to trust the ShadowCode cask before it can load the install instructions. You can review the [cask](../Casks/shadowcode.rb) first. Homebrew selects the disk image and checks its SHA-256 for your Mac's architecture.

```bash
brew tap shadowfetchstudio/shadowcode https://github.com/ShadowfetchStudio/ShadowCode
brew trust --cask shadowfetchstudio/shadowcode/shadowcode
brew install --cask shadowfetchstudio/shadowcode/shadowcode
```

On older Homebrew versions that lack the `trust` command, skip that line.

Run `brew update` and `brew upgrade --cask shadowfetchstudio/shadowcode/shadowcode` to upgrade. The tap tracks the last published, checksum-pinned release. Each new release includes its version-specific cask as `shadowcode.rb`.

## WinGet

Download all three `ShadowfetchStudio.ShadowCode*.yaml` assets from the same release into an empty directory. The installer manifest pins the x64 installer by SHA-256. Use a Windows terminal with local manifests enabled.

```powershell
winget validate --manifest .\manifests
winget install --manifest .\manifests
```

The manifests in `packaging/winget/` also describe a published installer. Installing by package identifier alone requires a separately accepted WinGet community submission.
