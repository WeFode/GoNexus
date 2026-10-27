//go:build linux

package hostmetrics

import "os"

func readMemory() (used, total int64, err error) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1, 0, err
	}
	return parseMeminfo(string(b))
}

func readCPU() (idle, total uint64, err error) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	return parseProcStat(string(b))
}
