# typed: false
# frozen_string_literal: true

class Forkhub < Formula
  desc "Keep up-to-date upstream + your custom patches. Patches are intent, not diffs."
  homepage "https://github.com/ImBIOS/forkhub"
  version "0.2.11"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/ImBIOS/forkhub/releases/download/v0.2.11/forkhub-darwin-x64"
      sha256 "d526fc9a225fb9da53f78026ff2abbf1f168dd183c2e7a342a29801daf297698"
    end
    on_arm do
      url "https://github.com/ImBIOS/forkhub/releases/download/v0.2.11/forkhub-darwin-arm64"
      sha256 "9378e7eecfb90da83b543e0a5144eed98d1014e64ff8d57952305826b1c1be29"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/ImBIOS/forkhub/releases/download/v0.2.11/forkhub-linux-x64"
      sha256 "75816f280d4ec9c7eca348581edbcfac5f754de16e37ef7ed33629c866072635"
    end
    on_arm do
      url "https://github.com/ImBIOS/forkhub/releases/download/v0.2.11/forkhub-linux-arm64"
      sha256 "3bbaba51119cda6e407a1ac7e38c7a4e367206a6eb304dfdf9c1f4a1b78dad60"
    end
  end

  def install
    os_arch = if OS.mac? && Hardware::CPU.arm?
      "darwin-arm64"
    elsif OS.mac?
      "darwin-x64"
    elsif Hardware::CPU.arm?
      "linux-arm64"
    else
      "linux-x64"
    end
    bin.install "forkhub-#{os_arch}" => "fh"
  end

  test do
    assert_match "forkhub", shell_output("#{bin}/fh --help")
  end
end
