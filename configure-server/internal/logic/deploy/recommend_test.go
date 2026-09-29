package deploy

import (
	"strings"
	"testing"

	v1 "configure-server/api/deploy/v1"
)

const gib = int64(1024 * 1024 * 1024)

func testNode(id, platform string, online bool, cpu float64, total, used int64, containers []v1.ContainerInfo, ports []int) v1.NodeItem {
	return v1.NodeItem{
		NodeId:          id,
		Online:          online,
		DockerPlatform:  platform,
		Ncpu:            8,
		CpuUsedPercent:  cpu,
		MemoryBytes:     total,
		MemoryUsedBytes: used,
		MemorySource:    "host",
		Containers:      containers,
		HostPorts:       ports,
	}
}

func TestRankPicksFreerNode(t *testing.T) {
	busy := testNode("busy", "linux/arm64", true, 80, 16*gib, 14*gib, nil, nil)
	idle := testNode("idle", "linux/arm64", true, 10, 16*gib, 2*gib, nil, nil)
	res := rankPlacement([]v1.NodeItem{busy, idle}, "pay", "linux/arm64", 8080)
	if res.RecommendedNodeId != "idle" {
		t.Fatalf("recommended %s summary %s", res.RecommendedNodeId, res.Summary)
	}
	if !res.Nodes[0].Recommended || res.Nodes[0].NodeId != "idle" {
		t.Fatalf("order %+v", res.Nodes[0])
	}
	if !res.Nodes[1].Eligible || res.Nodes[1].Reason == "" || !contains(res.Nodes[1].Reason, "低于 idle") {
		t.Fatalf("second reason %s", res.Nodes[1].Reason)
	}
	if !contains(res.Summary, "内存空闲") || !contains(res.Summary, "CPU 占用") {
		t.Fatal(res.Summary)
	}
}

func TestRankSkipsBlockedNodes(t *testing.T) {
	offline := testNode("off", "linux/arm64", false, 1, 16*gib, gib, nil, nil)
	wrong := testNode("amd", "linux/amd64", true, 1, 16*gib, gib, nil, nil)
	running := testNode("run", "linux/arm64", true, 1, 16*gib, gib, []v1.ContainerInfo{{
		Name: "cc-pay", Status: "Up 2 hours", Ports: "0.0.0.0:8080->8080/tcp",
	}}, nil)
	portBusy := testNode("port", "linux/arm64", true, 5, 16*gib, gib, []v1.ContainerInfo{{
		Name: "cc-shop", Status: "Up", Ports: "0.0.0.0:8080->8080/tcp",
	}}, nil)
	hostPort := testNode("listen", "linux/arm64", true, 5, 16*gib, gib, nil, []int{8080})
	ok := testNode("ok", "linux/arm64", true, 20, 16*gib, 4*gib, nil, nil)
	res := rankPlacement([]v1.NodeItem{offline, wrong, running, portBusy, hostPort, ok}, "pay", "linux/aarch64", 8080)
	if res.RecommendedNodeId != "ok" {
		t.Fatalf("got %s", res.RecommendedNodeId)
	}
	reasons := map[string]string{}
	for _, n := range res.Nodes {
		reasons[n.NodeId] = n.Reason
		if n.NodeId != "ok" && n.Eligible {
			t.Fatalf("%s should be blocked: %s", n.NodeId, n.Reason)
		}
	}
	for id, part := range map[string]string{
		"off":    "离线",
		"amd":    "不一致",
		"run":    "已在运行 cc-pay",
		"port":   "cc-shop",
		"listen": "已被占用",
	} {
		if !contains(reasons[id], part) {
			t.Fatalf("%s reason %s", id, reasons[id])
		}
	}
}

func TestRankStoppedContainerStillEligible(t *testing.T) {
	n := testNode("n1", "linux/arm64", true, 10, 8*gib, gib, []v1.ContainerInfo{{
		Name: "cc-pay", Status: "Exited (0) 2 weeks ago",
	}}, nil)
	res := rankPlacement([]v1.NodeItem{n}, "pay", "linux/arm64", 9000)
	if res.RecommendedNodeId != "n1" || !res.Nodes[0].Eligible {
		t.Fatalf("%+v", res.Nodes)
	}
}

func TestUnknownUsageIsNotTreatedAsIdle(t *testing.T) {
	idle := testNode("idle", "linux/arm64", true, 0, 16*gib, 0, nil, nil)
	unknown := testNode("unknown", "linux/arm64", true, -1, 16*gib, -1, nil, nil)
	busy := testNode("busy", "linux/arm64", true, 90, 16*gib, 15*gib, nil, nil)
	res := rankPlacement([]v1.NodeItem{unknown, busy, idle}, "pay", "linux/arm64", 8080)
	if res.RecommendedNodeId != "idle" {
		t.Fatal(res.RecommendedNodeId)
	}
	score := map[string]int{}
	for _, n := range res.Nodes {
		score[n.NodeId] = n.Score
	}
	if score["unknown"] <= score["busy"] {
		t.Fatalf("unknown should beat a busy node, scores %+v", score)
	}
	if !contains(reasonOf(res, "unknown"), "未上报") {
		t.Fatal(reasonOf(res, "unknown"))
	}
}

func TestUnknownUsagePrefersLargerMachine(t *testing.T) {
	small := testNode("small", "linux/arm64", true, -1, 8*gib, -1, nil, nil)
	large := testNode("large", "linux/arm64", true, -1, 32*gib, -1, nil, nil)
	res := rankPlacement([]v1.NodeItem{small, large}, "pay", "linux/arm64", 8080)
	if res.RecommendedNodeId != "large" {
		t.Fatal(res.RecommendedNodeId)
	}
}

func TestContainerMemorySourceWording(t *testing.T) {
	n := testNode("n1", "linux/arm64", true, 10, 16*gib, 4*gib, nil, nil)
	n.MemorySource = "containers"
	res := rankPlacement([]v1.NodeItem{n}, "pay", "linux/arm64", 8080)
	if !contains(res.Summary, "不含宿主机其它进程") {
		t.Fatal(res.Summary)
	}
}

func reasonOf(res *v1.RecommendRes, id string) string {
	for _, n := range res.Nodes {
		if n.NodeId == id {
			return n.Reason
		}
	}
	return ""
}

func contains(s, part string) bool {
	return strings.Contains(s, part)
}
