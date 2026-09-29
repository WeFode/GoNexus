package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gogf/gf/v2/os/gctx"

	"deploy-agent/internal/dockerx"
	"deploy-agent/internal/hostmetrics"
)

const version = "0.3.0"

type job struct {
	Id            int64  `json:"id"`
	Action        string `json:"action"`
	ServiceName   string `json:"serviceName"`
	ImageName     string `json:"imageName"`
	ArtifactId    int64  `json:"artifactId"`
	ContainerName string `json:"containerName"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	DockerNetwork string `json:"dockerNetwork"`
	LoopbackAs    string `json:"loopbackAs"`
	EtcdHost      string `json:"etcdHost"`
}

func main() {
	ctx := gctx.GetInitCtx()
	if err := run(ctx); err != nil {
		g.Log().Fatal(ctx, err)
	}
}

func run(ctx context.Context) error {
	interval := g.Cfg().MustGet(ctx, "agent.interval", "10s").Duration()
	if interval <= 0 {
		interval = 10 * time.Second
	}
	g.Log().Infof(ctx, "deploy-agent %s node=%s server=%s",
		version,
		g.Cfg().MustGet(ctx, "agent.nodeId").String(),
		g.Cfg().MustGet(ctx, "agent.server").String())
	for {
		if err := tick(ctx); err != nil {
			g.Log().Warningf(ctx, "heartbeat: %v", err)
		}
		time.Sleep(interval)
	}
}

func tick(ctx context.Context) error {
	ncpu, mem, osName, arch, platform, err := dockerx.Info()
	if err != nil {
		return fmt.Errorf("docker info: %w", err)
	}
	containers, err := dockerx.ListContainers()
	if err != nil {
		return fmt.Errorf("docker ps: %w", err)
	}
	running := make([]string, 0, len(containers))
	for _, c := range containers {
		if strings.Contains(strings.ToLower(c.Status), "up") {
			running = append(running, c.Name)
		}
	}
	if stats, serr := dockerx.Stats(running); serr == nil {
		for i, c := range containers {
			if st, ok := stats[c.Name]; ok {
				containers[i].CPUPerc = st.CPUPerc
				containers[i].MemUsage = st.MemUsage
				containers[i].MemPerc = st.MemPerc
			}
		}
	}
	cpuUsed, memUsed, memSource := hostmetrics.Collect(mem)
	if cpus, limit, used, cpuPct, qok := hostmetrics.Quota(); qok {
		if cpus > 0 && (ncpu == 0 || cpus < ncpu) {
			ncpu = cpus
		}
		if limit > 0 && (mem == 0 || limit < mem) {
			mem = limit
		}
		if used >= 0 {
			memUsed = used
			memSource = "host"
		}
		if cpuPct >= 0 {
			cpuUsed = cpuPct
		}
	}
	if memUsed < 0 {
		if used, uerr := dockerx.MemoryUsedBytes(); uerr == nil {
			memUsed = used
			memSource = "containers"
		}
	}
	hostPorts, perr := dockerx.PublishedHostPorts()
	if perr != nil {
		g.Log().Warningf(ctx, "host ports: %v", perr)
		hostPorts = []int{}
	}
	if hostPorts == nil {
		hostPorts = []int{}
	}
	body := g.Map{
		"nodeId":         g.Cfg().MustGet(ctx, "agent.nodeId").String(),
		"hostname":       hostname(),
		"os":             osName,
		"arch":           arch,
		"dockerPlatform": platform,
		"dockerNetwork":  g.Cfg().MustGet(ctx, "agent.dockerNetwork").String(),
		"loopbackAs":     g.Cfg().MustGet(ctx, "agent.loopbackAs", "host.docker.internal").String(),
		"ncpu":           ncpu,
		"memoryBytes":    mem,
		"agentVersion":   version,
		"containers":     containers,
		"metrics": g.Map{
			"cpuUsedPercent":  cpuUsed,
			"memoryUsedBytes": memUsed,
			"memorySource":    memSource,
			"hostPorts":       hostPorts,
		},
	}
	var hb struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Jobs []job `json:"jobs"`
		} `json:"data"`
	}
	if err = api(ctx, http.MethodPost, "/api/v1/agent/heartbeat", body, &hb); err != nil {
		return err
	}
	if hb.Code != 0 {
		return fmt.Errorf("heartbeat: %s", hb.Message)
	}
	g.Log().Debugf(ctx, "heartbeat ok jobs=%d", len(hb.Data.Jobs))
	for _, j := range hb.Data.Jobs {
		if err = handleJob(ctx, j); err != nil {
			g.Log().Warningf(ctx, "job %d failed: %v", j.Id, err)
			_ = report(ctx, j.Id, "failed", err.Error())
		}
	}
	return nil
}

func handleJob(ctx context.Context, j job) error {
	g.Log().Infof(ctx, "执行任务 #%d %s %s", j.Id, j.Action, j.ServiceName)
	_ = report(ctx, j.Id, "running", "")
	name := j.ContainerName
	if name == "" {
		name = "cc-" + j.ServiceName
	}
	switch j.Action {
	case "stop":
		if err := dockerx.Stop(name); err != nil {
			return err
		}
		return report(ctx, j.Id, "success", "stopped "+name)
	case "start":
		if err := dockerx.Start(name); err != nil {
			return err
		}
		return report(ctx, j.Id, "success", "started "+name)
	case "restart":
		if err := dockerx.Restart(name); err != nil {
			return err
		}
		return report(ctx, j.Id, "success", "restarted "+name)
	case "stop-canary":
		_ = dockerx.Remove(name)
		return report(ctx, j.Id, "success", "removed "+name)
	case "deploy", "rollback", "canary":
		return deployImage(ctx, j, name)
	default:
		return fmt.Errorf("未知动作 %s", j.Action)
	}
}

func deployImage(ctx context.Context, j job, containerName string) error {
	if j.ArtifactId <= 0 {
		return fmt.Errorf("产物 ID 无效")
	}
	tarPath, err := downloadArtifact(ctx, j.ArtifactId)
	if err != nil {
		return err
	}
	defer os.Remove(tarPath)
	if err = dockerx.Load(tarPath); err != nil {
		return err
	}
	_ = dockerx.Remove(containerName)
	work := filepath.Join("data", "instances", j.ServiceName)
	if j.Action == "canary" {
		work = filepath.Join("data", "instances", j.ServiceName+"-canary")
	}
	cfgDir := filepath.Join(work, "config")
	dataDir := filepath.Join(work, "cache")
	if err = os.MkdirAll(cfgDir, 0o755); err != nil {
		return err
	}
	if err = os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	loop := j.LoopbackAs
	if loop == "" {
		loop = "host.docker.internal"
	}
	cfg := fmt.Sprintf("svc:\n  etcd:\n    host: %q\n    watch: true\n    snapshotDir: data/config-cache\n    loopbackAs: %q\n",
		j.EtcdHost, loop)
	cfgPath := filepath.Join(cfgDir, "config.yaml")
	if err = os.WriteFile(cfgPath, []byte(cfg), 0o644); err != nil {
		return err
	}
	absCfg, _ := filepath.Abs(cfgPath)
	absData, _ := filepath.Abs(dataDir)
	port := j.ContainerPort
	if port <= 0 {
		port = 8000
	}
	hostPort := j.HostPort
	if hostPort <= 0 {
		hostPort = port
	}
	netName := j.DockerNetwork
	if netName == "" {
		netName = g.Cfg().MustGet(ctx, "agent.dockerNetwork").String()
	}
	if err = dockerx.RunDetached(containerName, j.ImageName, netName, hostPort, port, absCfg, absData); err != nil {
		return err
	}
	return report(ctx, j.Id, "success", "started "+containerName)
}

func downloadArtifact(ctx context.Context, id int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL()+"/api/v1/agent/artifacts/"+fmt.Sprintf("%d", id)+"/file", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Agent-Token", token())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return "", fmt.Errorf("download artifact %d: %s %s", id, res.Status, string(b))
	}
	f, err := os.CreateTemp("", "artifact-*.tar")
	if err != nil {
		return "", err
	}
	_, err = io.Copy(f, res.Body)
	cerr := f.Close()
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	if cerr != nil {
		_ = os.Remove(f.Name())
		return "", cerr
	}
	return f.Name(), nil
}

func report(ctx context.Context, id int64, status, message string) error {
	var out struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	err := api(ctx, http.MethodPost, fmt.Sprintf("/api/v1/agent/jobs/%d/report", id), g.Map{
		"status":  status,
		"message": message,
	}, &out)
	if err != nil {
		return err
	}
	if out.Code != 0 {
		return fmt.Errorf(out.Message)
	}
	return nil
}

func api(ctx context.Context, method, path string, body any, dest any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, serverURL()+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Token", token())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return json.NewDecoder(res.Body).Decode(dest)
}

func serverURL() string {
	return g.Cfg().MustGet(context.Background(), "agent.server", "http://127.0.0.1:9000").String()
}

func token() string {
	return g.Cfg().MustGet(context.Background(), "agent.token").String()
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}

func init() {
	_ = gcfg.Instance()
}
