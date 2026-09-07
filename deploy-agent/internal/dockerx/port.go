package dockerx

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func isBindError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "ports are not available") ||
		strings.Contains(s, "address already in use") ||
		(strings.Contains(s, "bind:") && strings.Contains(s, "only one usage"))
}

func HostPorts(name string) []int {
	out, err := Run("inspect", "-f",
		`{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostPort}} {{end}}{{end}}`,
		name)
	if err != nil || out == "" {
		return nil
	}
	var ports []int
	seen := map[int]struct{}{}
	for _, part := range strings.Fields(out) {
		n, convErr := strconv.Atoi(part)
		if convErr != nil || n <= 0 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		ports = append(ports, n)
	}
	return ports
}

func wrapBindError(name string, extra []int, err error) error {
	if err == nil || !isBindError(err) {
		return err
	}
	ports := extra
	if name != "" {
		ports = append(ports, HostPorts(name)...)
	}
	ports = uniquePositive(ports)
	who := occupants(ports)
	portHint := "宿主机端口"
	if len(ports) > 0 {
		portHint = fmt.Sprintf("宿主机端口 %v", ports)
	}
	msg := fmt.Sprintf("%s 已被占用，无法启动 %s。常见原因：本机 go run 的同名服务仍在听该端口，或另一容器已映射同一端口。", portHint, name)
	if who != "" {
		msg += " " + who
	}
	msg += " 处理：停掉占用进程，或发布时改用其它宿主机端口（灰度旁路请填与主端口不同的灰度端口）。"
	return fmt.Errorf("%s 原始错误: %w", msg, err)
}

func uniquePositive(in []int) []int {
	seen := map[int]struct{}{}
	var out []int
	for _, n := range in {
		if n <= 0 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	return out
}

func parseListeningPIDs(netstatOut string, port int) []string {
	want := strconv.Itoa(port)
	seen := map[string]struct{}{}
	var pids []string
	for _, line := range strings.Split(netstatOut, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		listenAt := -1
		for i, f := range fields {
			if strings.EqualFold(f, "LISTENING") {
				listenAt = i
				break
			}
		}
		if listenAt < 2 || listenAt+1 >= len(fields) {
			continue
		}
		if localPort(fields[1]) != want {
			continue
		}
		pid := fields[listenAt+1]
		if _, ok := seen[pid]; ok {
			continue
		}
		seen[pid] = struct{}{}
		pids = append(pids, pid)
	}
	return pids
}

func localPort(addr string) string {
	addr = strings.TrimSpace(addr)
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		return strings.Trim(addr[i+1:], "[]")
	}
	return ""
}

func occupants(ports []int) string {
	if len(ports) == 0 {
		return ""
	}
	if runtime.GOOS != "windows" {
		return linuxOccupants(ports)
	}
	out, err := exec.Command("netstat", "-ano").CombinedOutput()
	if err != nil {
		return ""
	}
	var parts []string
	for _, port := range ports {
		pids := parseListeningPIDs(string(out), port)
		if len(pids) == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf(":%d 被 PID %s 占用", port, strings.Join(pids, ",")))
	}
	return strings.Join(parts, "；")
}

func linuxOccupants(ports []int) string {
	var parts []string
	for _, port := range ports {
		out, err := exec.Command("ss", "-lptn", fmt.Sprintf("sport = :%d", port)).CombinedOutput()
		if err != nil || len(out) == 0 {
			out, err = exec.Command("lsof", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN").CombinedOutput()
		}
		s := strings.TrimSpace(string(out))
		if err != nil || s == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf(":%d → %s", port, firstLine(s)))
	}
	return strings.Join(parts, "；")
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i]
	}
	return s
}
