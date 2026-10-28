package v1

import "github.com/gogf/gf/v2/frame/g"

type ContainerInfo struct {
	Name     string `json:"name"`
	Image    string `json:"image"`
	Status   string `json:"status"`
	Ports    string `json:"ports"`
	CPUPerc  string `json:"cpuPerc"`
	MemUsage string `json:"memUsage"`
	MemPerc  string `json:"memPerc"`
}

type NodeMetrics struct {
	CpuUsedPercent  float64 `json:"cpuUsedPercent"`
	MemoryUsedBytes int64   `json:"memoryUsedBytes"`
	MemorySource    string  `json:"memorySource"`
	HostPorts       []int   `json:"hostPorts"`
}

type HeartbeatReq struct {
	g.Meta         `path:"/agent/heartbeat" method:"post" tags:"Agent" summary:"节点心跳"`
	NodeId         string          `json:"nodeId" v:"required"`
	Keepalive      bool            `json:"keepalive" dc:"仅刷新 last_seen，不覆盖节点指标、不分发任务"`
	Hostname       string          `json:"hostname"`
	OS             string          `json:"os"`
	Arch           string          `json:"arch"`
	DockerPlatform string          `json:"dockerPlatform"`
	DockerNetwork  string          `json:"dockerNetwork"`
	LoopbackAs     string          `json:"loopbackAs"`
	Ncpu           int             `json:"ncpu"`
	MemoryBytes    int64           `json:"memoryBytes"`
	AgentVersion   string          `json:"agentVersion"`
	Containers     []ContainerInfo `json:"containers"`
	Metrics        *NodeMetrics    `json:"metrics"`
}

type HeartbeatRes struct {
	Jobs []JobItem `json:"jobs"`
}

type JobItem struct {
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

type ReportJobReq struct {
	g.Meta  `path:"/agent/jobs/{id}/report" method:"post" tags:"Agent" summary:"回写任务结果"`
	Id      int64  `path:"id" v:"required"`
	NodeId  string `json:"nodeId" v:"required#nodeId 不能为空" dc:"上报者节点，服务端校验任务归属"`
	Status  string `json:"status" v:"required|in:running,success,failed"`
	Message string `json:"message"`
}

type ReportJobRes struct{}

type ListNodesReq struct {
	g.Meta `path:"/nodes" method:"get" tags:"Deploy" summary:"节点列表"`
}

type NodeItem struct {
	NodeId          string          `json:"nodeId"`
	Hostname        string          `json:"hostname"`
	OS              string          `json:"os"`
	Arch            string          `json:"arch"`
	DockerPlatform  string          `json:"dockerPlatform"`
	DockerNetwork   string          `json:"dockerNetwork"`
	LoopbackAs      string          `json:"loopbackAs"`
	Ncpu            int             `json:"ncpu"`
	MemoryBytes     int64           `json:"memoryBytes"`
	CpuUsedPercent  float64         `json:"cpuUsedPercent"`
	MemoryUsedBytes int64           `json:"memoryUsedBytes"`
	MemorySource    string          `json:"memorySource"`
	HostPorts       []int           `json:"hostPorts"`
	AgentVersion    string          `json:"agentVersion"`
	Online          bool            `json:"online"`
	LastSeen        string          `json:"lastSeen"`
	Containers      []ContainerInfo `json:"containers"`
}

type RecommendReq struct {
	g.Meta     `path:"/nodes/recommend" method:"get" tags:"Deploy" summary:"按资源空闲推荐部署节点"`
	ArtifactId int64 `json:"artifactId" v:"required" query:"artifactId"`
	HostPort   int   `json:"hostPort" query:"hostPort"`
}

type RecommendNode struct {
	NodeId          string  `json:"nodeId"`
	Hostname        string  `json:"hostname"`
	Online          bool    `json:"online"`
	DockerPlatform  string  `json:"dockerPlatform"`
	Ncpu            int     `json:"ncpu"`
	MemoryBytes     int64   `json:"memoryBytes"`
	MemoryUsedBytes int64   `json:"memoryUsedBytes"`
	MemorySource    string  `json:"memorySource"`
	CpuUsedPercent  float64 `json:"cpuUsedPercent"`
	ContainerCount  int     `json:"containerCount"`
	Eligible        bool    `json:"eligible"`
	Recommended     bool    `json:"recommended"`
	Score           int     `json:"score"`
	Reason          string  `json:"reason"`
}

type RecommendRes struct {
	ServiceName       string          `json:"serviceName"`
	Platform          string          `json:"platform"`
	HostPort          int             `json:"hostPort"`
	RecommendedNodeId string          `json:"recommendedNodeId"`
	Summary           string          `json:"summary"`
	Nodes             []RecommendNode `json:"nodes"`
}

type ListNodesRes struct {
	List []NodeItem `json:"list"`
}

type ArtifactItem struct {
	Id            int64  `json:"id"`
	ServiceName   string `json:"serviceName"`
	ImageName     string `json:"imageName"`
	Platform      string `json:"platform"`
	ContainerPort int    `json:"containerPort"`
	FileSize      int64  `json:"fileSize"`
	Sha256        string `json:"sha256"`
	Operator      string `json:"operator"`
	CreatedAt     string `json:"createdAt"`
}

type ListArtifactsReq struct {
	g.Meta      `path:"/artifacts" method:"get" tags:"Deploy" summary:"产物列表"`
	ServiceName string `query:"serviceName"`
}

type ListArtifactsRes struct {
	List []ArtifactItem `json:"list"`
}

type UploadArtifactReq struct {
	g.Meta        `path:"/artifacts" method:"post" mime:"multipart/form-data" tags:"Deploy" summary:"上传 tar 产物"`
	ServiceName   string `p:"serviceName" v:"required"`
	ImageName     string `p:"imageName" v:"required"`
	Platform      string `p:"platform" v:"required"`
	ContainerPort int    `p:"containerPort"`
}

type UploadArtifactRes struct {
	ArtifactItem
}

type CreateDeployReq struct {
	g.Meta         `path:"/deploys" method:"post" tags:"Deploy" summary:"发布到指定节点（canary=灰度，all=全量）"`
	NodeIds        []string `json:"nodeIds" v:"required"`
	ArtifactId     int64    `json:"artifactId" v:"required"`
	HostPort       int      `json:"hostPort" dc:"主容器宿主机端口，默认等于容器端口"`
	Remark         string   `json:"remark"`
	Strategy       string   `json:"strategy" dc:"canary（默认）或 all"`
	CanaryCount    int      `json:"canaryCount" dc:"多节点灰度时先发几台，默认 1"`
	CanaryHostPort int      `json:"canaryHostPort" dc:"单节点旁路灰度端口；设置后不替换旧容器，以 cc-<服务>-canary 运行"`
}

type CreateDeployRes struct {
	JobIds []int64 `json:"jobIds"`
}

type RollbackDeployReq struct {
	g.Meta      `path:"/deploys/rollback" method:"post" tags:"Deploy" summary:"回滚到该节点该服务上一成功版本"`
	NodeId      string `json:"nodeId" v:"required"`
	ServiceName string `json:"serviceName" v:"required"`
	Remark      string `json:"remark"`
}

type RollbackDeployRes struct {
	JobId int64 `json:"jobId"`
}

type PromoteDeployReq struct {
	g.Meta     `path:"/deploys/promote" method:"post" tags:"Deploy" summary:"推进灰度：等待中的节点改为下发，或将旁路 canary 转正"`
	ArtifactId int64  `json:"artifactId" v:"required"`
	Remark     string `json:"remark"`
}

type PromoteDeployRes struct {
	JobIds []int64 `json:"jobIds"`
}

type LifecycleReq struct {
	g.Meta      `path:"/deploys/lifecycle" method:"post" tags:"Deploy" summary:"通过 Agent 启动/停止/重启容器"`
	NodeId      string `json:"nodeId" v:"required"`
	ServiceName string `json:"serviceName" v:"required" dc:"容器名去掉 cc- 前缀，如 shop-server 或 shop-server-canary"`
	Action      string `json:"action" v:"required|in:start,stop,restart"`
}

type LifecycleRes struct {
	JobId int64 `json:"jobId"`
}

type ListJobsReq struct {
	g.Meta `path:"/deploys" method:"get" tags:"Deploy" summary:"发布任务"`
	NodeId string `query:"nodeId"`
}

type DeployJobItem struct {
	Id          int64  `json:"id"`
	NodeId      string `json:"nodeId"`
	ArtifactId  int64  `json:"artifactId"`
	ServiceName string `json:"serviceName"`
	Action      string `json:"action"`
	Status      string `json:"status"`
	ImageName   string `json:"imageName"`
	HostPort    int    `json:"hostPort"`
	Message     string `json:"message"`
	Operator    string `json:"operator"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type ListJobsRes struct {
	List []DeployJobItem `json:"list"`
}
