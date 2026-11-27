cask "shadowcode" do
  arch arm: "aarch64", intel: "x64"

  version "2.7.0"
  sha256 arm: "475e584a77dbc4228157643b3b5f89f4b8cd42b37ba437467a635d6929db855a",
         intel: "73c37a5cf65ee6930bff441b495e6d22bf86b58f695748acec0c027801568793"

  url "https://github.com/ShadowfetchStudio/ShadowCode/releases/download/v#{version}/ShadowCode_#{version}_#{arch}.dmg"
  name "ShadowCode"
  desc "Local-first AI coding workspace with bundled llama.cpp, coding agents, and OS sandboxing"
  homepage "https://github.com/ShadowfetchStudio/ShadowCode#readme"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "ShadowCode.app"
  binary "#{appdir}/ShadowCode.app/Contents/MacOS/shadowcode"

  zap trash: [
    "~/Library/Application Support/ShadowCode",
    "~/Library/Caches/com.shadowfetch.shadowcode",
    "~/Library/Preferences/com.shadowfetch.shadowcode.plist",
  ]
end
