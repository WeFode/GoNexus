package hostmetrics

import "testing"

func TestParseMeminfo(t *testing.T) {
	text := "MemTotal:       16384000 kB\nMemFree:         1000 kB\nMemAvailable:    8192000 kB\n"
	used, total, err := parseMeminfo(text)
	if err != nil {
		t.Fatal(err)
	}
	if total != 16384000*1024 || used != (16384000-8192000)*1024 {
		t.Fatalf("used=%d total=%d", used, total)
	}
}

func TestParseProcStat(t *testing.T) {
	text := "cpu  100 0 50 800 50 10 10 0 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\n"
	idle, total, err := parseProcStat(text)
	if err != nil {
		t.Fatal(err)
	}
	if idle != 850 || total != 1020 {
		t.Fatalf("idle=%d total=%d", idle, total)
	}
}

func TestUsagePercent(t *testing.T) {
	if usagePercent(100, 100, 200, 200) != 0 {
		t.Fatal("all idle")
	}
	if usagePercent(100, 100, 100, 200) != 100 {
		t.Fatal("all busy")
	}
	if usagePercent(100, 200, 100, 150) >= 0 {
		t.Fatal("non-monotonic total")
	}
}

func TestParseCgroupQuota(t *testing.T) {
	if parseMemMax("max") != 0 || parseMemMax("1610612736") != 1610612736 {
		t.Fatal(parseMemMax("1610612736"))
	}
	if parseCPUMax("max 100000") != 0 {
		t.Fatal("unlimited")
	}
	if parseCPUMax("200000 100000") != 2 || parseCPUMax("100000 100000") != 1 {
		t.Fatalf("cpus %d %d", parseCPUMax("200000 100000"), parseCPUMax("100000 100000"))
	}
	if parseCPUUsageUsec("usage_usec 896662\nuser_usec 1\n") != 896662 {
		t.Fatal(parseCPUUsageUsec("usage_usec 896662"))
	}
}

func TestSameDomain(t *testing.T) {
	if !sameDomain(16<<30, 15<<30) {
		t.Fatal("linux host and docker should match")
	}
	if sameDomain(32<<30, 8<<30) {
		t.Fatal("windows host vs docker vm should not match")
	}
}
