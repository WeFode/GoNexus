package observability

import (
	"math"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var histogramBounds = []float64{5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000}

type metricRoute struct {
	count  int64
	errors int64
	sumMs  float64
}

type metricBucket struct {
	total  int64
	errors int64
	sumMs  float64
	hist   []int64
	routes map[string]*metricRoute
}

type Metrics struct {
	mu       sync.Mutex
	buckets  map[int64]*metricBucket
	inFlight atomic.Int64
	started  time.Time

	total   int64
	sumMs   float64
	errors  int64
	hist    []int64
	status2 int64
	status3 int64
	status4 int64
	status5 int64
}

func NewMetrics() *Metrics {
	return &Metrics{
		buckets: make(map[int64]*metricBucket),
		started: time.Now(),
		hist:    make([]int64, len(histogramBounds)+1),
	}
}

func (m *Metrics) Observe(method, route string, status int, dur time.Duration) {
	ms := float64(dur.Microseconds()) / 1000
	idx := histogramIndex(ms)
	key := method + " " + route
	minute := time.Now().Unix() / 60

	m.mu.Lock()
	b := m.buckets[minute]
	if b == nil {
		for k := range m.buckets {
			if k < minute-30 {
				delete(m.buckets, k)
			}
		}
		b = &metricBucket{
			hist:   make([]int64, len(histogramBounds)+1),
			routes: make(map[string]*metricRoute),
		}
		m.buckets[minute] = b
	}
	b.total++
	b.sumMs += ms
	b.hist[idx]++

	r := b.routes[key]
	if r == nil {
		r = &metricRoute{}
		b.routes[key] = r
	}
	r.count++
	r.sumMs += ms
	if status >= 500 {
		b.errors++
		r.errors++
	}

	m.total++
	m.sumMs += ms
	m.hist[idx]++
	switch {
	case status >= 500:
		m.status5++
		m.errors++
	case status >= 400:
		m.status4++
	case status >= 300:
		m.status3++
	case status >= 200:
		m.status2++
	}
	m.mu.Unlock()
}

func histogramIndex(ms float64) int {
	for i, b := range histogramBounds {
		if ms <= b {
			return i
		}
	}
	return len(histogramBounds)
}

// percentile 返回直方图的近似分位值（命中桶的上界）。
func percentile(hist []int64, total int64, p float64) float64 {
	if total <= 0 {
		return 0
	}
	target := int64(math.Ceil(float64(total) * p))
	var cum int64
	for i, c := range hist {
		cum += c
		if cum >= target {
			if i < len(histogramBounds) {
				return histogramBounds[i]
			}
			return histogramBounds[len(histogramBounds)-1]
		}
	}
	return histogramBounds[len(histogramBounds)-1]
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

type StatusStat struct {
	Key   string
	Count int64
}

type RouteStat struct {
	Method string
	Route  string
	Count  int64
	Errors int64
	AvgMs  float64
}

type MinutePoint struct {
	Minute string
	Total  int64
	Errors int64
	AvgMs  float64
	P95Ms  float64
}

type RuntimeStat struct {
	GoVersion   string
	NumCPU      int
	Goroutines  int
	HeapAllocMB float64
	HeapInuseMB float64
	SysMB       float64
	NumGC       uint32
	StartedAt   string
	UptimeSec   int64
}

type Snapshot struct {
	RequestTotal int64
	InFlight     int64
	ErrorRate    float64
	AvgMs        float64
	P95Ms        float64
	RPS          float64
	Statuses     []StatusStat
	Routes       []RouteStat
	Minutes      []MinutePoint
	Buffer       BufferStat
	Runtime      RuntimeStat
}

func (m *Metrics) Snapshot() Snapshot {
	now := time.Now()
	nowMinute := now.Unix() / 60
	uptime := now.Sub(m.started)

	m.mu.Lock()
	snap := Snapshot{
		RequestTotal: m.total,
		InFlight:     m.inFlight.Load(),
		AvgMs:        round1(div(m.sumMs, m.total)),
		P95Ms:        percentile(m.hist, m.total, 0.95),
		ErrorRate:    div(float64(m.errors), m.total),
		Statuses: []StatusStat{
			{Key: "2xx", Count: m.status2},
			{Key: "3xx", Count: m.status3},
			{Key: "4xx", Count: m.status4},
			{Key: "5xx", Count: m.status5},
		},
	}

	for i := int64(29); i >= 0; i-- {
		minute := nowMinute - i
		point := MinutePoint{Minute: time.Unix(minute*60, 0).Format("15:04")}
		if b := m.buckets[minute]; b != nil {
			point.Total = b.total
			point.Errors = b.errors
			point.AvgMs = round1(div(b.sumMs, b.total))
			point.P95Ms = percentile(b.hist, b.total, 0.95)
		}
		snap.Minutes = append(snap.Minutes, point)
	}

	type routeAgg struct {
		RouteStat
		sumMs float64
	}
	agg := make(map[string]*routeAgg)
	var rpsTotal int64
	for minute, b := range m.buckets {
		if minute >= nowMinute-4 {
			rpsTotal += b.total
		}
		if minute < nowMinute-29 {
			continue
		}
		for key, r := range b.routes {
			a := agg[key]
			if a == nil {
				method, route, _ := strings.Cut(key, " ")
				a = &routeAgg{RouteStat: RouteStat{Method: method, Route: route}}
				agg[key] = a
			}
			a.Count += r.count
			a.Errors += r.errors
			a.sumMs += r.sumMs
		}
	}
	for _, a := range agg {
		a.AvgMs = round1(div(a.sumMs, a.Count))
		snap.Routes = append(snap.Routes, a.RouteStat)
	}
	sort.Slice(snap.Routes, func(i, j int) bool {
		if snap.Routes[i].Count == snap.Routes[j].Count {
			return snap.Routes[i].Route < snap.Routes[j].Route
		}
		return snap.Routes[i].Count > snap.Routes[j].Count
	})
	if len(snap.Routes) > 8 {
		snap.Routes = snap.Routes[:8]
	}

	windowSec := math.Min(uptime.Seconds(), 300)
	if windowSec < 1 {
		windowSec = 1
	}
	snap.RPS = round1(float64(rpsTotal) / windowSec)
	m.mu.Unlock()

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	snap.Runtime = RuntimeStat{
		GoVersion:   runtime.Version(),
		NumCPU:      runtime.NumCPU(),
		Goroutines:  runtime.NumGoroutine(),
		HeapAllocMB: round1(float64(mem.HeapAlloc) / 1024 / 1024),
		HeapInuseMB: round1(float64(mem.HeapInuse) / 1024 / 1024),
		SysMB:       round1(float64(mem.Sys) / 1024 / 1024),
		NumGC:       mem.NumGC,
		StartedAt:   m.started.Format("2006-01-02 15:04:05"),
		UptimeSec:   int64(uptime.Seconds()),
	}
	snap.Buffer = BufferStatus()
	return snap
}

func div(sum float64, n int64) float64 {
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

var defaultMetrics = NewMetrics()

func ObserveRequest(method, route string, status int, dur time.Duration) {
	defaultMetrics.Observe(method, route, status, dur)
}

func InFlightAdd(delta int64) { defaultMetrics.inFlight.Add(delta) }

func MetricsSnapshot() Snapshot { return defaultMetrics.Snapshot() }
