package observability

import (
	"math"
	"testing"
	"time"
)

func TestMetricsSnapshot(t *testing.T) {
	m := NewMetrics()
	m.Observe("GET", "/api/v1/a", 200, 3*time.Millisecond)
	m.Observe("GET", "/api/v1/a", 200, 40*time.Millisecond)
	m.Observe("POST", "/api/v1/b", 500, 120*time.Millisecond)
	m.Observe("POST", "/api/v1/b", 404, 18*time.Millisecond)

	snap := m.Snapshot()
	if snap.RequestTotal != 4 {
		t.Fatalf("expected 4 requests, got %d", snap.RequestTotal)
	}
	if snap.Statuses[0].Count != 2 || snap.Statuses[2].Count != 1 || snap.Statuses[3].Count != 1 {
		t.Fatalf("unexpected status distribution: %+v", snap.Statuses)
	}
	if math.Abs(snap.ErrorRate-0.25) > 1e-9 {
		t.Fatalf("expected error rate 0.25, got %f", snap.ErrorRate)
	}
	if snap.P95Ms <= 0 || snap.AvgMs <= 0 {
		t.Fatalf("latency stats not computed: p95=%f avg=%f", snap.P95Ms, snap.AvgMs)
	}
	if len(snap.Minutes) != 30 {
		t.Fatalf("expected 30 minute points, got %d", len(snap.Minutes))
	}
	var minuteTotal, minuteErrors int64
	for _, p := range snap.Minutes {
		minuteTotal += p.Total
		minuteErrors += p.Errors
	}
	if minuteTotal != 4 || minuteErrors != 1 {
		t.Fatalf("unexpected minute aggregation: total=%d errors=%d", minuteTotal, minuteErrors)
	}
	if len(snap.Routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(snap.Routes))
	}
	if snap.Routes[0].Route != "/api/v1/a" || snap.Routes[0].Count != 2 {
		t.Fatalf("unexpected top route: %+v", snap.Routes[0])
	}
	if snap.Routes[1].Errors != 1 {
		t.Fatalf("route error count not tracked: %+v", snap.Routes[1])
	}
	if snap.Runtime.GoVersion == "" || snap.Runtime.NumCPU <= 0 {
		t.Fatalf("runtime stats missing: %+v", snap.Runtime)
	}
}

func TestMetricsInFlight(t *testing.T) {
	m := NewMetrics()
	m.inFlight.Add(2)
	if snap := m.Snapshot(); snap.InFlight != 2 {
		t.Fatalf("expected inFlight 2, got %d", snap.InFlight)
	}
}
