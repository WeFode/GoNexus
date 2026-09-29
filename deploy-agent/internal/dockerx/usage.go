package dockerx

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var publishedPortRe = regexp.MustCompile(`:(\d+)->`)

func PublishedHostPorts() ([]int, error) {
	out, err := Run("ps", "--format", "{{.Ports}}")
	if err != nil {
		return nil, err
	}
	return ParsePublishedPorts(out), nil
}

func ParsePublishedPorts(text string) []int {
	seen := map[int]struct{}{}
	for _, m := range publishedPortRe.FindAllStringSubmatch(text, -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil || n <= 0 {
			continue
		}
		seen[n] = struct{}{}
	}
	out := make([]int, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

func MemoryUsedBytes() (int64, error) {
	out, err := Run("stats", "--no-stream", "--format", "{{.MemUsage}}")
	if err != nil {
		return 0, err
	}
	return SumMemUsage(out)
}

func SumMemUsage(text string) (int64, error) {
	if strings.TrimSpace(text) == "" {
		return 0, nil
	}
	var sum int64
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		left := line
		if i := strings.Index(line, "/"); i >= 0 {
			left = line[:i]
		}
		n, err := parseByteSize(strings.TrimSpace(left))
		if err != nil {
			return 0, err
		}
		sum += n
	}
	return sum, nil
}

func parseByteSize(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "0" || s == "0B" {
		return 0, nil
	}
	i := 0
	for i < len(s) && (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
		i++
	}
	if i == 0 {
		return 0, strconv.ErrSyntax
	}
	value, err := strconv.ParseFloat(s[:i], 64)
	if err != nil {
		return 0, err
	}
	unit := strings.ToLower(strings.TrimSpace(s[i:]))
	scale := 1.0
	switch unit {
	case "", "b":
		scale = 1
	case "kb", "kib":
		scale = 1024
	case "mb", "mib":
		scale = 1024 * 1024
	case "gb", "gib":
		scale = 1024 * 1024 * 1024
	case "tb", "tib":
		scale = 1024 * 1024 * 1024 * 1024
	default:
		return 0, strconv.ErrSyntax
	}
	return int64(value * scale), nil
}
