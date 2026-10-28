package deploy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"

	v1 "configure-server/api/deploy/v1"
	obsv "configure-server/internal/observability"
	"configure-server/internal/service"
)

type sDeploy struct{}

func init() {
	service.RegisterDeploy(New())
}

func New() *sDeploy {
	return &sDeploy{}
}

// 服务名会拼进 tar 文件名、实例目录和容器名，必须限制字符集；
// 镜像名/平台会直接传给 docker CLI，同样做白名单校验。
var (
	serviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	imageNamePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$`)
	platformPattern    = regexp.MustCompile(`^[a-z0-9]+/[a-z0-9]+$`)
)

func validateArtifact(meta *v1.ArtifactItem) error {
	meta.ServiceName = strings.TrimSpace(meta.ServiceName)
	meta.ImageName = strings.TrimSpace(meta.ImageName)
	meta.Platform = strings.TrimSpace(meta.Platform)
	if !serviceNamePattern.MatchString(meta.ServiceName) {
		return gerror.New("serviceName 只能包含字母、数字、点、下划线、短横线，且不超过 64 字符")
	}
	if !imageNamePattern.MatchString(meta.ImageName) {
		return gerror.New("imageName 格式不合法")
	}
	if !platformPattern.MatchString(meta.Platform) {
		return gerror.New("platform 格式不合法，应形如 linux/amd64")
	}
	if meta.ContainerPort <= 0 || meta.ContainerPort > 65535 {
		return gerror.New("containerPort 必须在 1-65535 之间")
	}
	return nil
}

func artifactDir() string {
	dir := g.Cfg().MustGet(context.Background(), "deploy.artifactDir").String()
	if dir == "" {
		dir = "data/artifacts"
	}
	return dir
}

func (s *sDeploy) Heartbeat(ctx context.Context, in *v1.HeartbeatReq) ([]v1.JobItem, error) {
	if in.Keepalive {
		// 长任务执行期间 Agent 只续在线时间，不覆盖容器/指标，也不领取新任务。
		if _, err := g.DB().Model("deploy_nodes").Where("node_id", in.NodeId).
			Data(g.Map{"last_seen": gtime.Now()}).Update(); err != nil {
			return nil, err
		}
		return []v1.JobItem{}, nil
	}
	_ = s.reclaimStaleJobs(ctx)
	managed := make([]v1.ContainerInfo, 0, len(in.Containers))
	for _, c := range in.Containers {
		if strings.HasPrefix(c.Name, "cc-") {
			managed = append(managed, c)
		}
	}
	raw, _ := json.Marshal(managed)
	cpuUsed, memUsed, memSource, hostPorts := metricsOf(in)
	now := gtime.Now()
	data := g.Map{
		"node_id":           in.NodeId,
		"hostname":          in.Hostname,
		"os":                in.OS,
		"arch":              in.Arch,
		"docker_platform":   in.DockerPlatform,
		"docker_network":    in.DockerNetwork,
		"loopback_as":       in.LoopbackAs,
		"ncpu":              in.Ncpu,
		"memory_bytes":      in.MemoryBytes,
		"cpu_used_percent":  cpuUsed,
		"memory_used_bytes": memUsed,
		"memory_source":     memSource,
		"host_ports":        hostPorts,
		"agent_version":     in.AgentVersion,
		"containers":        string(raw),
		"last_seen":         now,
	}
	n, err := g.DB().Model("deploy_nodes").Where("node_id", in.NodeId).Count()
	if err != nil {
		return nil, err
	}
	var prevLastSeen *gtime.Time
	if n == 0 {
		if _, err = g.DB().Model("deploy_nodes").Data(data).Insert(); err != nil {
			return nil, err
		}
	} else {
		var prev struct {
			LastSeen *gtime.Time `orm:"last_seen"`
		}
		if serr := g.DB().Model("deploy_nodes").Fields("last_seen").Where("node_id", in.NodeId).Scan(&prev); serr == nil {
			prevLastSeen = prev.LastSeen
		}
		if _, err = g.DB().Model("deploy_nodes").Where("node_id", in.NodeId).Data(data).Update(); err != nil {
			return nil, err
		}
	}

	hostname := in.Hostname
	if hostname == "" {
		hostname = in.NodeId
	}
	if n == 0 {
		obsv.Emit(obsv.Entry{
			Source: obsv.SourceAgent, Action: "node-online", NodeId: in.NodeId,
			Message: fmt.Sprintf("探针接入：%s（%s/%s，%d 核）", hostname, in.OS, in.Arch, in.Ncpu),
		})
	} else if prevLastSeen == nil || time.Since(prevLastSeen.Time) > 45*time.Second {
		offline := ""
		if prevLastSeen != nil {
			offline = time.Since(prevLastSeen.Time).Round(time.Second).String()
		}
		obsv.Emit(obsv.Entry{
			Source: obsv.SourceAgent, Action: "node-online", NodeId: in.NodeId,
			Message: fmt.Sprintf("探针恢复在线：%s（离线 %s）", hostname, offline),
		})
	}

	busy, err := g.DB().Model("deploy_jobs").Where("node_id", in.NodeId).Where("status", "running").Count()
	if err != nil {
		return nil, err
	}
	if busy > 0 {
		return []v1.JobItem{}, nil
	}

	var rows []jobRow
	err = g.DB().Model("deploy_jobs").
		Where("node_id", in.NodeId).
		Where("status", "pending").
		OrderAsc("id").
		Limit(1).
		Scan(&rows)
	if err != nil {
		return nil, err
	}
	jobs := make([]v1.JobItem, 0, len(rows))
	for _, row := range rows {
		// 原子认领：只有把 pending 真正改成 running 的那次心跳才能下发任务，
		// 避免两个同 nodeId 的 Agent（或上报失败后的重试）重复执行同一个任务。
		res, uerr := g.DB().Model("deploy_jobs").
			Where("id", row.Id).
			Where("status", "pending").
			Data(g.Map{"status": "running", "updated_at": gtime.Now()}).
			Update()
		if uerr != nil {
			return nil, uerr
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		item, jerr := s.toAgentJob(ctx, row)
		if jerr != nil {
			_, _ = g.DB().Model("deploy_jobs").Where("id", row.Id).Data(g.Map{
				"status": "failed", "message": jerr.Error(), "updated_at": gtime.Now(),
			}).Update()
			obsv.Emit(obsv.Entry{
				Level: obsv.LevelWarn, Source: obsv.SourceDeploy, Action: "job-failed",
				NodeId: in.NodeId, JobId: row.Id,
				Message: fmt.Sprintf("任务 #%d 无法下发：%v", row.Id, jerr),
			})
			continue
		}
		jobs = append(jobs, item)
	}
	return jobs, nil
}

func (s *sDeploy) toAgentJob(ctx context.Context, row jobRow) (v1.JobItem, error) {
	item := v1.JobItem{
		Id:            row.Id,
		Action:        row.Action,
		ServiceName:   row.ServiceName,
		ImageName:     row.ImageName,
		ArtifactId:    row.ArtifactId,
		ContainerName: containerName(row.Action, row.ServiceName),
		HostPort:      row.HostPort,
		DockerNetwork: row.DockerNetwork,
		LoopbackAs:    row.LoopbackAs,
	}
	if row.ArtifactId > 0 {
		art, err := s.artifactByID(ctx, row.ArtifactId)
		if err != nil {
			return v1.JobItem{}, gerror.Wrapf(err, "任务 #%d 的产物不可用", row.Id)
		}
		item.ContainerPort = art.ContainerPort
		if item.ImageName == "" {
			item.ImageName = art.ImageName
		}
	}
	if item.LoopbackAs == "" {
		item.LoopbackAs = "host.docker.internal"
	}
	item.EtcdHost = item.LoopbackAs + ":2379@" + row.ServiceName
	return item, nil
}

func containerName(action, serviceName string) string {
	if action == "canary" || action == "stop-canary" {
		return "cc-" + serviceName + "-canary"
	}
	return "cc-" + serviceName
}

type jobRow struct {
	Id            int64       `orm:"id"`
	NodeId        string      `orm:"node_id"`
	ArtifactId    int64       `orm:"artifact_id"`
	ServiceName   string      `orm:"service_name"`
	Action        string      `orm:"action"`
	Status        string      `orm:"status"`
	ImageName     string      `orm:"image_name"`
	HostPort      int         `orm:"host_port"`
	DockerNetwork string      `orm:"docker_network"`
	LoopbackAs    string      `orm:"loopback_as"`
	Message       string      `orm:"message"`
	Operator      string      `orm:"operator"`
	CreatedAt     *gtime.Time `orm:"created_at"`
	UpdatedAt     *gtime.Time `orm:"updated_at"`
}

type artifactRow struct {
	Id            int64       `orm:"id"`
	ServiceName   string      `orm:"service_name"`
	ImageName     string      `orm:"image_name"`
	Platform      string      `orm:"platform"`
	ContainerPort int         `orm:"container_port"`
	FilePath      string      `orm:"file_path"`
	FileSize      int64       `orm:"file_size"`
	Sha256        string      `orm:"sha256"`
	Operator      string      `orm:"operator"`
	CreatedAt     *gtime.Time `orm:"created_at"`
}

type nodeRow struct {
	NodeId          string      `orm:"node_id"`
	Hostname        string      `orm:"hostname"`
	OS              string      `orm:"os"`
	Arch            string      `orm:"arch"`
	DockerPlatform  string      `orm:"docker_platform"`
	DockerNetwork   string      `orm:"docker_network"`
	LoopbackAs      string      `orm:"loopback_as"`
	Ncpu            int         `orm:"ncpu"`
	MemoryBytes     int64       `orm:"memory_bytes"`
	CpuUsedPercent  float64     `orm:"cpu_used_percent"`
	MemoryUsedBytes int64       `orm:"memory_used_bytes"`
	MemorySource    string      `orm:"memory_source"`
	HostPorts       string      `orm:"host_ports"`
	AgentVersion    string      `orm:"agent_version"`
	Containers      string      `orm:"containers"`
	LastSeen        *gtime.Time `orm:"last_seen"`
}

func (s *sDeploy) artifactByID(ctx context.Context, id int64) (*artifactRow, error) {
	var row artifactRow
	err := g.DB().Model("deploy_artifacts").Where("id", id).Scan(&row)
	if err != nil {
		return nil, err
	}
	if row.Id == 0 {
		return nil, gerror.Newf("产物不存在: %d", id)
	}
	return &row, nil
}

func jobTimeout() time.Duration {
	d := g.Cfg().MustGet(context.Background(), "deploy.jobTimeout", "10m").Duration()
	if d <= 0 {
		return 10 * time.Minute
	}
	return d
}

func (s *sDeploy) reclaimStaleJobs(ctx context.Context) error {
	cutoff := gtime.Now().Add(-jobTimeout())
	res, err := g.DB().Model("deploy_jobs").
		Where("status", "running").
		Where("updated_at < ?", cutoff).
		Data(g.Map{
			"status":     "failed",
			"message":    "任务超时（Agent 可能已中断，请检查节点后重试）",
			"updated_at": gtime.Now(),
		}).Update()
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		obsv.Emit(obsv.Entry{
			Level: obsv.LevelWarn, Source: obsv.SourceDeploy, Action: "job-timeout",
			Message: fmt.Sprintf("回收超时任务 %d 个（运行超过 %s）", n, jobTimeout()),
		})
	}
	return nil
}

func (s *sDeploy) ReportJob(ctx context.Context, id int64, nodeId, status, message string) error {
	var row struct {
		NodeId      string `orm:"node_id"`
		ServiceName string `orm:"service_name"`
		Action      string `orm:"action"`
		Status      string `orm:"status"`
	}
	if err := g.DB().Model("deploy_jobs").
		Fields("node_id,service_name,action,status").
		Where("id", id).
		Scan(&row); err != nil {
		return err
	}
	if row.NodeId == "" {
		return gerror.Newf("任务不存在: %d", id)
	}
	nodeId = strings.TrimSpace(nodeId)
	if nodeId == "" || row.NodeId != nodeId {
		return gerror.Newf("任务 #%d 不属于节点 %q", id, nodeId)
	}
	// 终态幂等：超时回收或重复上报不再改写已有结果。
	if row.Status == "success" || row.Status == "failed" {
		return nil
	}
	data := g.Map{
		"status":     status,
		"updated_at": gtime.Now(),
	}
	// 空的 message 用于保活/开始执行，不能把发布备注覆盖成空。
	if message != "" {
		data["message"] = message
	}
	if _, err := g.DB().Model("deploy_jobs").Where("id", id).Data(data).Update(); err != nil {
		return err
	}
	level := obsv.LevelInfo
	statusText := status
	switch status {
	case "failed":
		level = obsv.LevelError
		statusText = "失败"
	case "success":
		statusText = "成功"
	case "running":
		statusText = "执行中"
	}
	text := fmt.Sprintf("任务 #%d %s %s %s", id, row.Action, row.ServiceName, statusText)
	if message != "" {
		text += "：" + message
	}
	obsv.Emit(obsv.Entry{
		Level: level, Source: obsv.SourceDeploy, Action: "job-" + status,
		NodeId: row.NodeId, JobId: id, Message: text,
	})
	return nil
}

func (s *sDeploy) ListNodes(ctx context.Context) ([]v1.NodeItem, error) {
	var rows []nodeRow
	err := g.DB().Model("deploy_nodes").OrderDesc("last_seen").Scan(&rows)
	if err != nil {
		return nil, err
	}
	out := make([]v1.NodeItem, 0, len(rows))
	for _, row := range rows {
		item := v1.NodeItem{
			NodeId:          row.NodeId,
			Hostname:        row.Hostname,
			OS:              row.OS,
			Arch:            row.Arch,
			DockerPlatform:  row.DockerPlatform,
			DockerNetwork:   row.DockerNetwork,
			LoopbackAs:      row.LoopbackAs,
			Ncpu:            row.Ncpu,
			MemoryBytes:     row.MemoryBytes,
			CpuUsedPercent:  row.CpuUsedPercent,
			MemoryUsedBytes: row.MemoryUsedBytes,
			MemorySource:    row.MemorySource,
			HostPorts:       decodeHostPorts(row.HostPorts),
			AgentVersion:    row.AgentVersion,
			Containers:      []v1.ContainerInfo{},
		}
		if row.LastSeen != nil {
			item.LastSeen = row.LastSeen.String()
			item.Online = time.Since(row.LastSeen.Time) < 45*time.Second
		}
		if row.Containers != "" {
			var all []v1.ContainerInfo
			_ = json.Unmarshal([]byte(row.Containers), &all)
			for _, c := range all {
				if strings.HasPrefix(c.Name, "cc-") {
					item.Containers = append(item.Containers, c)
				}
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *sDeploy) ListArtifacts(ctx context.Context, serviceName string) ([]v1.ArtifactItem, error) {
	m := g.DB().Model("deploy_artifacts").OrderDesc("id")
	if serviceName != "" {
		m = m.Where("service_name", serviceName)
	}
	var rows []artifactRow
	if err := m.Scan(&rows); err != nil {
		return nil, err
	}
	out := make([]v1.ArtifactItem, 0, len(rows))
	for _, row := range rows {
		out = append(out, toArtifactItem(row))
	}
	return out, nil
}

func toArtifactItem(row artifactRow) v1.ArtifactItem {
	item := v1.ArtifactItem{
		Id:            row.Id,
		ServiceName:   row.ServiceName,
		ImageName:     row.ImageName,
		Platform:      row.Platform,
		ContainerPort: row.ContainerPort,
		FileSize:      row.FileSize,
		Sha256:        row.Sha256,
		Operator:      row.Operator,
	}
	if row.CreatedAt != nil {
		item.CreatedAt = row.CreatedAt.String()
	}
	return item
}

func (s *sDeploy) SaveArtifact(ctx context.Context, meta v1.ArtifactItem, r io.Reader) (*v1.ArtifactItem, error) {
	if err := validateArtifact(&meta); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(artifactDir(), 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(artifactDir(), "up-*.tar")
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), r)
	cerr := tmp.Close()
	if err != nil {
		_ = os.Remove(tmp.Name())
		return nil, err
	}
	if cerr != nil {
		_ = os.Remove(tmp.Name())
		return nil, cerr
	}
	sum := hex.EncodeToString(h.Sum(nil))
	operator := meta.Operator
	if operator == "" {
		operator = "anonymous"
	}
	id, err := g.DB().Model("deploy_artifacts").Data(g.Map{
		"service_name":   meta.ServiceName,
		"image_name":     meta.ImageName,
		"platform":       meta.Platform,
		"container_port": meta.ContainerPort,
		"file_path":      tmp.Name(),
		"file_size":      n,
		"sha256":         sum,
		"operator":       operator,
	}).InsertAndGetId()
	if err != nil {
		_ = os.Remove(tmp.Name())
		return nil, err
	}
	final := filepath.Join(artifactDir(), fmt.Sprintf("%d-%s.tar", id, meta.ServiceName))
	if err = os.Rename(tmp.Name(), final); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, err
	}
	_, err = g.DB().Model("deploy_artifacts").Where("id", id).Data(g.Map{"file_path": final}).Update()
	if err != nil {
		return nil, err
	}
	row, err := s.artifactByID(ctx, id)
	if err != nil {
		return nil, err
	}
	item := toArtifactItem(*row)
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceDeploy, Action: "artifact-upload", User: operator,
		Message: fmt.Sprintf("上传产物 #%d %s（%s，%.1f MB）", id, meta.ServiceName, meta.Platform, float64(n)/1024/1024),
	})
	return &item, nil
}

func (s *sDeploy) CreateDeploy(ctx context.Context, in service.DeployRequest) ([]int64, error) {
	_ = s.reclaimStaleJobs(ctx)
	if len(in.NodeIds) == 0 {
		return nil, gerror.New("请选择至少一个节点")
	}
	art, err := s.artifactByID(ctx, in.ArtifactId)
	if err != nil {
		return nil, err
	}
	hostPort := in.HostPort
	if hostPort <= 0 {
		hostPort = art.ContainerPort
	}
	operator := in.Operator
	if operator == "" {
		operator = "anonymous"
	}
	strategy := strings.ToLower(strings.TrimSpace(in.Strategy))
	if strategy == "" {
		strategy = "canary"
	}
	if strategy != "canary" && strategy != "all" {
		return nil, gerror.New("strategy 只能是 canary 或 all")
	}
	canaryCount := in.CanaryCount
	if canaryCount <= 0 {
		canaryCount = 1
	}

	if in.CanaryHostPort > 0 {
		if len(in.NodeIds) != 1 {
			return nil, gerror.New("旁路灰度请只选一个节点")
		}
		if in.CanaryHostPort == hostPort {
			return nil, gerror.New("灰度端口不能与主端口相同")
		}
		id, err := s.insertNodeJob(ctx, in.NodeIds[0], art, "canary", "pending", in.CanaryHostPort, operator, in.Remark)
		if err != nil {
			return nil, err
		}
		return []int64{id}, nil
	}

	ids := make([]int64, 0, len(in.NodeIds))
	for i, nodeId := range in.NodeIds {
		status := "pending"
		if strategy == "canary" && i >= canaryCount {
			status = "waiting"
		}
		id, err := s.insertNodeJob(ctx, nodeId, art, "deploy", status, hostPort, operator, in.Remark)
		if err != nil {
			return ids, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *sDeploy) insertNodeJob(ctx context.Context, nodeId string, art *artifactRow, action, status string, hostPort int, operator, remark string) (int64, error) {
	node, err := s.nodeByID(ctx, nodeId)
	if err != nil {
		return 0, err
	}
	if node.LastSeen == nil || time.Since(node.LastSeen.Time) > 45*time.Second {
		return 0, gerror.Newf("节点 %s 离线，请先在该机器启动 deploy-agent", nodeId)
	}
	if !platformsMatch(art.Platform, node.DockerPlatform) {
		return 0, gerror.Newf("产物平台 %s 与节点 Docker %s 不一致，请重新打包", art.Platform, node.DockerPlatform)
	}
	pending, err := g.DB().Model("deploy_jobs").
		Where("node_id", nodeId).
		Where("service_name", art.ServiceName).
		WhereIn("status", []string{"pending", "running", "waiting"}).
		Count()
	if err != nil {
		return 0, err
	}
	if pending > 0 {
		return 0, gerror.Newf("节点 %s 上 %s 已有未完成的任务，请等待完成后再操作", nodeId, art.ServiceName)
	}
	id, err := g.DB().Model("deploy_jobs").Data(g.Map{
		"node_id":        nodeId,
		"artifact_id":    art.Id,
		"service_name":   art.ServiceName,
		"action":         action,
		"status":         status,
		"image_name":     art.ImageName,
		"host_port":      hostPort,
		"docker_network": node.DockerNetwork,
		"loopback_as":    node.LoopbackAs,
		"message":        remark,
		"operator":       operator,
		"updated_at":     gtime.Now(),
	}).InsertAndGetId()
	if err != nil {
		return 0, err
	}
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceDeploy, Action: "job-create", NodeId: nodeId, JobId: id, User: operator,
		Message: fmt.Sprintf("创建任务 #%d：%s %s（%s，端口 %d）", id, action, art.ServiceName, status, hostPort),
	})
	return id, nil
}

func (s *sDeploy) nodeByID(ctx context.Context, nodeId string) (*nodeRow, error) {
	var row nodeRow
	err := g.DB().Model("deploy_nodes").Where("node_id", nodeId).Scan(&row)
	if err != nil {
		return nil, err
	}
	if row.NodeId == "" {
		return nil, gerror.Newf("节点不存在或 Agent 尚未上报: %s", nodeId)
	}
	return &row, nil
}

func (s *sDeploy) Rollback(ctx context.Context, nodeId, serviceName, operator, remark string) (int64, error) {
	var rows []jobRow
	err := g.DB().Model("deploy_jobs").
		Where("node_id", nodeId).
		Where("service_name", serviceName).
		Where("action", "deploy").
		Where("status", "success").
		OrderDesc("id").
		Limit(2).
		Scan(&rows)
	if err != nil {
		return 0, err
	}
	if len(rows) < 2 {
		return 0, gerror.New("没有可回滚的上一成功版本")
	}
	prev := rows[1]
	if remark == "" {
		remark = fmt.Sprintf("回滚到产物 %d", prev.ArtifactId)
	}
	ids, err := s.CreateDeploy(ctx, service.DeployRequest{
		NodeIds:    []string{nodeId},
		ArtifactId: prev.ArtifactId,
		HostPort:   prev.HostPort,
		Operator:   operator,
		Remark:     remark,
		Strategy:   "all",
	})
	if err != nil {
		return 0, err
	}
	_, _ = g.DB().Model("deploy_jobs").Where("id", ids[0]).Data(g.Map{"action": "rollback"}).Update()
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceDeploy, Action: "rollback", NodeId: nodeId, JobId: ids[0], User: operator,
		Message: fmt.Sprintf("回滚 %s/%s 至产物 #%d（任务 #%d）", nodeId, serviceName, prev.ArtifactId, ids[0]),
	})
	return ids[0], nil
}

func (s *sDeploy) Promote(ctx context.Context, artifactId int64, operator, remark string) ([]int64, error) {
	if operator == "" {
		operator = "anonymous"
	}
	if remark == "" {
		remark = "推进灰度"
	}
	var waiting []jobRow
	err := g.DB().Model("deploy_jobs").
		Where("artifact_id", artifactId).
		Where("status", "waiting").
		OrderAsc("id").
		Scan(&waiting)
	if err != nil {
		return nil, err
	}
	if len(waiting) > 0 {
		ids := make([]int64, 0, len(waiting))
		for _, row := range waiting {
			ids = append(ids, row.Id)
		}
		_, err = g.DB().Model("deploy_jobs").WhereIn("id", ids).Data(g.Map{
			"status":     "pending",
			"message":    remark,
			"updated_at": gtime.Now(),
		}).Update()
		if err == nil {
			obsv.Emit(obsv.Entry{
				Source: obsv.SourceDeploy, Action: "promote", User: operator,
				Message: fmt.Sprintf("推进灰度：%d 个等待任务进入待执行（产物 #%d）", len(ids), artifactId),
			})
		}
		return ids, err
	}

	var canaries []jobRow
	err = g.DB().Model("deploy_jobs").
		Where("artifact_id", artifactId).
		Where("action", "canary").
		Where("status", "success").
		OrderDesc("id").
		Scan(&canaries)
	if err != nil {
		return nil, err
	}
	seen := map[string]jobRow{}
	for _, row := range canaries {
		if _, ok := seen[row.NodeId]; !ok {
			seen[row.NodeId] = row
		}
	}
	if len(seen) == 0 {
		return nil, gerror.New("没有可推进的灰度任务（无等待节点，也无成功的旁路灰度）")
	}

	ids := make([]int64, 0, len(seen)*2)
	for _, row := range seen {
		hostPort := 0
		var mains []jobRow
		_ = g.DB().Model("deploy_jobs").
			Where("node_id", row.NodeId).
			Where("service_name", row.ServiceName).
			Where("action", "deploy").
			Where("status", "success").
			OrderDesc("id").
			Limit(1).
			Scan(&mains)
		if len(mains) > 0 {
			hostPort = mains[0].HostPort
		}
		created, err := s.CreateDeploy(ctx, service.DeployRequest{
			NodeIds:    []string{row.NodeId},
			ArtifactId: artifactId,
			HostPort:   hostPort,
			Operator:   operator,
			Remark:     remark,
			Strategy:   "all",
		})
		if err != nil {
			return ids, err
		}
		ids = append(ids, created...)
		stopId, err := s.insertLifecycleJob(ctx, row.NodeId, row.ServiceName, "stop-canary", operator, "下线旁路灰度容器")
		if err != nil {
			return ids, err
		}
		ids = append(ids, stopId)
	}
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceDeploy, Action: "promote", User: operator,
		Message: fmt.Sprintf("推进旁路灰度：%d 个节点（产物 #%d）", len(seen), artifactId),
	})
	return ids, nil
}

func (s *sDeploy) CreateLifecycle(ctx context.Context, nodeId, serviceName, action, operator string) (int64, error) {
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "start" && action != "stop" && action != "restart" {
		return 0, gerror.New("action 必须是 start / stop / restart")
	}
	if operator == "" {
		operator = "anonymous"
	}
	return s.insertLifecycleJob(ctx, nodeId, serviceName, action, operator, "")
}

func (s *sDeploy) insertLifecycleJob(ctx context.Context, nodeId, serviceName, action, operator, remark string) (int64, error) {
	node, err := s.nodeByID(ctx, nodeId)
	if err != nil {
		return 0, err
	}
	if node.LastSeen == nil || time.Since(node.LastSeen.Time) > 45*time.Second {
		return 0, gerror.Newf("节点 %s 离线，请先在该机器启动 deploy-agent", nodeId)
	}
	want := containerName(action, serviceName)
	if action == "start" || action == "stop" || action == "restart" {
		found := false
		if node.Containers != "" {
			var all []v1.ContainerInfo
			_ = json.Unmarshal([]byte(node.Containers), &all)
			for _, c := range all {
				if c.Name == want {
					found = true
					break
				}
			}
		}
		if !found {
			return 0, gerror.Newf("节点 %s 上没有容器 %s，请先发布", nodeId, want)
		}
		pending, err := g.DB().Model("deploy_jobs").
			Where("node_id", nodeId).
			Where("service_name", serviceName).
			WhereIn("status", []string{"pending", "running", "waiting"}).
			Count()
		if err != nil {
			return 0, err
		}
		if pending > 0 {
			return 0, gerror.Newf("节点 %s 上 %s 已有未完成的任务，请等待完成后再操作", nodeId, serviceName)
		}
	}
	id, err := g.DB().Model("deploy_jobs").Data(g.Map{
		"node_id":        nodeId,
		"artifact_id":    0,
		"service_name":   serviceName,
		"action":         action,
		"status":         "pending",
		"image_name":     "",
		"host_port":      0,
		"docker_network": node.DockerNetwork,
		"loopback_as":    node.LoopbackAs,
		"message":        remark,
		"operator":       operator,
		"updated_at":     gtime.Now(),
	}).InsertAndGetId()
	if err != nil {
		return 0, err
	}
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceDeploy, Action: "job-create", NodeId: nodeId, JobId: id, User: operator,
		Message: fmt.Sprintf("创建任务 #%d：%s %s", id, action, serviceName),
	})
	return id, nil
}

func (s *sDeploy) ListJobs(ctx context.Context, nodeId string) ([]v1.DeployJobItem, error) {
	_ = s.reclaimStaleJobs(ctx)
	m := g.DB().Model("deploy_jobs").OrderDesc("id").Limit(100)
	if nodeId != "" {
		m = m.Where("node_id", nodeId)
	}
	var rows []jobRow
	if err := m.Scan(&rows); err != nil {
		return nil, err
	}
	out := make([]v1.DeployJobItem, 0, len(rows))
	for _, row := range rows {
		item := v1.DeployJobItem{
			Id:          row.Id,
			NodeId:      row.NodeId,
			ArtifactId:  row.ArtifactId,
			ServiceName: row.ServiceName,
			Action:      row.Action,
			Status:      row.Status,
			ImageName:   row.ImageName,
			HostPort:    row.HostPort,
			Message:     row.Message,
			Operator:    row.Operator,
		}
		if row.CreatedAt != nil {
			item.CreatedAt = row.CreatedAt.String()
		}
		if row.UpdatedAt != nil {
			item.UpdatedAt = row.UpdatedAt.String()
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *sDeploy) ArtifactFile(ctx context.Context, id int64) (string, string, error) {
	row, err := s.artifactByID(ctx, id)
	if err != nil {
		return "", "", err
	}
	return row.FilePath, row.Sha256, nil
}
