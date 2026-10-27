//go:build !linux

package hostmetrics

func Quota() (cpus int, memLimit, memUsed int64, cpuPct float64, ok bool) {
	return 0, 0, -1, -1, false
}
