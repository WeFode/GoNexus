package hostmetrics

import (
	"sync"
	"time"
)

var (
	cpuMu            sync.Mutex
	prevIdle         uint64
	prevTotal        uint64
	hasPrevCPUSample bool
)

// Collect 读取整机 CPU 占用和已用内存。
// dockerMemTotal 来自 docker info。与宿主机内存总量偏差过大时（例如 Windows 宿主对 Docker Desktop 虚拟机）不采用宿主机内存，memUsed 返回 -1。
func Collect(dockerMemTotal int64) (cpuUsedPercent float64, memUsed int64, source string) {
	cpuUsedPercent = sampleCPU()
	memUsed = -1
	used, total, err := readMemory()
	if err != nil || used < 0 || !sameDomain(total, dockerMemTotal) {
		return cpuUsedPercent, -1, ""
	}
	if dockerMemTotal > 0 && used > dockerMemTotal {
		used = dockerMemTotal
	}
	return cpuUsedPercent, used, "host"
}

func sampleCPU() float64 {
	idle, total, err := readCPU()
	if err != nil || total == 0 {
		return -1
	}
	cpuMu.Lock()
	if hasPrevCPUSample && total > prevTotal {
		pct := usagePercent(prevIdle, prevTotal, idle, total)
		prevIdle, prevTotal = idle, total
		cpuMu.Unlock()
		return pct
	}
	prevIdle, prevTotal, hasPrevCPUSample = idle, total, true
	cpuMu.Unlock()

	time.Sleep(200 * time.Millisecond)
	idle2, total2, err := readCPU()
	if err != nil || total2 <= total {
		return -1
	}
	pct := usagePercent(idle, total, idle2, total2)
	cpuMu.Lock()
	prevIdle, prevTotal, hasPrevCPUSample = idle2, total2, true
	cpuMu.Unlock()
	return pct
}
