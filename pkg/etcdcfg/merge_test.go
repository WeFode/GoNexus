package etcdcfg

import "testing"

func TestApplyLoopback(t *testing.T) {
	in := map[string]any{
		"database": map[string]any{
			"default": map[string]any{
				"link": "pgsql:postgres:123456@tcp(127.0.0.1:5433)/app_db",
			},
		},
		"redis": map[string]any{
			"default": map[string]any{"address": "127.0.0.1:6380"},
		},
	}
	out := applyLoopback(in, "host.docker.internal")
	db := out["database"].(map[string]any)["default"].(map[string]any)["link"].(string)
	if db != "pgsql:postgres:123456@tcp(host.docker.internal:5433)/app_db" {
		t.Fatalf("db %s", db)
	}
	addr := out["redis"].(map[string]any)["default"].(map[string]any)["address"].(string)
	if addr != "host.docker.internal:6380" {
		t.Fatalf("redis %s", addr)
	}
	orig := in["redis"].(map[string]any)["default"].(map[string]any)["address"].(string)
	if orig != "127.0.0.1:6380" {
		t.Fatal("input mutated")
	}
}
