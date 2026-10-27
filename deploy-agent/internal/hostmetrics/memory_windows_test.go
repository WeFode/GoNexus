//go:build windows

package hostmetrics

import (
	"testing"
	"unsafe"
)

func TestMemoryStatusExSize(t *testing.T) {
	if unsafe.Sizeof(memoryStatusEx{}) != 64 {
		t.Fatalf("size %d", unsafe.Sizeof(memoryStatusEx{}))
	}
}
