package etcdcfg

import (
	"context"
	"testing"
)

func TestCurrentWithoutAdapter(t *testing.T) {
	if _, ok := Current(); ok {
		t.Fatal("file adapter 不应被当成 etcdcfg.Adapter")
	}
	if _, ok := Runtime(); ok {
		t.Fatal("未 Boot 时 Runtime 应为 false")
	}
}

func TestProbeWithoutAdapter(t *testing.T) {
	p := Probe(context.Background())
	if p.ConfigFrom != "file" {
		t.Fatalf("expected file source, got %+v", p)
	}
	if p.Database != ProbeSkipped || p.Redis != ProbeSkipped {
		t.Fatalf("unconfigured db/redis should be skipped: %+v", p)
	}
}

func TestHasRootEmpty(t *testing.T) {
	if hasRoot(context.Background(), "this-key-does-not-exist-etcdcfg") {
		t.Fatal("missing key should be false")
	}
}
