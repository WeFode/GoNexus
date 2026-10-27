package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	v1 "configure-server/api/deploy/v1"
)

func metricsOf(in *v1.HeartbeatReq) (cpu float64, memUsed int64, source, ports string) {
	cpu = -1
	memUsed = -1
	ports = "[]"
	if in == nil || in.Metrics == nil {
		return
	}
	cpu = in.Metrics.CpuUsedPercent
	memUsed = in.Metrics.MemoryUsedBytes
	switch in.Metrics.MemorySource {
	case "host", "containers":
		source = in.Metrics.MemorySource
	}
	if in.Metrics.HostPorts == nil {
		return
	}
	raw, err := json.Marshal(in.Metrics.HostPorts)
	if err != nil {
		return
	}
	ports = string(raw)
	return
}

func decodeHostPorts(raw string) []int {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return []int{}
	}
	var ports []int
	if err := json.Unmarshal([]byte(raw), &ports); err != nil || ports == nil {
		return []int{}
	}
	return ports
}

func (s *sDeploy) Recommend(ctx context.Context, artifactID int64, hostPort int) (*v1.RecommendRes, error) {
	art, err := s.artifactByID(ctx, artifactID)
	if err != nil {
		return nil, err
	}
	nodes, err := s.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	port := hostPort
	if port <= 0 {
		port = art.ContainerPort
	}
	return rankPlacement(nodes, art.ServiceName, art.Platform, port), nil
}

type placed struct {
	src     v1.NodeItem
	item    v1.RecommendNode
	raw     float64
	freeMem int64
	up      int
}

// 空闲分 = 内存空闲比 60% + CPU 空闲比 40%，机器容量最多再加 5 分用于用量都未知时的区分。
func rankPlacement(nodes []v1.NodeItem, serviceName, platform string, hostPort int) *v1.RecommendRes {
	res := &v1.RecommendRes{
		ServiceName: serviceName,
		Platform:    platform,
		HostPort:    hostPort,
		Nodes:       []v1.RecommendNode{},
	}
	if len(nodes) == 0 {
		res.Summary = "还没有节点上报。请先在机器上启动 deploy-agent。"
		return res
	}

	draft := make([]placed, 0, len(nodes))
	var maxMem int64
	for _, n := range nodes {
		up := runningCount(n.Containers)
		free, _, _, _ := memoryFree(n)
		reason, ok := blockReason(n, serviceName, platform, hostPort)
		item := v1.RecommendNode{
			NodeId:          n.NodeId,
			Hostname:        n.Hostname,
			Online:          n.Online,
			DockerPlatform:  n.DockerPlatform,
			Ncpu:            n.Ncpu,
			MemoryBytes:     n.MemoryBytes,
			MemoryUsedBytes: n.MemoryUsedBytes,
			MemorySource:    n.MemorySource,
			CpuUsedPercent:  n.CpuUsedPercent,
			ContainerCount:  up,
			Eligible:        ok,
			Reason:          reason,
		}
		if ok && n.MemoryBytes > maxMem {
			maxMem = n.MemoryBytes
		}
		draft = append(draft, placed{src: n, item: item, freeMem: free, up: up})
	}

	for i := range draft {
		if !draft[i].item.Eligible {
			continue
		}
		draft[i].raw = idleScore(draft[i].src, maxMem)
		draft[i].item.Score = scorePercent(draft[i].raw)
		draft[i].item.Reason = metricReason(draft[i].src, hostPort, draft[i].up)
	}

	sort.SliceStable(draft, func(i, j int) bool {
		if draft[i].item.Eligible != draft[j].item.Eligible {
			return draft[i].item.Eligible
		}
		if draft[i].raw != draft[j].raw {
			return draft[i].raw > draft[j].raw
		}
		if draft[i].freeMem != draft[j].freeMem {
			return draft[i].freeMem > draft[j].freeMem
		}
		if draft[i].up != draft[j].up {
			return draft[i].up < draft[j].up
		}
		return draft[i].item.NodeId < draft[j].item.NodeId
	})

	if draft[0].item.Eligible {
		draft[0].item.Recommended = true
		res.RecommendedNodeId = draft[0].item.NodeId
		res.Summary = "推荐 " + res.RecommendedNodeId + "：" + draft[0].item.Reason
		for i := 1; i < len(draft); i++ {
			if !draft[i].item.Eligible {
				break
			}
			draft[i].item.Reason += "，综合空闲低于 " + res.RecommendedNodeId
		}
	} else {
		res.Summary = "没有可部署节点。下方是每台不适合的原因，仍可在上方手动选择节点。"
	}
	for _, d := range draft {
		res.Nodes = append(res.Nodes, d.item)
	}
	return res
}

func blockReason(n v1.NodeItem, service, platform string, port int) (string, bool) {
	if !n.Online {
		return "离线，超过 45 秒没有心跳", false
	}
	if !platformsMatch(platform, n.DockerPlatform) {
		return fmt.Sprintf("架构 %s 与产物 %s 不一致", orUnknown(n.DockerPlatform), orUnknown(platform)), false
	}
	main := "cc-" + service
	if containerUp(n.Containers, main) {
		return fmt.Sprintf("已在运行 %s，再次发布会替换现有容器", main), false
	}
	if port > 0 {
		needle := fmt.Sprintf(":%d->", port)
		var others []string
		selfHolds := false
		for _, c := range n.Containers {
			if !strings.Contains(c.Ports, needle) {
				continue
			}
			if c.Name == main {
				selfHolds = true
				continue
			}
			others = append(others, c.Name)
		}
		if len(others) > 0 {
			return fmt.Sprintf("端口 %d 已被 %s 占用", port, strings.Join(others, "、")), false
		}
		if portListed(n.HostPorts, port) && !selfHolds {
			return fmt.Sprintf("端口 %d 已被占用", port), false
		}
	}
	return "", true
}

func metricReason(n v1.NodeItem, port, up int) string {
	parts := make([]string, 0, 4)
	free, total, _, known := memoryFree(n)
	if known {
		pct := 0.0
		if total > 0 {
			pct = float64(free) / float64(total) * 100
		}
		used := total - free
		if n.MemorySource == "containers" {
			parts = append(parts, fmt.Sprintf("容器内存已用 %s / %s（空闲 %.0f%%，不含宿主机其它进程）", formatGB(used), formatGB(total), pct))
		} else {
			parts = append(parts, fmt.Sprintf("内存空闲 %s / %s（%.0f%%）", formatGB(free), formatGB(total), pct))
		}
	} else if total > 0 {
		parts = append(parts, fmt.Sprintf("内存容量 %s，占用未上报", formatGB(total)))
	} else {
		parts = append(parts, "内存占用未上报")
	}
	if n.CpuUsedPercent >= 0 {
		parts = append(parts, fmt.Sprintf("CPU 占用 %.0f%%（%d 核）", n.CpuUsedPercent, n.Ncpu))
	} else if n.Ncpu > 0 {
		parts = append(parts, fmt.Sprintf("CPU %d 核，占用未上报", n.Ncpu))
	} else {
		parts = append(parts, "CPU 占用未上报")
	}
	parts = append(parts, fmt.Sprintf("运行中容器 %d 个", up))
	if port > 0 {
		parts = append(parts, fmt.Sprintf("端口 %d 空闲", port))
	}
	return strings.Join(parts, "，")
}

func memoryFree(n v1.NodeItem) (free, total int64, ratio float64, known bool) {
	total = n.MemoryBytes
	if n.MemoryUsedBytes < 0 || total <= 0 {
		return 0, total, 0.5, false
	}
	free = total - n.MemoryUsedBytes
	if free < 0 {
		free = 0
	}
	if free > total {
		free = total
	}
	return free, total, float64(free) / float64(total), true
}

func cpuFreeRatio(pct float64) (float64, bool) {
	if pct < 0 {
		return 0.5, false
	}
	if pct > 100 {
		pct = 100
	}
	return (100 - pct) / 100, true
}

func idleScore(n v1.NodeItem, maxMem int64) float64 {
	cpuFree, _ := cpuFreeRatio(n.CpuUsedPercent)
	_, _, memFree, _ := memoryFree(n)
	score := 0.4*cpuFree + 0.6*memFree
	if maxMem > 0 && n.MemoryBytes > 0 {
		score += 0.05 * float64(n.MemoryBytes) / float64(maxMem)
	}
	return score
}

func scorePercent(raw float64) int {
	n := int(math.Round(raw * 100))
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func runningCount(list []v1.ContainerInfo) int {
	n := 0
	for _, c := range list {
		if strings.Contains(strings.ToLower(c.Status), "up") {
			n++
		}
	}
	return n
}

func containerUp(list []v1.ContainerInfo, name string) bool {
	for _, c := range list {
		if c.Name == name && strings.Contains(strings.ToLower(c.Status), "up") {
			return true
		}
	}
	return false
}

func portListed(ports []int, port int) bool {
	for _, p := range ports {
		if p == port {
			return true
		}
	}
	return false
}

func orUnknown(s string) string {
	if strings.TrimSpace(s) == "" {
		return "未知"
	}
	return s
}

func formatGB(n int64) string {
	return fmt.Sprintf("%.1f GB", float64(n)/(1024*1024*1024))
}
