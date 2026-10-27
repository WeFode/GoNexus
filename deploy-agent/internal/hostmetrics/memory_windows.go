//go:build windows

package hostmetrics

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
)

type memoryStatusEx struct {
	length               uint32
	memoryLoad           uint32
	totalPhys            uint64
	availPhys            uint64
	totalPageFile        uint64
	availPageFile        uint64
	totalVirtual         uint64
	availVirtual         uint64
	availExtendedVirtual uint64
}

type filetime struct {
	low  uint32
	high uint32
}

func readMemory() (used, total int64, err error) {
	var m memoryStatusEx
	m.length = uint32(unsafe.Sizeof(m))
	r, _, callErr := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		if callErr != nil {
			return -1, 0, callErr
		}
		return -1, 0, fmt.Errorf("GlobalMemoryStatusEx")
	}
	if m.totalPhys == 0 || m.totalPhys < m.availPhys {
		return -1, 0, fmt.Errorf("memory status empty")
	}
	return int64(m.totalPhys - m.availPhys), int64(m.totalPhys), nil
}

func readCPU() (idle, total uint64, err error) {
	var idleFT, kernelFT, userFT filetime
	r, _, callErr := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleFT)),
		uintptr(unsafe.Pointer(&kernelFT)),
		uintptr(unsafe.Pointer(&userFT)),
	)
	if r == 0 {
		if callErr != nil {
			return 0, 0, callErr
		}
		return 0, 0, fmt.Errorf("GetSystemTimes")
	}
	idle = uint64(idleFT.high)<<32 | uint64(idleFT.low)
	kernel := uint64(kernelFT.high)<<32 | uint64(kernelFT.low)
	user := uint64(userFT.high)<<32 | uint64(userFT.low)
	return idle, kernel + user, nil
}
