package deploy

import "strings"

func normalizePlatform(p string) string {
	p = strings.ToLower(strings.TrimSpace(p))
	p = strings.ReplaceAll(p, "x86_64", "amd64")
	p = strings.ReplaceAll(p, "aarch64", "arm64")
	return p
}

func platformsMatch(artifact, node string) bool {
	a, n := normalizePlatform(artifact), normalizePlatform(node)
	if a == "" || n == "" {
		return true
	}
	return a == n
}
