package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gogf/gf/v2/os/gctx"

	"deploy-agent/internal/dockerx"
	"deploy-agent/internal/hostmetrics"
)

const version = "0.4.0"

// 与服务端 UploadArtifact 的校验保持一致；服务名会拼进容器名和实例目录。
var serviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// 心跳/上报要快，下载 tar 可能很大，分开设超时，避免服务端卡住把主循环挂死。
var (
	apiClient      = &http.Client{Timeout: 30 * time.Second}
	downloadClient = &http.Client{Timeout: 30 * time.Minute}
)

// keepAlive 在长任务执行期间定期上报 running，刷新 deploy_jobs.updated_at，
// 避免服务端按 jobTimeout 把仍在执行的任务回收成 failed。
func keepAlive(ctx context.Context, id int64) func() {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if err := report(ctx, id, "running", ""); err != nil {
					g.Log().Debugf(ctx, "任务 #%d 保活上报失败: %v", id, err)
				}
				// 长任务期间主循环阻塞，单独续一下节点 last_seen，避免节点页显示离线。
				var hb struct {
					Code    int    `json:"code"`
					Message string `json:"message"`
				}
				if err := api(ctx, http.MethodPost, "/api/v1/agent/heartbeat", g.Map{
					"nodeId":    g.Cfg().MustGet(ctx, "agent.nodeId").String(),
					"keepalive": true,
				}, &hb); err != nil {
					g.Log().Debugf(ctx, "任务 #%d 保活心跳失败: %v", id, err)
				}
			}
		}
	}()
	return func() { close(done) }
}

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
		return reportSuccess(ctx, j.Id, "stopped "+name)
	case "start":
		if err := dockerx.Start(name); err != nil {
			return err
		}
		return reportSuccess(ctx, j.Id, "started "+name)
	case "restart":
		if err := dockerx.Restart(name); err != nil {
			return err
		}
		return reportSuccess(ctx, j.Id, "restarted "+name)
	case "stop-canary":
		_ = dockerx.Remove(name)
		return reportSuccess(ctx, j.Id, "removed "+name)
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
	if !serviceNamePattern.MatchString(j.ServiceName) {
		return fmt.Errorf("非法服务名 %q", j.ServiceName)
	}
	healthTimeout := g.Cfg().MustGet(ctx, "agent.healthTimeout", "90s").Duration()
	if healthTimeout <= 0 {
		healthTimeout = 90 * time.Second
	}
	healthPath := g.Cfg().MustGet(ctx, "agent.healthPath", "/api/v1/health").String()
	healthInterval := g.Cfg().MustGet(ctx, "agent.healthInterval", "2s").Duration()
	if healthInterval <= 0 {
		healthInterval = 2 * time.Second
	}

	// 1. 记录旧容器的镜像 ID（不可变摘要，不是 tag），发布失败时用于自动回滚
	prevImage, _ := dockerx.InspectImage(containerName)
	if prevImage != "" {
		g.Log().Infof(ctx, "任务 #%d: 记录旧版本 %s = %s（失败时自动回滚）", j.Id, containerName, prevImage)
	}
	// 下载/加载/健康探测可能远超服务端的 jobTimeout，定期上报 running 续租。
	stopKeepAlive := keepAlive(ctx, j.Id)
	defer stopKeepAlive()

	tarPath, err := downloadArtifact(ctx, j.ArtifactId)
	if err != nil {
		return err
	}
	defer os.Remove(tarPath)
	if err = dockerx.Load(tarPath); err != nil {
		return err
	}
	if err = dockerx.Remove(containerName); err != nil {
		return fmt.Errorf("清理旧容器失败: %w", err)
	}
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
		// 旧容器已删除，启动失败必须尝试恢复旧镜像，否则服务直接中断。
		_ = dockerx.Remove(containerName)
		if prevImage != "" {
			if rerr := dockerx.RunDetached(containerName, prevImage, netName, hostPort, port, absCfg, absData); rerr != nil {
				return fmt.Errorf("start failed: %v; auto rollback also failed: %v (旧镜像 %s)", err, rerr, prevImage)
			}
			return fmt.Errorf("start failed: %v; auto rolled back to previous image %s (端口 %d 已恢复)", err, prevImage, hostPort)
		}
		return fmt.Errorf("start failed: %v (首次部署，无旧版本可回滚)", err)
	}

	// 2. 健康探测：TCP + HTTP(/api/v1/health)
	if j.Action == "canary" {
		// 旁路灰度不阻断主服务，探测结果仅写入任务说明
		if herr := dockerx.WaitHealthy(hostPort, healthPath, healthTimeout, healthInterval); herr != nil {
			return fmt.Errorf("canary 健康检查未通过: %v（旁路容器保留，不影响主容器）", herr)
		}
		return reportSuccess(ctx, j.Id, fmt.Sprintf("started %s (health ok, port %d)", containerName, hostPort))
	}

	if herr := dockerx.WaitHealthy(hostPort, healthPath, healthTimeout, healthInterval); herr != nil {
		// 3. 健康失败 → 自动回滚旧镜像（首次部署无旧版本则清理失败容器）
		g.Log().Warningf(ctx, "任务 #%d: 健康检查失败: %v，开始自动回滚", j.Id, herr)
		_ = dockerx.Remove(containerName)
		if prevImage != "" {
			if rerr := dockerx.RunDetached(containerName, prevImage, netName, hostPort, port, absCfg, absData); rerr != nil {
				return fmt.Errorf("health check failed: %v; auto rollback also failed: %v (旧镜像 %s)", herr, rerr, prevImage)
			}
			if herr2 := dockerx.WaitHealthy(hostPort, healthPath, 20*time.Second, healthInterval); herr2 != nil {
				return fmt.Errorf("health check failed: %v; rolled back to %s but it is also unhealthy: %v", herr, prevImage, herr2)
			}
			return fmt.Errorf("health check failed: %v; auto rolled back to previous image %s (端口 %d 已恢复)", herr, prevImage, hostPort)
		}
		return fmt.Errorf("health check failed: %v; no previous version to roll back (首次部署，失败容器已清理)", herr)
	}
	return reportSuccess(ctx, j.Id, fmt.Sprintf("started %s (health ok, port %d)", containerName, hostPort))
}

func downloadArtifact(ctx context.Context, id int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL()+"/api/v1/agent/artifacts/"+fmt.Sprintf("%d", id)+"/file", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Agent-Token", token())
	res, err := downloadClient.Do(req)
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
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), res.Body)
	cerr := f.Close()
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	if cerr != nil {
		_ = os.Remove(f.Name())
		return "", cerr
	}
	if want := strings.TrimSpace(res.Header.Get("X-Artifact-Sha256")); want != "" {
		got := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(want, got) {
			_ = os.Remove(f.Name())
			return "", fmt.Errorf("artifact %d sha256 校验失败: 期望 %s，实际 %s", id, want, got)
		}
	}
	return f.Name(), nil
}

func report(ctx context.Context, id int64, status, message string) error {
	var lastErr error
	// 上报可能因网络闪断失败；重试几次，避免已成功执行的任务在服务端卡到超时。
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
		var out struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		err := api(ctx, http.MethodPost, fmt.Sprintf("/api/v1/agent/jobs/%d/report", id), g.Map{
			"nodeId":  g.Cfg().MustGet(ctx, "agent.nodeId").String(),
			"status":  status,
			"message": message,
		}, &out)
		if err != nil {
			lastErr = err
			continue
		}
		if out.Code != 0 {
			lastErr = fmt.Errorf("%s", out.Message)
			continue
		}
		return nil
	}
	return lastErr
}

// reportSuccess 用于“任务已经执行成功”的上报。上报失败不能再让调用方返回错误，
// 否则 tick 会把它当成执行失败并上报 failed，把成功任务误标成失败。
func reportSuccess(ctx context.Context, id int64, message string) error {
	if err := report(ctx, id, "success", message); err != nil {
		g.Log().Warningf(ctx, "任务 #%d 执行成功但上报失败（服务端将按超时回收）: %v", id, err)
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
	res, err := apiClient.Do(req)
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
