package etcdcfg

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "shop-server.snapshot.yaml")
	if err := atomicWriteFile(path, "test:\n  shopName: apple\n"); err != nil {
		t.Fatal(err)
	}
	if err := atomicWriteFile(path, "test:\n  shopName: qq\n"); err != nil {
		t.Fatal(err)
	}
	got, err := readSnapshotFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != "test:\n  shopName: qq\n" {
		t.Fatalf("got %q", got)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Fatalf("tmp leftover: %s", e.Name())
		}
	}
}

func TestSnapshotFileName(t *testing.T) {
	p := snapshotFile("data/config-cache", "shop-server")
	if filepath.Base(p) != "shop-server.snapshot.yaml" {
		t.Fatalf("got %s", p)
	}
}
