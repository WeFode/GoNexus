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

func TestContainerName(t *testing.T) {
	if containerName("deploy", "shop-server") != "cc-shop-server" {
		t.Fatal(containerName("deploy", "shop-server"))
	}
	if containerName("canary", "shop-server") != "cc-shop-server-canary" {
		t.Fatal(containerName("canary", "shop-server"))
	}
	if containerName("stop-canary", "shop-server") != "cc-shop-server-canary" {
		t.Fatal(containerName("stop-canary", "shop-server"))
	}
	if containerName("start", "shop-server-canary") != "cc-shop-server-canary" {
		t.Fatal(containerName("start", "shop-server-canary"))
	}
}
