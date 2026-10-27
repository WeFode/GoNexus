package etcdcfg

import (
	"reflect"
	"testing"
)

func TestChangedKeys(t *testing.T) {
	oldMap := map[string]any{
		"test": map[string]any{"shopName": "apple"},
		"database": map[string]any{
			"default": map[string]any{"link": "a"},
		},
	}
	newMap := map[string]any{
		"test": map[string]any{"shopName": "qq"},
		"database": map[string]any{
			"default": map[string]any{"link": "b"},
		},
	}
	got := changedKeys(oldMap, newMap)
	want := []string{"database.default.link", "test.shopName"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestApplySticky(t *testing.T) {
	oldMap := map[string]any{
		"test":     map[string]any{"shopName": "apple"},
		"database": map[string]any{"default": map[string]any{"link": "old"}},
	}
	newMap := map[string]any{
		"test":     map[string]any{"shopName": "qq"},
		"database": map[string]any{"default": map[string]any{"link": "new"}},
	}
	got := applySticky(oldMap, newMap, []string{"database"})
	if got["test"].(map[string]any)["shopName"] != "qq" {
		t.Fatalf("test should update: %+v", got["test"])
	}
	if got["database"].(map[string]any)["default"].(map[string]any)["link"] != "old" {
		t.Fatalf("database should stay old: %+v", got["database"])
	}
	gotAll := applySticky(oldMap, newMap, nil)
	if gotAll["database"].(map[string]any)["default"].(map[string]any)["link"] != "new" {
		t.Fatal("no sticky should use new database")
	}
}

func TestSplitChanged(t *testing.T) {
	live, sticky := splitChanged(
		[]string{"test.shopName", "database.default.link"},
		[]string{"database"},
	)
	if !reflect.DeepEqual(live, []string{"test.shopName"}) {
		t.Fatalf("live=%v", live)
	}
	if !reflect.DeepEqual(sticky, []string{"database.default.link"}) {
		t.Fatalf("sticky=%v", sticky)
	}
}

func TestShouldSkipReload(t *testing.T) {
	sticky := []string{"database", "redis"}
	if !shouldSkipReload([]string{"/config-center/shared/database"}, sticky, "/config-center", "shop-server") {
		t.Fatal("should skip sticky-only shared change")
	}
	if shouldSkipReload([]string{"/config-center/services/shop-server"}, sticky, "/config-center", "shop-server") {
		t.Fatal("service yaml change must reload")
	}
	if shouldSkipReload([]string{"/config-center/shared/database"}, nil, "/config-center", "shop-server") {
		t.Fatal("empty sticky should never skip")
	}
}

func TestRelevantKey(t *testing.T) {
	a := &Adapter{
		client:      &Client{prefix: "/config-center"},
		service:     "shop-server",
		watchShared: true,
	}
	if !a.relevantKey("/config-center/shared/database") {
		t.Fatal("shared should be relevant")
	}
	if !a.relevantKey("/config-center/services/shop-server") {
		t.Fatal("own service should be relevant")
	}
	if a.relevantKey("/config-center/services/other-server") {
		t.Fatal("other service should be ignored")
	}
	a.watchShared = false
	if a.relevantKey("/config-center/shared/redis") {
		t.Fatal("skipSharedWatch should ignore shared")
	}
}
