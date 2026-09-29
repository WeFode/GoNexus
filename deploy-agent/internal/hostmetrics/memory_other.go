//go:build !linux && !windows

package hostmetrics

import "fmt"

func readMemory() (used, total int64, err error) {
	return -1, 0, fmt.Errorf("host memory unsupported")
}

func readCPU() (idle, total uint64, err error) {
	return 0, 0, fmt.Errorf("host cpu unsupported")
}
