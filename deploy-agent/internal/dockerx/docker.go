package dockerx

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func Run(args ...string) (string, error) {
	cmd := exec.Command("docker", args...)
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s != "" {
			return s, fmt.Errorf("%s: %s", err, s)
		}
		return s, err
	}
	return s, nil
}

type Container struct {
	Name     string `json:"name"`
	Image    string `json:"image"`
	Status   string `json:"status"`
	Ports    string `json:"ports"`
	CPUPerc  string `json:"cpuPerc"`
	MemUsage string `json:"memUsage"`
	MemPerc  string `json:"memPerc"`
}

func Info() (ncpu int, memory int64, osName, arch, platform string, err error) {
	osName = runtime.GOOS
	arch = runtime.GOARCH
	nStr, err := Run("info", "--format", "{{.NCPU}}")
	if err != nil {
		return 0, 0, osName, arch, "", err
	}
	mStr, err := Run("info", "--format", "{{.MemTotal}}")
	if err != nil {
		return 0, 0, osName, arch, "", err
	}
	fmt.Sscanf(nStr, "%d", &ncpu)
	fmt.Sscanf(mStr, "%d", &memory)
	osType, _ := Run("info", "--format", "{{.OSType}}")
	osArch, _ := Run("info", "--format", "{{.Architecture}}")
	if osType == "" {
		osType = "linux"
	}
	if osArch == "" {
		osArch = "amd64"
	}
	platform = osType + "/" + strings.TrimPrefix(osArch, "x86_64")
	if strings.Contains(osArch, "x86_64") || osArch == "amd64" {
		platform = osType + "/amd64"
	}
	if strings.Contains(osArch, "aarch64") || osArch == "arm64" {
		platform = osType + "/arm64"
	}
	return ncpu, memory, osName, arch, platform, nil
}

func ListContainers() ([]Container, error) {
	out, err := Run("ps", "-a", "--filter", "name=cc-", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}")
	if err != nil {
		return nil, err
	}
	var list []Container
	if out == "" {
		return list, nil
	}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 3 {
			continue
		}
		if !strings.HasPrefix(parts[0], "cc-") {
			continue
		}
		c := Container{Name: parts[0], Image: parts[1], Status: parts[2]}
		if len(parts) > 3 {
			c.Ports = parts[3]
		}
		list = append(list, c)
	}
	return list, nil
}

func Load(tarPath string) error {
	_, err := Run("load", "-i", tarPath)
	return err
}

func Stop(name string) error {
	_, err := Run("stop", name)
	return err
}

func Start(name string) error {
	_, err := Run("start", name)
	return wrapBindError(name, nil, err)
}

func Restart(name string) error {
	_, err := Run("restart", name)
	return wrapBindError(name, nil, err)
}

func Stats(names []string) (map[string]Container, error) {
	out := map[string]Container{}
	if len(names) == 0 {
		return out, nil
	}
	args := append([]string{"stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"}, names...)
	s, err := Run(args...)
	if err != nil {
		return out, err
	}
	if s == "" {
		return out, nil
	}
	for _, line := range strings.Split(s, "\n") {
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		out[parts[0]] = Container{
			Name:     parts[0],
			CPUPerc:  parts[1],
			MemUsage: parts[2],
			MemPerc:  parts[3],
		}
	}
	return out, nil
}

// Remove 删除容器。容器本来就不存在时视为成功，其它错误必须上抛，
// 否则同名容器残留会让后续 docker run 失败，而日志只看到 run 报错。
func Remove(name string) error {
	_, err := Run("rm", "-f", name)
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "no such container") {
		return nil
	}
	return err
}

func RunDetached(name, image, network string, hostPort, containerPort int, configPath, dataDir string) error {
	args := []string{
		"run", "-d",
		"--name", name,
		"--restart", "unless-stopped",
		"--add-host", "host.docker.internal:host-gateway",
		"-e", "TZ=Asia/Shanghai",
		"-p", fmt.Sprintf("%d:%d", hostPort, containerPort),
		"-v", dataDir + ":/app/data/config-cache",
		"-v", configPath + ":/app/manifest/config/config.yaml:ro",
	}
	if _, err := os.Stat("/etc/ssl/certs"); err == nil {
		args = append(args, "-v", "/etc/ssl/certs:/etc/ssl/certs:ro")
	}
	if network != "" {
		args = append(args, "--network", network)
	}
	args = append(args, image)
	_, err := Run(args...)
	return wrapBindError(name, []int{hostPort}, err)
}
