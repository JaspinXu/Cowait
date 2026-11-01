#!/bin/sh
# Install or update Cowait (standalone binary, no Node needed) on macOS or Linux:
#
#   curl -fsSL https://github.com/JaspinXu/Cowait/releases/latest/download/install.sh | sh
#
# Running it again updates in place. Settings (environment variables):
#   COWAIT_VERSION=0.3.0        install that release instead of the latest
#   COWAIT_INSTALL_DIR=<dir>    where the binary goes (default: ~/.cowait/bin)
#   COWAIT_DOWNLOAD_URL=<url>   base URL of the release files (mirrors, testing)
#   COWAIT_NO_MODIFY_PATH=1     do not create the ~/.local/bin/cowait link
set -eu

REPO="JaspinXu/Cowait"

say() { printf '%s\n' "$*"; }
fail() {
	printf 'cowait install: %s\n' "$*" >&2
	exit 1
}

download() { # url file
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --retry 2 -o "$2" "$1" || fail "download failed: $1"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$2" "$1" || fail "download failed: $1"
	else
		fail "needs curl or wget"
	fi
}

sha256() { # file
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d ' ' -f 1
	elif command -v openssl >/dev/null 2>&1; then
		openssl dgst -sha256 "$1" | sed 's/^.*= *//'
	else
		fail "needs sha256sum, shasum or openssl to verify the download"
	fi
}

on_path() { # dir
	case ":$PATH:" in
	*":$1:"* | *":$1/:"*) return 0 ;;
	*) return 1 ;;
	esac
}

main() {
	os=$(uname -s)
	arch=$(uname -m)
	case "$os" in
	Linux) os=linux ;;
	Darwin) os=darwin ;;
	MINGW* | MSYS* | CYGWIN*) fail "on Windows, run in PowerShell: irm https://github.com/$REPO/releases/latest/download/install.ps1 | iex" ;;
	*) fail "no prebuilt binary for $os; install with npm instead: npm i -g cowait" ;;
	esac
	case "$arch" in
	x86_64 | amd64) arch=x64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*) fail "no prebuilt binary for $arch; install with npm instead: npm i -g cowait" ;;
	esac
	# An x64 shell under Rosetta on Apple Silicon should still get the native binary.
	if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
		arch=arm64
	fi
	# The Linux binaries link against glibc; Alpine and other musl systems cannot run them.
	if [ "$os" = linux ] && ls /lib/ld-musl-* >/dev/null 2>&1; then
		fail "musl-based Linux (e.g. Alpine) is not supported by the prebuilt binary; install with npm instead: npm i -g cowait"
	fi

	asset="cowait-$os-$arch"
	if [ -n "${COWAIT_DOWNLOAD_URL:-}" ]; then
		base=${COWAIT_DOWNLOAD_URL%/}
	elif [ -n "${COWAIT_VERSION:-}" ]; then
		base="https://github.com/$REPO/releases/download/v${COWAIT_VERSION#v}"
	else
		base="https://github.com/$REPO/releases/latest/download"
	fi
	dir=${COWAIT_INSTALL_DIR:-$HOME/.cowait/bin}
	exe="$dir/cowait"

	mkdir -p "$dir"
	# Download next to the target so the final mv is an atomic rename: a running panel keeps its old copy.
	tmp="$dir/.install.$$"
	rm -rf "$tmp"
	mkdir "$tmp"
	trap 'rm -rf "$tmp"' EXIT
	trap 'exit 1' INT TERM

	say "Downloading $asset from $base"
	download "$base/$asset" "$tmp/$asset"
	download "$base/SHA256SUMS" "$tmp/SHA256SUMS"
	expected=$(awk -v f="$asset" '$2 == f || $2 == ("*" f) { print $1 }' "$tmp/SHA256SUMS")
	[ -n "$expected" ] || fail "SHA256SUMS has no entry for $asset"
	actual=$(sha256 "$tmp/$asset")
	[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
	chmod +x "$tmp/$asset"
	mv -f "$tmp/$asset" "$exe"

	version=$("$exe" --version 2>/dev/null) || fail "installed $exe, but it does not run on this system"
	say "Cowait $version installed: $exe (checksum verified)"

	# Put `cowait` on PATH: link it into ~/.local/bin when that folder is already on PATH.
	link_dir="$HOME/.local/bin"
	path_hint=""
	if on_path "$dir"; then
		:
	elif [ -z "${COWAIT_NO_MODIFY_PATH:-}" ] && [ -d "$link_dir" ] && on_path "$link_dir"; then
		ln -sf "$exe" "$link_dir/cowait"
		say "Linked $link_dir/cowait -> $exe"
	else
		case "${SHELL:-}" in
		*/zsh) rc="$HOME/.zshrc" ;;
		*/bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
		*/fish) rc="" ;;
		*) rc="$HOME/.profile" ;;
		esac
		if [ -n "$rc" ]; then
			path_hint="echo 'export PATH=\"$dir:\$PATH\"' >> $rc && . $rc"
		else
			path_hint="fish_add_path $dir"
		fi
	fi

	found=$(command -v cowait 2>/dev/null || true)
	if [ -n "$found" ] && [ -z "$path_hint" ] && [ "$found" != "$exe" ] && [ "$found" != "$link_dir/cowait" ]; then
		say ""
		say "Note: another cowait comes first on your PATH: $found"
		say "      Remove it, or run $exe directly."
	fi

	say ""
	if [ -n "$path_hint" ]; then
		say "Add Cowait to your PATH (one time):"
		say "  $path_hint"
		say ""
	fi
	say "Next:"
	say "  cowait install     hook Cowait into Claude Code (or: cowait install --project, for one project)"
	say "  cowait             open the panel in a terminal pane next to Claude Code (cowait split does it for you)"
}

main "$@"
