package etcdcfg

import "testing"

func TestParseHost(t *testing.T) {
	got, err := ParseHost("127.0.0.1:2379@shop-server")
	if err != nil {
		t.Fatal(err)
	}
	if got.ServiceName != "shop-server" || len(got.Endpoints) != 1 || got.Endpoints[0] != "127.0.0.1:2379" {
		t.Fatalf("unexpected: %+v", got)
	}

	got, err = ParseHost("127.0.0.1:2379,127.0.0.1:2479@shop-server")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Endpoints) != 2 || got.ServiceName != "shop-server" {
		t.Fatalf("unexpected: %+v", got)
	}

	got, err = ParseHost("127.0.0.1:2379")
	if err != nil {
		t.Fatal(err)
	}
	if got.ServiceName != "" || got.Endpoints[0] != "127.0.0.1:2379" {
		t.Fatalf("unexpected: %+v", got)
	}

	if _, err = ParseHost(""); err == nil {
		t.Fatal("expected error")
	}
}

func TestDeepMerge(t *testing.T) {
	dst := map[string]any{
		"database": map[string]any{
			"default": map[string]any{"link": "a", "debug": true},
		},
		"logger": map[string]any{"level": "all"},
	}
	src := map[string]any{
		"server": map[string]any{"address": ":8000"},
		"database": map[string]any{
			"default": map[string]any{"debug": false},
		},
	}
	merged := deepMerge(dst, src)
	db := merged["database"].(map[string]any)["default"].(map[string]any)
	if db["link"] != "a" || db["debug"] != false {
		t.Fatalf("merge failed: %+v", db)
	}
	if merged["server"].(map[string]any)["address"] != ":8000" {
		t.Fatal("server not merged")
	}
}
