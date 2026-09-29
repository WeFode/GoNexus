//go:build linux

package hostmetrics

import (
	"os"
	"sync"
	"time"
)

func Quota() (cpus int, memLimit, memUsed int64, cpuPct float64, ok bool) {
	memLimit = parseMemMax(readText("/sys/fs/cgroup/memory.max"))
	cpus = parseCPUMax(readText("/sys/fs/cgroup/cpu.max"))
	if memLimit <= 0 && cpus <= 0 {
		return 0, 0, -1, -1, false
	}
	memUsed = -1
	if raw := parseMemMax(readText("/sys/fs/cgroup/memory.current")); raw > 0 {
		memUsed = raw
	}
	cpuPct = cgroupCPUPercent(cpus)
	return cpus, memLimit, memUsed, cpuPct, true
}

func readText(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

var (
	cgroupMu       sync.Mutex
	prevUsageUsec  uint64
	prevUsageAt    time.Time
	hasPrevCgroup  bool
)

func cgroupCPUPercent(cpus int) float64 {
	usage := parseCPUUsageUsec(readText("/sys/fs/cgroup/cpu.stat"))
	if usage == 0 || cpus <= 0 {
		return -1
	}
	now := time.Now()
	cgroupMu.Lock()
	defer cgroupMu.Unlock()
	if !hasPrevCgroup {
		prevUsageUsec, prevUsageAt, hasPrevCgroup = usage, now, true
		return -1
	}
	du := usage - prevUsageUsec
	dt := now.Sub(prevUsageAt)
	prevUsageUsec, prevUsageAt = usage, now
	if dt <= 0 {
		return -1
	}
	pct := float64(du) / (float64(dt.Microseconds()) * float64(cpus)) * 100
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}
