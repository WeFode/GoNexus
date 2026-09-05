package deploy

import "testing"

func TestNormalizePlatform(t *testing.T) {
	if normalizePlatform("linux/x86_64") != "linux/amd64" {
		t.Fatal(normalizePlatform("linux/x86_64"))
	}
	if !platformsMatch("linux/amd64", "linux/x86_64") {
		t.Fatal("should match")
	}
	if platformsMatch("linux/arm64", "linux/amd64") {
		t.Fatal("should not match")
	}
}
