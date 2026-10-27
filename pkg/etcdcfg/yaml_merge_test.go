package etcdcfg

import "testing"

func TestYamlToMapMerge(t *testing.T) {
	sharedDB, err := yamlToMap("database:\n  default:\n    link: pgsql:x\n    debug: true\n")
	if err != nil {
		t.Fatal(err)
	}
	sharedRedis, err := yamlToMap("redis:\n  default:\n    address: 127.0.0.1:6380\n")
	if err != nil {
		t.Fatal(err)
	}
	svc, err := yamlToMap("server:\n  address: \":8000\"\ndatabase:\n  default:\n    debug: false\n")
	if err != nil {
		t.Fatal(err)
	}
	merged := deepMerge(deepMerge(sharedDB, sharedRedis), svc)
	db := merged["database"].(map[string]any)["default"].(map[string]any)
	if db["link"] != "pgsql:x" {
		t.Fatalf("link lost: %+v", db)
	}
	if db["debug"] != false {
		t.Fatalf("debug not overridden: %+v", db)
	}
	if merged["redis"] == nil || merged["server"] == nil {
		t.Fatalf("missing keys: %+v", merged)
	}
}
