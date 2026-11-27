cask "shadowcode" do
  arch arm: "aarch64", intel: "x64"

  version "2.7.1"
  sha256 arm: "d6a5624543d068bbfa19f3e1cf80c8a913bae1b27e1daf99eda667fa45315cf0",
         intel: "e4f1c3804be074638504a34a9b8f7ae438a382230481cd0b31571c6c0fb85864"

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
