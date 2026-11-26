cask "shadowcode" do
  arch arm: "aarch64", intel: "x64"

  version "2.7.0"
  sha256 arm: :no_check,
         intel: :no_check

  url "https://github.com/ShadowfetchStudio/ShadowCode/releases/download/v#{version}/ShadowCode_#{version}_#{arch}.dmg"
  name "ShadowCode"
  desc "Local-first AI coding workspace with bundled llama.cpp, coding agents, and OS sandboxing"
  homepage "https://shadowcode.org"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "ShadowCode.app"
  binary "#{appdir}/ShadowCode.app/Contents/MacOS/shadowcode"

  zap trash: [
    "~/Library/Application Support/ShadowCode",
    "~/Library/Caches/com.shadowfetch.shadowcode",
    "~/Library/Preferences/com.shadowfetch.shadowcode.plist",
  ]
end
