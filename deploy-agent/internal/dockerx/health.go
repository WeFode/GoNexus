package dockerx

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// InspectImage 返回容器当前使用的镜像名；容器不存在时返回空串。
func InspectImage(name string) (string, error) {
	out, err := Run("inspect", "-f", "{{.Config.Image}}", name)
	if err != nil {
		// docker inspect 对不存在容器返回非零，视为无旧版本
		if strings.Contains(strings.ToLower(out), "no such object") {
			return "", nil
		}
		return "", fmt.Errorf("docker inspect %s: %w", name, err)
	}
	return strings.TrimSpace(out), nil
}

// probeOnce 对宿主机端口做一次健康探测：
// 先 TCP 拨通，再可选探测 HTTP 健康路径。两者皆通过才算健康。
func probeOnce(hostPort int, healthPath string, timeout time.Duration) error {
	addr := fmt.Sprintf("127.0.0.1:%d", hostPort)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return fmt.Errorf("tcp %s: %w", addr, err)
	}
	_ = conn.Close()
	if healthPath == "" {
		return nil
	}
	client := &http.Client{Timeout: timeout}
	url := fmt.Sprintf("http://127.0.0.1:%d%s", hostPort, healthPath)
	res, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("http %s: %w", url, err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode >= 200 && res.StatusCode < 500 {
		return nil
	}
	return fmt.Errorf("http %s: status %d", url, res.StatusCode)
}

// WaitHealthy 轮询容器映射到宿主机 hostPort 的端口直到健康或超时。
// 仅 TCP 通（healthPath 为空）算基础健康；healthPath 非空则要求 HTTP 也返回 <500。
func WaitHealthy(hostPort int, healthPath string, timeout, interval time.Duration) error {
	if hostPort <= 0 {
		return fmt.Errorf("无效端口 %d", hostPort)
	}
	if interval <= 0 {
		interval = 2 * time.Second
	}
	if healthPath != "" && !strings.HasPrefix(healthPath, "/") {
		healthPath = "/" + healthPath
	}
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		probeTimeout := 3 * time.Second
		if probeTimeout > interval {
			probeTimeout = interval
		}
		if err := probeOnce(hostPort, healthPath, probeTimeout); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(interval)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("timeout after %s", timeout)
	}
	return fmt.Errorf("%w (waited %s)", lastErr, timeout)
}
