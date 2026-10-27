package hostmetrics

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

func parseMeminfo(text string) (used, total int64, err error) {
	var totalKB, availKB int64
	var hasTotal, hasAvail bool
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		n, convErr := strconv.ParseInt(fields[1], 10, 64)
		if convErr != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB, hasTotal = n, true
		case "MemAvailable:":
			availKB, hasAvail = n, true
		}
	}
	if !hasTotal || !hasAvail || totalKB <= 0 {
		return -1, 0, fmt.Errorf("meminfo incomplete")
	}
	usedKB := totalKB - availKB
	if usedKB < 0 {
		usedKB = 0
	}
	return usedKB * 1024, totalKB * 1024, nil
}

func parseProcStat(text string) (idle, total uint64, err error) {
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return 0, 0, fmt.Errorf("cpu line short")
		}
		var nums []uint64
		for _, s := range fields[1:] {
			n, convErr := strconv.ParseUint(s, 10, 64)
			if convErr != nil {
				break
			}
			nums = append(nums, n)
		}
		if len(nums) < 4 {
			return 0, 0, fmt.Errorf("cpu line short")
		}
		var sum uint64
		for i, n := range nums {
			if i >= 8 {
				break
			}
			sum += n
		}
		idle = nums[3]
		if len(nums) > 4 {
			idle += nums[4]
		}
		return idle, sum, nil
	}
	return 0, 0, fmt.Errorf("no cpu line")
}

func usagePercent(idle1, total1, idle2, total2 uint64) float64 {
	if total2 <= total1 {
		return -1
	}
	dt := float64(total2 - total1)
	var di float64
	if idle2 > idle1 {
		di = float64(idle2 - idle1)
	}
	if di > dt {
		di = dt
	}
	return (1 - di/dt) * 100
}

func parseMemMax(text string) int64 {
	text = strings.TrimSpace(text)
	if text == "" || text == "max" {
		return 0
	}
	n, err := strconv.ParseInt(text, 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func parseCPUMax(text string) int {
	fields := strings.Fields(text)
	if len(fields) < 2 || fields[0] == "max" {
		return 0
	}
	quota, err1 := strconv.ParseFloat(fields[0], 64)
	period, err2 := strconv.ParseFloat(fields[1], 64)
	if err1 != nil || err2 != nil || quota <= 0 || period <= 0 {
		return 0
	}
	n := int(math.Ceil(quota / period))
	if n < 1 {
		return 1
	}
	return n
}

func parseCPUUsageUsec(text string) uint64 {
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "usage_usec" {
			n, err := strconv.ParseUint(fields[1], 10, 64)
			if err == nil {
				return n
			}
		}
	}
	return 0
}

func sameDomain(hostTotal, dockerTotal int64) bool {
	if hostTotal <= 0 {
		return false
	}
	if dockerTotal <= 0 {
		return true
	}
	ratio := float64(hostTotal) / float64(dockerTotal)
	return ratio >= 0.8 && ratio <= 1.25
}
